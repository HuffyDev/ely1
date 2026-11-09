// Onchain launchpad discovery: scans factory creation events listed in launchpads.json and tags
// tokens with their launchpad. Authoritative for the launchpad label (overrides GeckoTerminal dex ids).
import { parseAbiItem, type AbiEvent } from 'viem';
import { publicClient } from '../chain.js';
import { LAUNCHPADS, cfg } from '../config.js';
import { db, kvGet, kvSet } from '../db.js';

const ins = db.prepare(`INSERT INTO tokens(token,pool,symbol,launchpad,launched_at,updated_at) VALUES(?,?,?,?,?,?)
ON CONFLICT(token) DO UPDATE SET launchpad=excluded.launchpad`);

export async function scanFactories(): Promise<number> {
  const factories = LAUNCHPADS.filter((l) => l.factory && l.event && l.tokenArg);
  if (factories.length === 0) return 0;
  const head = await publicClient.getBlockNumber();
  let total = 0;
  for (const lp of factories) {
    const key = `factory:${lp.name}:block`;
    let from = BigInt(kvGet(key) ?? cfg.startBlock.toString());
    const ev = parseAbiItem(lp.event!) as AbiEvent;
    while (from <= head) {
      const to = from + 5_000n > head ? head : from + 5_000n;
      const logs = await publicClient.getLogs({ address: lp.factory!, event: ev, fromBlock: from, toBlock: to });
      const blockTs = new Map<bigint, number>();
      for (const log of logs) {
        const token = String((log as any).args?.[lp.tokenArg!] ?? '').toLowerCase();
        if (!token) continue;
        if (!blockTs.has(log.blockNumber!)) blockTs.set(log.blockNumber!, Number((await publicClient.getBlock({ blockNumber: log.blockNumber! })).timestamp));
        ins.run(token, '', null, lp.name, blockTs.get(log.blockNumber!)!, Math.floor(Date.now() / 1000));
        total++;
      }
      kvSet(key, (to + 1n).toString());
      from = to + 1n;
    }
  }
  return total;
}
