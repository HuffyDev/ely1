// Keeper loop. Restart-safe by construction:
//  - every cursor (log scans) and every computed artifact (snapshot, result) lives in SQLite;
//  - every onchain action is decided from *current chain state* (round status, existing proposal),
//    and the contract itself rejects a second proposal or a second settle, so a crash between
//    "tx sent" and "DB updated" can never cause a double settlement;
//  - a SQLite lease ensures only one keeper process acts at a time.
import { randomUUID } from 'node:crypto';
import { cfg, MARKETS } from './config.js';
import { db, kvGet, kvSet, acquireLease } from './db.js';
import { publicClient, walletClient, contract, timing } from './chain.js';
import { discoverLaunches, samplePools, indexSells, verifyPoolManager } from './sources/v4.js';
import { snapshotRound, computeResult, storeResult } from './rounds.js';
import { indexEvents } from './events.js';
import { alert } from './alerts.js';

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const now = () => Math.floor(Date.now() / 1000);
const ID = randomUUID();

async function safe(name: string, fn: () => Promise<unknown>) {
  try { const r = await fn(); if (r) log(name, r); return r; }
  catch (e) { log(`[${name}] error:`, (e as Error).message.split('\n')[0]); await alert('warn', `error:${name}`, (e as Error).message.split('\n')[0]); }
}

let lastDiscovery = 0, lastFull = 0, v4ok = false;

async function dataTick() {
  if (!v4ok) { v4ok = !!(await safe('verify-pool-manager', verifyPoolManager)); if (!v4ok) return; }
  if (now() - lastDiscovery >= cfg.discoveryIntervalSec) {
    lastDiscovery = now();
    await safe('discover', discoverLaunches);
  }
  const full = now() - lastFull >= 300; if (full) lastFull = now();
  await safe('samples', () => samplePools(full));
  if (full) await safe('sells', indexSells);
  const lastTs = Number(kvGet('v4:lastSampleTs') ?? 0);
  if (lastTs && now() - lastTs > 5 * cfg.sampleIntervalSec) await alert('critical', 'sampler-stale', `No price sample for ${now() - lastTs}s — rounds may refund for missing prices.`);
  db.prepare('DELETE FROM samples WHERE ts < ?').run(now() - 3 * 86_400);
}

