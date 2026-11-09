import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cappedWeights, weightedMedian, weightedIQM, median, selectConstituents, legRatio, finaliseRound, dataHash, canonicalJson, recompute, priceHype, DEFAULT_INDEX_CONFIG as C, type Candidate } from './indexMath.js';
import { computePayouts, applyFunding, DEFAULT_PARAMS as P } from './payout.js';
import { depthHype } from './sources/v4.js';

const Q96 = 2n ** 96n;
const sqrtFor = (hypePerToken: number) => BigInt(Math.round(Math.sqrt(1 / hypePerToken) * 2 ** 48)) * 2n ** 48n; // token is currency1

test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), undefined); });

test('priceHype orientation + decimals', () => {
  const sp = sqrtFor(4.2e-8);
  assert.ok(Math.abs(priceHype(sp, false) / 4.2e-8 - 1) < 1e-6);
  assert.ok(Math.abs(priceHype(Q96, true) - 1) < 1e-12);
  assert.ok(Math.abs(priceHype(Q96, true, 6) - 1e-12) < 1e-24);
});

test('depthHype matches real pool read (block 3136722 RENOUNLESS)', () => {
  const d = depthHype(385350023123796245667272766423291n, 205600513195795932137885n, false);
  assert.ok(Math.abs(d - 2 * 42.27157) < 0.01);
});

test('IQM: not stuck at 1.0 when many coins are untraded; whale-resistant', () => {
  const real = [0.9022, 0.90235, 0.90442, 0.99602, 0.99805, 0.99865, 0.99923, 0.99979, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.00065, 1.00149, 1.00486, 1.0523, 1.06261, 1.12527];
  const eq = real.map(() => 1);
  assert.equal(weightedMedian(real, eq), 1);                 // the real fork round: median pinned at exactly 1.0
  const iqm = weightedIQM(real, eq)!; assert.notEqual(iqm, 1); assert.ok(Math.abs(iqm - 1) < 0.01);
  const vals = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 50];
  const a = weightedIQM(vals, cappedWeights(vals.map(() => 1), 0.1))!;
  const b = weightedIQM([...vals.slice(0, 9), 5000], cappedWeights(vals.map(() => 1), 0.1))!;
  assert.equal(a, b, 'pumping one capped coin does not move the IQM');
});

test('capped weights sum to 1 and respect cap', () => {
  const w = cappedWeights([1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0.1);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.max(...w) <= 0.1 + 1e-9);
});

test('infeasible cap => equal weights', () => { assert.deepEqual(cappedWeights([5, 1, 1], 0.1), [1 / 3, 1 / 3, 1 / 3]); });

test('one whale coin cannot move the weighted median', () => {
  const vals = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 50];
  assert.equal(weightedMedian(vals, cappedWeights([1, 1, 1, 1, 1, 1, 1, 1, 1, 1e9], 0.1)), 0.9);
});

const HOOK = '0x6b1216a40b65c83e9c9e18a562c446697b8cf8ec';
const mk = (i: number, o: Partial<Candidate> = {}): Candidate => ({ token: '0x' + String(i).padStart(40, '0'), pool: '0x' + String(i).padStart(64, '0'), symbol: 'T' + i, decimals: 18,
  tokenIsC0: false, quote: 'HYPE', hooks: HOOK, launchpad: HOOK, launchBlock: 500, liquidityHype: 200, sellers24h: 9, ...o });

test('universe + filters', () => {
  const filler = Array.from({ length: 30 }, (_, i) => mk(100 + i));
  const out = selectConstituents([mk(1), mk(2, { liquidityHype: 10 }), mk(3, { sellers24h: 0 }), mk(4, { flaggedUnsellable: true }),
    mk(5, { launchBlock: 5 }), mk(6, { hooks: '0x0000000000000000000000000000000000000000' }), mk(7, { hooks: '0xdead' }), ...filler], { fromBlock: 100, toBlock: 1000 }, C, new Set());
  const r = Object.fromEntries(out.map((c) => [c.symbol, c.excludeReason ?? 'ok']));
  assert.equal(r.T1, 'ok'); assert.equal(r.T2, 'below-min-liquidity'); assert.equal(r.T3, 'too-few-sellers'); assert.equal(r.T4, 'unsellable');
  assert.equal(r.T5, undefined, 'outside window dropped'); assert.equal(r.T6, 'not-a-launchpad-pool'); assert.equal(r.T7, 'not-a-launchpad-pool');
  const lab = selectConstituents([mk(7, { hooks: '0xdead' })], { fromBlock: 100, toBlock: 1000 }, C, new Set(['0xdead']));
  assert.equal(lab[0].included, true, 'verified label overrides min-launch rule');
});

