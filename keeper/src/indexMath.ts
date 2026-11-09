// Deterministic index calculation. Everything here is pure so anyone can recompute a round
// from its published JSON (see recompute.ts).
import { keccak256, toHex } from 'viem';

export const METHOD_VERSION = 'slopx-index-v1';

export interface IndexConfig {
  minLiquidityUsd: number;     // pool liquidity floor at round start
  minSellers24h: number;       // distinct sellers seen in prior 24h ("can be sold")
  maxWeight: number;           // per-coin weight cap, e.g. 0.10
  minConstituents: number;     // fewer => round result is 1.0 (refund)
  sampleWindowSec: number;     // price = median of samples in [T - window, T]
  universeWindowSec: number;   // launched within this long before round start (24h)
}

export const DEFAULT_INDEX_CONFIG: IndexConfig = {
  minLiquidityUsd: 5_000,
  minSellers24h: 5,
  maxWeight: 0.1,
  minConstituents: 5,
  sampleWindowSec: 300,
  universeWindowSec: 86_400,
};

export interface Candidate {
  token: string;            // token address (lowercase)
  pool: string;             // pool address used for pricing
  symbol: string;
  launchpad: string;
  launchedAt: number;       // unix seconds
  liquidityUsd: number;     // at round start
  sellers24h: number;
  flaggedUnsellable?: boolean;
}

export interface Constituent extends Candidate {
  included: boolean;
  excludeReason?: string;
  weight: number;
  startPrice?: number;
  endPrice?: number;
  ret?: number;
  startSamples?: number[];
  endSamples?: number[];
}

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Liquidity weights, capped at `cap`, excess redistributed iteratively. Equal weights if cap infeasible. */
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

export function selectConstituents(cands: Candidate[], roundStart: number, cfg: IndexConfig): Constituent[] {
  const out: Constituent[] = [];
  for (const c of [...cands].sort((a, b) => a.token.localeCompare(b.token))) {
    let reason: string | undefined;
    if (c.launchedAt > roundStart || c.launchedAt < roundStart - cfg.universeWindowSec) reason = 'outside-24h-window';
    else if (c.flaggedUnsellable) reason = 'unsellable';
    else if (c.sellers24h < cfg.minSellers24h) reason = 'too-few-sellers';
    else if (c.liquidityUsd < cfg.minLiquidityUsd) reason = 'below-min-liquidity';
    out.push({ ...c, included: !reason, excludeReason: reason, weight: 0 });
  }
  const inc = out.filter((c) => c.included);
  const w = cappedWeights(inc.map((c) => c.liquidityUsd), cfg.maxWeight);
  inc.forEach((c, i) => (c.weight = w[i]));
  return out;
}

export interface RoundComputation {
  method: string;
  marketId: number;
  marketName: string;
  roundId: number;
  roundStart: number;
  roundEnd: number;
  config: IndexConfig;
  legs: { name: string; launchpads: string[] | 'all'; constituents: Constituent[]; ratio: string | null; count: number }[];
  resultE18: string;          // posted onchain
  note?: string;
}

const E18 = 10n ** 18n;

export function toE18(x: number): bigint {
  // round to 12 significant decimals deterministically
  return BigInt(Math.round(x * 1e12)) * 1_000_000n;
}

/** Compute one leg's weighted-median return with caps re-applied over priced constituents. */
export function legRatio(cons: Constituent[], cfg: IndexConfig): { ratio: number | undefined; count: number } {
  const live = cons.filter((c) => c.included);
  for (const c of live) {
    c.startPrice = median(c.startSamples ?? []);
    c.endPrice = median(c.endSamples ?? []);
    if (!(c.startPrice && c.startPrice > 0) || c.endPrice === undefined) {
      c.included = false; c.excludeReason = 'missing-price'; c.weight = 0;
    }
  }
  const priced = cons.filter((c) => c.included);
  const w = cappedWeights(priced.map((c) => c.liquidityUsd), cfg.maxWeight);
  priced.forEach((c, i) => { c.weight = w[i]; c.ret = c.endPrice! / c.startPrice!; });
  if (priced.length < cfg.minConstituents) return { ratio: undefined, count: priced.length };
  return { ratio: weightedMedian(priced.map((c) => c.ret!), w), count: priced.length };
}

export function finaliseRound(base: Omit<RoundComputation, 'resultE18' | 'note'>): RoundComputation {
  const ratios = base.legs.map((l) => (l.ratio === null ? undefined : Number(l.ratio)));
  let result: bigint = E18;
  let note: string | undefined;
  if (ratios.some((r) => r === undefined || !isFinite(r!))) {
    note = 'insufficient-constituents: result 1.0 => refund';
  } else if (ratios.length === 1) {
    result = toE18(ratios[0]!);
  } else {
    result = ratios[1]! === 0 ? E18 : toE18(ratios[0]! / ratios[1]!);
    if (ratios[1]! === 0) note = 'second leg zero: refund';
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
