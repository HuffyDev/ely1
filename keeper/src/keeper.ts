// Keeper loop. Restart-safe: every step derives what to do from chain state + SQLite, so killing
// and restarting at any point never double-posts (the contract also rejects double proposals).
import { cfg, MARKETS } from './config.js';
import { db } from './db.js';
import { publicClient, walletClient, contract, timing } from './chain.js';
import { discover, samplePrices } from './sources/gecko.js';
import { scanFactories } from './sources/factory.js';
import { snapshotRound, computeResult, storeResult } from './rounds.js';
import { indexEvents } from './events.js';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const now = () => Math.floor(Date.now() / 1000);

async function safe(name: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); if (r) log(name, r); } catch (e) { log(`[${name}] error:`, (e as Error).message); }
}

let lastDiscovery = 0;

async function dataTick() {
  if (now() - lastDiscovery >= cfg.discoveryIntervalSec) {
    lastDiscovery = now();
    await safe('factories', scanFactories);
    await safe('discover', discover);
  }
  await safe('samples', samplePrices);
  db.prepare('DELETE FROM samples WHERE ts < ?').run(now() - 3 * 86_400);
}

async function roundTick() {
  if (!cfg.contract) return;
  const { genesis, duration } = await timing();
  // use chain time (not wall clock) so simulations never revert with TooEarly on a lagging node
  const t = Math.min(now(), Number((await publicClient.getBlock()).timestamp));
  if (t < genesis) return;
  const current = Math.floor((t - genesis) / duration); // round in progress
  const c = contract();
  for (const m of MARKETS) {
    // 1. freeze constituents for the round that just started
    snapshotRound(m, current, genesis + current * duration);
    // 2. finished rounds in the last 6h: propose, then settle
    for (let r = Math.max(0, current - 6); r < current; r++) {
      const start = genesis + r * duration, end = start + duration;
      if (t < end + cfg.index.sampleWindowSec / 10) continue;
      const round = await publicClient.readContract({ ...c, functionName: 'rounds', args: [BigInt(m.id), BigInt(r)] });
      const [longTotal, shortTotal, , , status] = round as unknown as [bigint, bigint, bigint, bigint, number];
      if (status !== 0) continue; // settled or voided
      const hasDeposits = longTotal > 0n || shortTotal > 0n;
      const row = storeResult(computeResult(m, r, start, end));
      if (!hasDeposits) continue;
      const [, , proposedAt] = (await publicClient.readContract({ ...c, functionName: 'proposals', args: [BigInt(m.id), BigInt(r)] })) as readonly [bigint, `0x${string}`, bigint];
      const wallet = walletClient();
      if (longTotal === 0n || shortTotal === 0n) {
        await safe(`settle-one-sided ${m.name}#${r}`, async () => sendAndRecord(wallet, 'settle', [BigInt(m.id), BigInt(r)], m.id, r, 'settled_tx'));
        continue;
      }
      if (proposedAt === 0n) {
        await safe(`propose ${m.name}#${r}`, async () =>
          sendAndRecord(wallet, 'proposeResult', [BigInt(m.id), BigInt(r), BigInt(row.result_e18), row.data_hash as `0x${string}`], m.id, r, 'proposed_tx'));
      } else {
        const window = await publicClient.readContract({ ...c, functionName: 'disputeWindow' });
        if (BigInt(t) >= proposedAt + window)
          await safe(`settle ${m.name}#${r}`, async () => sendAndRecord(wallet, 'settle', [BigInt(m.id), BigInt(r)], m.id, r, 'settled_tx'));
      }
    }
  }
}

async function sendAndRecord(wallet: ReturnType<typeof walletClient>, fn: 'settle' | 'proposeResult', args: readonly unknown[], marketId: number, roundId: number, col: 'proposed_tx' | 'settled_tx') {
  const { request } = await publicClient.simulateContract({ ...contract(), functionName: fn, args: args as any, account: wallet.account });
  const hash = await wallet.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  db.prepare(`UPDATE results SET ${col}=? WHERE market_id=? AND round_id=?`).run(hash, marketId, roundId);
  return hash;
}

export async function runKeeper() {
  log(`keeper starting: chain ${cfg.contract ? 'contract ' + cfg.contract : '(no CONTRACT_ADDRESS — data only)'}; gecko=${cfg.geckoNetwork ?? 'unset'}`);
  let busy = false;
  const loop = async () => {
    if (busy) return; busy = true;
    try {
      await dataTick();
      await safe('rounds', roundTick);
      await safe('events', indexEvents);
    } finally { busy = false; }
  };
  await loop();
  setInterval(loop, cfg.sampleIntervalSec * 1000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runKeeper();
  process.on('SIGTERM', () => { db.close(); process.exit(0); });
}
