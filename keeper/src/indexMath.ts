// Deterministic index calculation (slopx-index-v2). Pure functions only: anyone can recompute a
// round from its published JSON (recompute.ts / in-browser proof page), and can re-read every
// raw sample from chain with an archive RPC (PoolManager.extsload at the published block).
import { keccak256, toHex } from 'viem';

export const METHOD_VERSION = 'slopx-index-v2.1';

export interface IndexConfig {
  minLiquidityHype: number;      // in-range virtual HYPE reserve x2 at round start
  minSellers24h: number;         // distinct tx senders that sold the token in the 24h window
  maxWeight: number;             // per-coin weight cap
  minConstituents: number;       // fewer priced constituents in any leg => result 1.0 => refund
  sampleWindowSec: number;       // price = median of samples in (T - window, T]
  universeWindowSec: number;     // launched within this long before round start
  launchpadMinLaunches: number;  // a hook counts as a launchpad if it created >= this many pools in the window
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  minLiquidityHype: 150,         // set from real mainnet distribution (launch seed ≈ 84 HYPE virtual depth)
  minSellers24h: 5,
  maxWeight: 0.1,
  minConstituents: 5,
  sampleWindowSec: 300,
  universeWindowSec: 86_400,
  launchpadMinLaunches: 25,
};

export interface Sample { block: number; ts: number; sqrtPriceX96: string }

export interface Candidate {
  token: string;
  pool: string;               // v4 PoolId
  symbol: string;
  decimals: number;
  tokenIsC0: boolean;
  quote: string;              // HYPE | WHYPE
  hooks: string;              // v4 hook address = launchpad fingerprint
  launchpad: string;          // verified label, or hook address if unlabelled
  launchBlock: number;
  liquidityHype: number;
  sellers24h: number;
  flaggedUnsellable?: boolean;
}

export interface Constituent extends Candidate {
  included: boolean;
  excludeReason?: string;
  weight: number;
  startSamples?: Sample[];
  endSamples?: Sample[];
  startPrice?: number;
  endPrice?: number;
  ret?: number;
}

const Q96 = 2 ** 96;
/** HYPE per whole token from sqrtPriceX96. */
export function priceHype(sqrtPriceX96: string | bigint, tokenIsC0: boolean, decimals = 18): number {
  const sp = Number(BigInt(sqrtPriceX96)) / Q96;
  const p = sp * sp;
  return (tokenIsC0 ? p : 1 / p) * 10 ** (decimals - 18);
}

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Liquidity weights capped at `cap`, excess redistributed iteratively. Equal weights if the cap is infeasible. */
export function cappedWeights(liq: number[], cap: number): number[] {
  const n = liq.length;
  if (n === 0) return [];
  if (n * cap < 1) return liq.map(() => 1 / n);
  const w = new Array(n).fill(0);
  const capped = new Array(n).fill(false);
  let remaining = 1;
  for (let iter = 0; iter < n + 1; iter++) {
    const free = liq.map((l, i) => (capped[i] ? 0 : l));
    const sumFree = free.reduce((a, b) => a + b, 0);
    if (sumFree <= 0) break;
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (capped[i]) continue;
      w[i] = (free[i] / sumFree) * remaining;
      if (w[i] > cap + 1e-12) { w[i] = cap; capped[i] = true; changed = true; }
    }
    if (!changed) break;
    remaining = 1 - capped.reduce((a, c, i) => a + (c ? w[i] : 0), 0);
  }
  return w;
}

/** Weighted median: smallest value whose cumulative weight reaches 50%. */
export function weightedMedian(values: number[], weights: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= total / 2 - 1e-12) return values[i];
  }
  return values[idx[idx.length - 1]];
}

/**
 * Weighted interquartile mean of returns, computed in log space: discard the lowest and highest 25% of
 * WEIGHT (partial weights at the edges), take the weighted mean log-return of the middle 50%.
 * Why not a plain median: on real Elysium data many launches don't trade within a round (return exactly
 * 1.0), so a median sticks at 1.0 and nearly every round becomes a tie/refund. The IQM keeps the
 * median's manipulation resistance (moving it needs > 25% of index weight) without that sticking.
 */
export function weightedIQM(values: number[], weights: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b] || a - b);
  const total = weights.reduce((a, b) => a + b, 0);
  const lo = total * 0.25, hi = total * 0.75;
  let acc = 0, wsum = 0, lsum = 0;
  for (const i of idx) {
    const a = acc, b = acc + weights[i];
    const w = Math.max(0, Math.min(b, hi) - Math.max(a, lo));
    if (w > 0) { wsum += w; lsum += w * Math.log(Math.max(values[i], 1e-18)); }
    acc = b;
  }
  return wsum > 0 ? Math.exp(lsum / wsum) : weightedMedian(values, weights);
}

/** Launches per hook within the window; hooks at/above the threshold are treated as launchpads. */
export function hookCounts(cands: Candidate[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const x of cands) c[x.hooks] = (c[x.hooks] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]));
}

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Apply the universe rule + filters. `window` is the block range [fromBlock, toBlock] corresponding
 * to [roundStart - 24h, roundStart]. One constituent per token (its deepest pool).
 */
