// Round snapshotting and result computation (DB-backed, idempotent).
import { cfg, MARKETS, LAUNCHPADS, labelForHook, dataChain, type MarketDef } from './config.js';
import { db } from './db.js';
import { blockAtOrAfter } from './sources/v4.js';
import { finaliseRound, legRatio, selectConstituents, hookCounts, dataHash, METHOD_VERSION,
  type Candidate, type Constituent, type RoundComputation, type Sample } from './indexMath.js';

interface PoolRow { pool_id: string; token: string; token_is_c0: number; quote: string; hooks: string; launch_block: number; depth_hype: number; unsellable: number; symbol: string | null; decimals: number | null }

function candidates(fromBlock: number, toBlock: number, atTs: number): Candidate[] {
  const rows = db.prepare(`SELECT p.*, m.symbol, m.decimals FROM pools p LEFT JOIN token_meta m ON m.token=p.token WHERE p.launch_block BETWEEN ? AND ?`).all(fromBlock, toBlock) as PoolRow[];
  const depthAt = db.prepare('SELECT depth_hype FROM samples WHERE pool_id=? AND ts<=? ORDER BY ts DESC LIMIT 1');
  const sellers = db.prepare('SELECT COUNT(DISTINCT seller) n FROM sells WHERE pool_id=? AND block BETWEEN ? AND ?');
  return rows.map((r) => ({
    token: r.token, pool: r.pool_id, symbol: r.symbol ?? '?', decimals: r.decimals ?? 18, tokenIsC0: !!r.token_is_c0, quote: r.quote,
    hooks: r.hooks, launchpad: labelForHook(r.hooks) ?? r.hooks, launchBlock: r.launch_block,
    // liquidity as of round start: last sample at/before start; pools never sampled have < 0.5x min depth
    liquidityHype: (depthAt.get(r.pool_id, atTs) as { depth_hype: number } | undefined)?.depth_hype ?? Math.min(r.depth_hype, cfg.index.minLiquidityHype * 0.5),
    sellers24h: (sellers.get(r.pool_id, fromBlock, toBlock) as { n: number }).n,
    flaggedUnsellable: !!r.unsellable,
  }));
}

function samplesFor(pool: string, t: number): Sample[] {
  return (db.prepare('SELECT block, ts, sqrt_price_x96 FROM samples WHERE pool_id=? AND ts > ? AND ts <= ? ORDER BY block')
    .all(pool, t - cfg.index.sampleWindowSec, t) as { block: number; ts: number; sqrt_price_x96: string }[])
    .map((r) => ({ block: r.block, ts: r.ts, sqrtPriceX96: r.sqrt_price_x96 }));
}

const labelledHooks = () => new Set(LAUNCHPADS.flatMap((l) => l.hooks));
const legFilter = (lp: string[] | 'all') => (c: Constituent) => lp === 'all' || lp.includes(c.launchpad);

/** Freeze the constituent list (with start samples) at round start. Runs once per (market, round). */
export async function snapshotRound(m: MarketDef, roundId: number, start: number) {
  if (db.prepare('SELECT 1 FROM snapshots WHERE market_id=? AND round_id=?').get(m.id, roundId)) return false;
  const toBlock = Number(await blockAtOrAfter(start)) - 1;            // last block before start
  const fromBlock = Number(await blockAtOrAfter(start - cfg.index.universeWindowSec));
  const cands = candidates(fromBlock, toBlock, start);
  const all = selectConstituents(cands, { fromBlock, toBlock }, cfg.index, labelledHooks());
  const legs = m.legs.map((l) => ({ name: l.name, launchpads: l.launchpads, constituents: all.filter(legFilter(l.launchpads)) }));
  const snap = { window: { fromBlock, toBlock }, hookCounts: hookCounts(cands), legs };
  db.prepare('INSERT OR IGNORE INTO snapshots(market_id,round_id,json,created_at) VALUES(?,?,?,?)').run(m.id, roundId, JSON.stringify(snap), Math.floor(Date.now() / 1000));
  return true;
}

export function getSnapshot(marketId: number, roundId: number): { window: { fromBlock: number; toBlock: number }; hookCounts: Record<string, number>; legs: { name: string; launchpads: string[] | 'all'; constituents: Constituent[] }[] } | null {
  const r = db.prepare('SELECT json FROM snapshots WHERE market_id=? AND round_id=?').get(marketId, roundId) as { json: string } | undefined;
  return r ? JSON.parse(r.json) : null;
}

/** Compute the result once the round has ended. Pure given stored snapshot + samples. */
export async function computeResult(m: MarketDef, roundId: number, start: number, end: number): Promise<RoundComputation> {
  const snap = getSnapshot(m.id, roundId);
  const endBlock = Number(await blockAtOrAfter(end));
  const legs = (snap?.legs ?? m.legs.map((l) => ({ name: l.name, launchpads: l.launchpads, constituents: [] as Constituent[] }))).map((leg) => {
    const cons = leg.constituents.map((c) => {
      if (!c.included) return { ...c };
      let endSamples = samplesFor(c.pool, end);
      if (endSamples.length === 0) {
        // no sample in the end window: last sample inside the round (a rug that stopped trading still counts)
        const last = db.prepare('SELECT block, ts, sqrt_price_x96 FROM samples WHERE pool_id=? AND ts > ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(c.pool, start, end) as any;
        if (last) endSamples = [{ block: last.block, ts: last.ts, sqrtPriceX96: last.sqrt_price_x96 }];
      }
      return { ...c, startSamples: samplesFor(c.pool, start), endSamples };
    });
    const { ratio, count } = legRatio(cons, cfg.index);
    return { name: leg.name, launchpads: leg.launchpads, constituents: cons, ratio: ratio === undefined ? null : ratio.toString(), count };
  });
  return finaliseRound({
    method: METHOD_VERSION, marketId: m.id, marketName: m.name, roundId, roundStart: start, roundEnd: end,
    dataChainId: dataChain.id, poolManager: cfg.poolManager.toLowerCase(),
    window: { ...(snap?.window ?? { fromBlock: 0, toBlock: 0 }), endBlock },
    hookCounts: snap?.hookCounts ?? {}, labels: Object.fromEntries(LAUNCHPADS.flatMap((l) => l.hooks.map((h) => [h, l.name]))),
    config: cfg.index, legs,
  });
}

export function storeResult(rc: RoundComputation) {
  db.prepare('INSERT OR IGNORE INTO results(market_id,round_id,json,data_hash,result_e18,created_at) VALUES(?,?,?,?,?,?)')
    .run(rc.marketId, rc.roundId, JSON.stringify(rc), dataHash(rc), rc.resultE18, Math.floor(Date.now() / 1000));
  return db.prepare('SELECT * FROM results WHERE market_id=? AND round_id=?').get(rc.marketId, rc.roundId) as
    { json: string; data_hash: string; result_e18: string; proposed_tx: string | null; settled_tx: string | null };
}

export const hasResult = (marketId: number, roundId: number) => !!db.prepare('SELECT 1 FROM results WHERE market_id=? AND round_id=?').get(marketId, roundId);

export { MARKETS };
