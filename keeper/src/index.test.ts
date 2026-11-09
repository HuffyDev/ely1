import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cappedWeights, weightedMedian, median, selectConstituents, legRatio, finaliseRound, dataHash, canonicalJson, DEFAULT_INDEX_CONFIG as C } from './indexMath.js';
import { computePayouts, applyFunding, DEFAULT_PARAMS as P } from './payout.js';

test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), undefined); });

test('capped weights sum to 1 and respect cap', () => {
  const w = cappedWeights([1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 0.1);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.max(...w) <= 0.1 + 1e-9);
});

test('infeasible cap => equal weights', () => { assert.deepEqual(cappedWeights([5, 1, 1], 0.1), [1 / 3, 1 / 3, 1 / 3]); });

test('one whale coin cannot move the weighted median', () => {
  const vals = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 50];
  const w = cappedWeights([1, 1, 1, 1, 1, 1, 1, 1, 1, 1e9], 0.1);
  assert.equal(weightedMedian(vals, w), 0.9);
});

test('filters', () => {
  const t0 = 1_000_000;
  const mk = (i: number, o: Partial<any> = {}) => ({ token: '0x' + i, pool: 'p' + i, symbol: 'T' + i, launchpad: 'montra', launchedAt: t0 - 100, liquidityUsd: 10_000, sellers24h: 10, ...o });
  const out = selectConstituents([mk(1), mk(2, { liquidityUsd: 10 }), mk(3, { sellers24h: 0 }), mk(4, { flaggedUnsellable: true }), mk(5, { launchedAt: t0 - 90_000 })], t0, C);
  assert.deepEqual(out.map((c) => c.excludeReason ?? 'ok'), ['ok', 'below-min-liquidity', 'too-few-sellers', 'unsellable', 'outside-24h-window']);
});

test('leg ratio, refund on too few constituents, hash determinism', () => {
  const cons = Array.from({ length: 7 }, (_, i) => ({ token: '0x' + i, pool: 'p', symbol: 'T', launchpad: 'x', launchedAt: 0, liquidityUsd: 1000 + i,
    sellers24h: 9, included: true, weight: 0, startSamples: [1, 1, 1], endSamples: [0.5 + i * 0.1] }));
  const r = legRatio(cons, C);
  assert.equal(r.count, 7);
  assert.ok(Math.abs(r.ratio! - 0.8) < 1e-9);
  const base = { method: 'm', marketId: 0, marketName: 'X', roundId: 1, roundStart: 0, roundEnd: 3600, config: C };
  const res = finaliseRound({ ...base, legs: [{ name: 'a', launchpads: 'all', constituents: cons, ratio: String(r.ratio), count: 7 }] });
  assert.equal(res.resultE18, (8n * 10n ** 17n).toString());
  const refund = finaliseRound({ ...base, legs: [{ name: 'a', launchpads: 'all', constituents: [], ratio: null, count: 0 }] });
  assert.equal(refund.resultE18, (10n ** 18n).toString());
  assert.equal(dataHash(res), dataHash(JSON.parse(JSON.stringify(res))));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('payout conservation (random)', () => {
  for (let i = 0; i < 5000; i++) {
    const L = BigInt(Math.floor(Math.random() * 1e9)) * 10n ** 9n + 1n, S = BigInt(Math.floor(Math.random() * 1e9)) * 10n ** 9n + 1n;
    const w = Math.random() < 0.5;
    const r = computePayouts(L, S, w, P);
    assert.equal(r.longPayout + r.shortPayout + r.fee, L + S);
    const [a, b] = applyFunding(L, S, P);
    assert.equal(a + b, L + S);
  }
});

test('matches the Solidity worked example', () => {
  const e = 10n ** 18n;
  const r = computePayouts(1n * e, 3n * e, false, P);
  assert.equal(r.shortPayout, 3n * e + e - 23n * 10n ** 15n);
});
