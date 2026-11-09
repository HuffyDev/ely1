// Exact bigint mirror of SlopxPools.applyFunding / computePayouts.
export interface Params {
  feeBps: bigint;
  maxProfitBps: bigint;
  fundingK: bigint;
  fundingMaxBps: bigint;
  fundingCapBps: bigint;
  tieBps: bigint;
}

export const DEFAULT_PARAMS: Params = {
  feeBps: 200n,
  maxProfitBps: 50_000n,
  fundingK: 500n,       // chosen after simulation: see docs/funding-simulation.md
  fundingMaxBps: 250n,
  fundingCapBps: 5_000n,
  tieBps: 1n,
};

export function applyFunding(L: bigint, S: bigint, p: Params): [bigint, bigint] {
  const tot = L + S;
  if (tot === 0n || L === S) return [L, S];
  const shortsCrowded = S > L;
  const crowded = shortsCrowded ? S : L;
  const minority = shortsCrowded ? L : S;
  const skewBps = ((crowded - minority) * 10_000n) / tot;
  let rate = (skewBps * p.fundingK) / 10_000n;
  if (rate > p.fundingMaxBps) rate = p.fundingMaxBps;
  let f = (crowded * rate) / 10_000n;
  const cap = (minority * p.fundingCapBps) / 10_000n;
  if (f > cap) f = cap;
  return shortsCrowded ? [L + f, S - f] : [L - f, S + f];
}

export function computePayouts(L: bigint, S: bigint, longWins: boolean, p: Params) {
  const [eL, eS] = applyFunding(L, S, p);
  const effW = longWins ? eL : eS;
  const effLo = longWins ? eS : eL;
  const maxT = (effW * p.maxProfitBps) / 10_000n;
  const t = effLo < maxT ? effLo : maxT;
  const fee = (t * p.feeBps) / 10_000n;
  const win = effW + t - fee;
  const lose = effLo - t;
  return longWins ? { longPayout: win, shortPayout: lose, fee } : { longPayout: lose, shortPayout: win, fee };
}

/** Payout multiple for 1 unit deposited on `side` if it wins (float, for UI/sim). */
export function winMultiple(L: bigint, S: bigint, side: 'long' | 'short', p: Params): number {
  if (L === 0n || S === 0n) return 1;
  const r = computePayouts(L, S, side === 'long', p);
  return side === 'long' ? Number(r.longPayout) / Number(L) : Number(r.shortPayout) / Number(S);
}

export function loseMultiple(L: bigint, S: bigint, side: 'long' | 'short', p: Params): number {
  if (L === 0n || S === 0n) return 1;
  const r = computePayouts(L, S, side !== 'long', p);
  return side === 'long' ? Number(r.longPayout) / Number(L) : Number(r.shortPayout) / Number(S);
}