export function selectConstituents(cands: Candidate[], window: { fromBlock: number; toBlock: number }, cfg: IndexConfig, labelled: Set<string>): Constituent[] {
  const inWindow = cands.filter((c) => c.launchBlock >= window.fromBlock && c.launchBlock <= window.toBlock);
  const counts = hookCounts(inWindow);
  // keep deepest pool per token, earliest launch block as tiebreak
  const byToken = new Map<string, Candidate>();
  for (const c of [...inWindow].sort((a, b) => b.liquidityHype - a.liquidityHype || a.launchBlock - b.launchBlock || a.pool.localeCompare(b.pool))) {
    if (!byToken.has(c.token)) byToken.set(c.token, c);
  }
  const out: Constituent[] = [];
  for (const c of [...byToken.values()].sort((a, b) => a.token.localeCompare(b.token))) {
    let reason: string | undefined;
    const isPad = labelled.has(c.hooks) || (c.hooks !== ZERO && (counts[c.hooks] ?? 0) >= cfg.launchpadMinLaunches);
    if (!isPad) reason = 'not-a-launchpad-pool';
    else if (c.flaggedUnsellable) reason = 'unsellable';
    else if (c.sellers24h < cfg.minSellers24h) reason = 'too-few-sellers';
    else if (c.liquidityHype < cfg.minLiquidityHype) reason = 'below-min-liquidity';
    out.push({ ...c, included: !reason, excludeReason: reason, weight: 0 });
  }
  return out;
}

/** Compute one leg: median start/end price per constituent, capped weights, weighted-median return. */
export function legRatio(cons: Constituent[], cfg: IndexConfig): { ratio: number | undefined; count: number } {
  for (const c of cons.filter((x) => x.included)) {
    c.startPrice = median((c.startSamples ?? []).map((s) => priceHype(s.sqrtPriceX96, c.tokenIsC0, c.decimals)));
    c.endPrice = median((c.endSamples ?? []).map((s) => priceHype(s.sqrtPriceX96, c.tokenIsC0, c.decimals)));
    if (!(c.startPrice && c.startPrice > 0) || c.endPrice === undefined) {
      c.included = false; c.excludeReason = 'missing-price'; c.weight = 0;
    }
  }
  const priced = cons.filter((c) => c.included);
  const w = cappedWeights(priced.map((c) => c.liquidityHype), cfg.maxWeight);
  priced.forEach((c, i) => { c.weight = w[i]; c.ret = c.endPrice! / c.startPrice!; });
  if (priced.length < cfg.minConstituents) return { ratio: undefined, count: priced.length };
  return { ratio: weightedIQM(priced.map((c) => c.ret!), w), count: priced.length };
}

export interface RoundComputation {
  method: string;
  marketId: number;
  marketName: string;
  roundId: number;
  roundStart: number;
  roundEnd: number;
  dataChainId: number;
  poolManager: string;
  window: { fromBlock: number; toBlock: number; endBlock?: number };
  hookCounts: Record<string, number>;
  labels: Record<string, string>;
  config: IndexConfig;
  legs: { name: string; launchpads: string[] | 'all'; constituents: Constituent[]; ratio: string | null; count: number }[];
  resultE18: string;
  note?: string;
}

const E18 = 10n ** 18n;
export function toE18(x: number): bigint {
  return BigInt(Math.round(x * 1e12)) * 1_000_000n;
}

export function finaliseRound(base: Omit<RoundComputation, 'resultE18' | 'note'>): RoundComputation {
  const ratios = base.legs.map((l) => (l.ratio === null ? undefined : Number(l.ratio)));
  let result: bigint = E18;
  let note: string | undefined;
  if (ratios.some((r) => r === undefined || !isFinite(r!))) {
    note = 'insufficient-constituents: result 1.0 => refund';
  } else if (ratios.length === 1) {
    result = toE18(ratios[0]!);
  } else if (ratios[1]! === 0) {
    note = 'second leg zero: refund';
  } else {
    result = toE18(ratios[0]! / ratios[1]!);
  }
  if (result <= 0n) result = 1n; // contract rejects 0; a total wipe-out still means "down"
  return { ...base, resultE18: result.toString(), note };
}

/** Canonical JSON: sorted keys, so the hash is reproducible. */
export function canonicalJson(x: unknown): string {
  return JSON.stringify(x, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((o: Record<string, unknown>, k) => { o[k] = (v as Record<string, unknown>)[k]; return o; }, {});
    }
    return v;
  });
}

export function dataHash(rc: RoundComputation): `0x${string}` {
  return keccak256(toHex(canonicalJson(rc)));
}

/** Re-run a published computation from its raw data (used by CLI and browser). */
export function recompute(published: RoundComputation): RoundComputation {
  const legs = published.legs.map((l) => {
    const cons = l.constituents.map((c) => ({ ...c, included: c.included || c.excludeReason === 'missing-price',
      excludeReason: c.excludeReason === 'missing-price' ? undefined : c.excludeReason }));
    const { ratio, count } = legRatio(cons, published.config);
    return { name: l.name, launchpads: l.launchpads, constituents: cons, ratio: ratio === undefined ? null : ratio.toString(), count };
  });
  const { resultE18: _r, note: _n, ...base } = published;
  return finaliseRound({ ...base, legs });
}