test('one constituent per token: deepest pool wins', () => {
  const filler = Array.from({ length: 30 }, (_, i) => mk(100 + i));
  const out = selectConstituents([mk(1, { pool: '0xa', liquidityHype: 150 }), mk(1, { pool: '0xb', liquidityHype: 900 }), ...filler], { fromBlock: 0, toBlock: 1000 }, C, new Set());
  assert.equal(out.filter((c) => c.symbol === 'T1').length, 1);
  assert.equal(out.find((c) => c.symbol === 'T1')!.pool, '0xb');
});

test('leg ratio from raw sqrt samples, refund rule, recompute + hash determinism', () => {
  const cons = Array.from({ length: 7 }, (_, i) => ({ ...mk(i, { liquidityHype: 1000 + i }), included: true, weight: 0,
    startSamples: [1, 2, 3].map((b) => ({ block: b, ts: b, sqrtPriceX96: sqrtFor(1e-6).toString() })),
    endSamples: [{ block: 9, ts: 9, sqrtPriceX96: sqrtFor(1e-6 * (0.5 + i * 0.1)).toString() }] }));
  const r = legRatio(cons, C);
  assert.equal(r.count, 7);
  // IQM of returns .5..1.1 (equal weights): middle 50% of weight around 0.8, in log space
  assert.ok(r.ratio! > 0.75 && r.ratio! < 0.82, String(r.ratio));
  const base = { method: 'm', marketId: 0, marketName: 'X', roundId: 1, roundStart: 0, roundEnd: 3600, dataChainId: 99901, poolManager: '0x', window: { fromBlock: 0, toBlock: 1 }, hookCounts: {}, labels: {}, config: C };
  const res = finaliseRound({ ...base, legs: [{ name: 'a', launchpads: 'all', constituents: cons, ratio: String(r.ratio), count: 7 }] });
  const parsed = JSON.parse(JSON.stringify(res));
  assert.equal(recompute(parsed).resultE18, res.resultE18);
  assert.equal(dataHash(res), dataHash(parsed));
  const refund = finaliseRound({ ...base, legs: [{ name: 'a', launchpads: 'all', constituents: [], ratio: null, count: 0 }] });
  assert.equal(refund.resultE18, (10n ** 18n).toString());
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('missing end price excludes the coin (and too few => refund)', () => {
  const cons = Array.from({ length: 5 }, (_, i) => ({ ...mk(i), included: true, weight: 0, startSamples: [{ block: 1, ts: 1, sqrtPriceX96: sqrtFor(1e-6).toString() }], endSamples: i === 0 ? [] : [{ block: 2, ts: 2, sqrtPriceX96: sqrtFor(1e-6).toString() }] }));
  const r = legRatio(cons, C);
  assert.equal(r.ratio, undefined); assert.equal(r.count, 4); assert.equal((cons[0] as any).excludeReason, 'missing-price');
});

test('payout conservation (random)', () => {
  for (let i = 0; i < 5000; i++) {
    const L = BigInt(Math.floor(Math.random() * 1e9)) * 10n ** 9n + 1n, S = BigInt(Math.floor(Math.random() * 1e9)) * 10n ** 9n + 1n;
    const r = computePayouts(L, S, Math.random() < 0.5, P);
    assert.equal(r.longPayout + r.shortPayout + r.fee, L + S);
    const [a, b] = applyFunding(L, S, P); assert.equal(a + b, L + S);
  }
});
