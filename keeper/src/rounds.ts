// Round snapshotting and result computation (DB-backed, idempotent).
import { cfg, MARKETS, type MarketDef } from './config.js';
import { db } from './db.js';
import { finaliseRound, legRatio, selectConstituents, dataHash, type Candidate, type RoundComputation, METHOD_VERSION } from './indexMath.js';

interface TokenRow { token: string; pool: string; symbol: string; launchpad: string; launched_at: number; liquidity_usd: number; sellers_24h: number; unsellable: number }

function candidates(roundStart: number, launchpads: string[] | 'all'): Candidate[] {
  const rows = db.prepare("SELECT * FROM tokens WHERE launched_at <= ? AND launched_at >= ? AND pool != ''")
    .all(roundStart, roundStart - cfg.index.universeWindowSec) as TokenRow[];
  return rows
    .filter((r) => launchpads === 'all' || launchpads.includes(r.launchpad))
    .map((r) => ({ token: r.token, pool: r.pool, symbol: r.symbol, launchpad: r.launchpad, launchedAt: r.launched_at,
      liquidityUsd: r.liquidity_usd, sellers24h: r.sellers_24h, flaggedUnsellable: !!r.unsellable }));
}

function samplesFor(token: string, t: number): number[] {
  return (db.prepare('SELECT price_usd FROM samples WHERE token=? AND ts > ? AND ts <= ? ORDER BY ts')
    .all(token, t - cfg.index.sampleWindowSec, t) as { price_usd: number }[]).map((r) => r.price_usd);
}

/** Freeze the constituent list at round start. Runs once per (market, round). */
export function snapshotRound(m: MarketDef, roundId: number, start: number) {
  const exists = db.prepare('SELECT 1 FROM snapshots WHERE market_id=? AND round_id=?').get(m.id, roundId);
  if (exists) return;
  const legs = m.legs.map((l) => ({ name: l.name, launchpads: l.launchpads, constituents: selectConstituents(candidates(start, l.launchpads), start, cfg.index) }));
  db.prepare('INSERT OR IGNORE INTO snapshots(market_id,round_id,json,created_at) VALUES(?,?,?,?)')
    .run(m.id, roundId, JSON.stringify(legs), Math.floor(Date.now() / 1000));
}

export function getSnapshot(marketId: number, roundId: number) {
  const r = db.prepare('SELECT json FROM snapshots WHERE market_id=? AND round_id=?').get(marketId, roundId) as { json: string } | undefined;
  return r ? JSON.parse(r.json) : null;
}

/** Compute the result once the round has ended. Pure given the stored snapshot + samples. */
export function computeResult(m: MarketDef, roundId: number, start: number, end: number): RoundComputation {
  const snap = getSnapshot(m.id, roundId) as RoundComputation['legs'] | null;
  const legs: RoundComputation['legs'] = (snap ?? m.legs.map((l) => ({ name: l.name, launchpads: l.launchpads, constituents: [], ratio: null, count: 0 })))
    .map((leg) => {
      const cons = leg.constituents.map((c) => ({ ...c, startSamples: samplesFor(c.token, start), endSamples: samplesFor(c.token, end) }));
      // no samples at end-of-window? fall back to the last sample inside the round (rugs still count)
      for (const c of cons) {
        if (c.endSamples.length === 0) {
          const last = db.prepare('SELECT price_usd FROM samples WHERE token=? AND ts > ? AND ts <= ? ORDER BY ts DESC LIMIT 1').get(c.token, start, end) as { price_usd: number } | undefined;
          if (last) c.endSamples = [last.price_usd];
        }
      }
      const { ratio, count } = legRatio(cons, cfg.index);
      return { name: leg.name, launchpads: leg.launchpads, constituents: cons, ratio: ratio === undefined ? null : ratio.toString(), count };
    });
  return finaliseRound({ method: METHOD_VERSION, marketId: m.id, marketName: m.name, roundId, roundStart: start, roundEnd: end, config: cfg.index, legs });
}

export function storeResult(rc: RoundComputation) {
  const json = JSON.stringify(rc);
  db.prepare('INSERT OR IGNORE INTO results(market_id,round_id,json,data_hash,result_e18,created_at) VALUES(?,?,?,?,?,?)')
    .run(rc.marketId, rc.roundId, json, dataHash(rc), rc.resultE18, Math.floor(Date.now() / 1000));
  return db.prepare('SELECT * FROM results WHERE market_id=? AND round_id=?').get(rc.marketId, rc.roundId) as
    { json: string; data_hash: string; result_e18: string; proposed_tx: string | null; settled_tx: string | null };
}

export { MARKETS };