async function roundTick() {
  if (!cfg.contract) return;
  const { genesis, duration } = await timing();
  // chain time, not wall clock, so simulations never revert on a lagging node
  const t = Math.min(now(), Number((await publicClient.getBlock()).timestamp));
  if (t < genesis) return;
  const current = Math.floor((t - genesis) / duration);
  const c = contract();
  const disputeWindow = await publicClient.readContract({ ...c, functionName: 'disputeWindow' });
  for (const m of MARKETS) {
    // 1. freeze constituents for the round in progress (start samples are taken from the window before start)
    if (await safe(`snapshot ${m.name}#${current}`, () => snapshotRound(m, current, genesis + current * duration))) {
      const s = db.prepare('SELECT json FROM snapshots WHERE market_id=? AND round_id=?').get(m.id, current) as { json: string };
      const legs = JSON.parse(s.json).legs as { name: string; constituents: { included: boolean }[] }[];
      for (const l of legs) {
        const n = l.constituents.filter((x) => x.included).length;
        if (n < cfg.index.minConstituents) await alert('warn', `thin-leg:${m.id}:${l.name}`, `${m.name} round #${current} leg "${l.name}" has ${n} eligible constituents (< ${cfg.index.minConstituents}); it will refund.`);
      }
    }
    // 2. finished rounds in the last 6h: compute -> propose -> settle
    for (let r = Math.max(0, current - 6); r < current; r++) {
      const start = genesis + r * duration, end = start + duration;
      const [longTotal, shortTotal, , , status] = (await publicClient.readContract({ ...c, functionName: 'rounds', args: [BigInt(m.id), BigInt(r)] })) as unknown as [bigint, bigint, bigint, bigint, number];
      if (status !== 0) continue; // already settled or refunded: nothing to do, ever
      // wait until the sampler has passed the end boundary (or give up waiting after 3 min)
      if (Number(kvGet('v4:lastSampleTs') ?? 0) < end && t < end + 180) continue;
      const row = await safe(`compute ${m.name}#${r}`, async () => storeResult(await computeResult(m, r, start, end))) as ReturnType<typeof storeResult> | undefined;
      if (!row) continue;
      if (longTotal === 0n && shortTotal === 0n) continue;
      const rc = JSON.parse(row.json);
      const missing = rc.legs.flatMap((l: any) => l.constituents.filter((x: any) => x.excludeReason === 'missing-price').map((x: any) => x.symbol));
      if (missing.length) await alert('warn', `missing-price:${m.id}:${r}`, `${m.name} #${r}: no price for ${missing.length} constituent(s): ${missing.slice(0, 8).join(', ')}`);
      if (rc.note) await alert('warn', `refund:${m.id}:${r}`, `${m.name} #${r}: ${rc.note}`);
      const wallet = walletClient();
      if (longTotal === 0n || shortTotal === 0n) {
        await safe(`settle(one-sided) ${m.name}#${r}`, () => send(wallet, 'settle', [BigInt(m.id), BigInt(r)], m.id, r, 'settled_tx'));
        continue;
      }
      const [, , proposedAt] = (await publicClient.readContract({ ...c, functionName: 'proposals', args: [BigInt(m.id), BigInt(r)] })) as readonly [bigint, `0x${string}`, bigint];
      if (proposedAt === 0n) {
        // a guardian rejection clears the proposal; we re-propose the same published result and hash
        await safe(`propose ${m.name}#${r}`, () => send(wallet, 'proposeResult', [BigInt(m.id), BigInt(r), BigInt(row.result_e18), row.data_hash as `0x${string}`], m.id, r, 'proposed_tx'));
      } else if (BigInt(t) >= proposedAt + disputeWindow) {
        await safe(`settle ${m.name}#${r}`, () => send(wallet, 'settle', [BigInt(m.id), BigInt(r)], m.id, r, 'settled_tx'));
      }
    }
    // 3. rounds about to hit the missing-result deadline get a loud alert
    const maxDelay = Number(await publicClient.readContract({ ...c, functionName: 'maxPriceDelay' }));
    for (let r = Math.max(0, current - 12); r < current; r++) {
      const end = genesis + (r + 1) * duration;
      if (t > end + maxDelay / 2) {
        const st = (await publicClient.readContract({ ...c, functionName: 'rounds', args: [BigInt(m.id), BigInt(r)] })) as unknown as [bigint, bigint, bigint, bigint, number];
        if (st[4] === 0 && st[0] + st[1] > 0n) await alert('critical', `unsettled:${m.id}:${r}`, `${m.name} #${r} still unsettled ${Math.round((t - end) / 60)} min after end; refunds start at +${maxDelay / 3600}h.`);
      }
    }
  }
}

async function send(wallet: ReturnType<typeof walletClient>, fn: 'settle' | 'proposeResult', args: readonly unknown[], marketId: number, roundId: number, col: 'proposed_tx' | 'settled_tx') {
  const { request } = await publicClient.simulateContract({ ...contract(), functionName: fn, args: args as any, account: wallet.account });
  const hash = await wallet.writeContract(request);
  db.prepare(`UPDATE results SET ${col}=? WHERE market_id=? AND round_id=?`).run(hash, marketId, roundId);
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return hash;
}

/**
 * Round artifacts (snapshots, results, indexed events) belong to ONE deployment. If the contract,
 * chain or genesis changes while the DB is kept, wipe them so a stale result can never be re-posted.
 * Launch/price/sell data is chain data and is kept.
 */
export async function bindDeployment() {
  if (!cfg.contract) return;
  const { genesis, duration } = await timing();
  const id = `${await publicClient.getChainId()}:${cfg.contract.toLowerCase()}:${genesis}:${duration}`;
  const prev = kvGet('deployment');
  if (prev !== id) {
    if (prev) log(`deployment changed (${prev} -> ${id}); clearing snapshots/results/events`);
    db.transaction(() => {
      db.exec('DELETE FROM snapshots; DELETE FROM results; DELETE FROM events;');
      db.prepare("DELETE FROM kv WHERE k='events:block'").run();
      kvSet('deployment', id);
    })();
  }
}

export async function runKeeper() {
  log(`keeper ${ID.slice(0, 8)} starting: settlement=${cfg.contract ?? '(no CONTRACT_ADDRESS: data only)'} poolManager=${cfg.poolManager}`);
  await bindDeployment();
  let busy = false;
  const loop = async () => {
    if (busy) return; busy = true;
    try {
      if (!acquireLease(ID, cfg.sampleIntervalSec * 4)) { log('another keeper holds the lease; standing by'); return; }
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
