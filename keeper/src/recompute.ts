// Independently recompute a round from its published JSON and check the onchain dataHash.
// Usage: npm run recompute -- <file.json | https://site/api/result/0/123/raw> [expectedHash]
import { readFileSync } from 'node:fs';
import { canonicalJson, dataHash, finaliseRound, legRatio, type RoundComputation } from './indexMath.js';

const src = process.argv[2];
if (!src) { console.error('usage: recompute <file|url> [expectedHash]'); process.exit(1); }
const raw = src.startsWith('http') ? await (await fetch(src)).text() : readFileSync(src, 'utf8');
const published = JSON.parse(raw) as RoundComputation;

const legs = published.legs.map((l) => {
  // reset the price-dependent exclusions and recompute from the raw samples
  const cons = l.constituents.map((c) => ({ ...c, included: c.included || c.excludeReason === 'missing-price', excludeReason: c.excludeReason === 'missing-price' ? undefined : c.excludeReason }));
  const { ratio, count } = legRatio(cons, published.config);
  return { name: l.name, launchpads: l.launchpads, constituents: cons, ratio: ratio === undefined ? null : ratio.toString(), count };
});
const { resultE18: _r, note: _n, ...base } = published;
const again = finaliseRound({ ...base, legs });

const ok = again.resultE18 === published.resultE18;
console.log(`result  published=${published.resultE18} recomputed=${again.resultE18} ${ok ? 'MATCH' : 'MISMATCH'}`);
const h = dataHash(published);
console.log(`dataHash of published JSON = ${h}`);
if (process.argv[3]) console.log(`expected onchain hash      = ${process.argv[3]} ${process.argv[3].toLowerCase() === h ? 'MATCH' : 'MISMATCH'}`);
console.log(`canonical bytes: ${canonicalJson(published).length}`);
process.exit(ok ? 0 : 2);
