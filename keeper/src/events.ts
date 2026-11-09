// Indexes contract events into SQLite for round history. Cursor stored in kv => restart-safe.
import { decodeEventLog } from 'viem';
import { publicClient, contract } from './chain.js';
import { cfg } from './config.js';
import { db, kvGet, kvSet } from './db.js';
import { slopxAbi } from './abi.js';

const ins = db.prepare('INSERT OR IGNORE INTO events(tx,log_index,block,ts,name,market_id,round_id,user,json) VALUES(?,?,?,?,?,?,?,?,?)');

export async function indexEvents(): Promise<number> {
  if (!cfg.contract) return 0;
  const head = await publicClient.getBlockNumber();
  let from = BigInt(kvGet('events:block') ?? cfg.startBlock.toString());
  let n = 0;
  while (from <= head) {
    const to = from + 5_000n > head ? head : from + 5_000n;
    const logs = await publicClient.getLogs({ address: contract().address, fromBlock: from, toBlock: to });
    const tsCache = new Map<bigint, number>();
    for (const l of logs) {
      let ev;
      try { ev = decodeEventLog({ abi: slopxAbi, data: l.data, topics: l.topics }); } catch { continue; }
      if (!tsCache.has(l.blockNumber!)) tsCache.set(l.blockNumber!, Number((await publicClient.getBlock({ blockNumber: l.blockNumber! })).timestamp));
      const a = ev.args as Record<string, unknown>;
      ins.run(l.transactionHash, l.logIndex, Number(l.blockNumber), tsCache.get(l.blockNumber!), ev.eventName,
        a.marketId !== undefined ? Number(a.marketId) : null, a.roundId !== undefined ? Number(a.roundId) : null,
        (a.user as string | undefined)?.toLowerCase() ?? null,
        JSON.stringify(a, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      n++;
    }
    kvSet('events:block', (to + 1n).toString());
    from = to + 1n;
  }
  return n;
}
