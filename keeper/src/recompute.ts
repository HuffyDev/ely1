// Independently recompute a round from its published JSON and check the onchain dataHash.
// Usage: npm run recompute -w keeper -- <file.json | https://site/api/result/0/123/raw> [expectedHash] [--verify-chain <archiveRpc>]
// --verify-chain re-reads every published price sample from the PoolManager at its block.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, encodeAbiParameters, keccak256, type Hex } from 'viem';
import { canonicalJson, dataHash, recompute, type RoundComputation } from './indexMath.js';

const args = process.argv.slice(2);
const src = args[0];
if (!src) { console.error('usage: recompute <file|url> [expectedHash] [--verify-chain <rpc>]'); process.exit(1); }
const raw = src.startsWith('http') ? await (await fetch(src)).text() : readFileSync(src, 'utf8');
const published = JSON.parse(raw) as RoundComputation;
const again = recompute(published);
const ok = again.resultE18 === published.resultE18;
console.log(`result  published=${published.resultE18} recomputed=${again.resultE18} ${ok ? 'MATCH' : 'MISMATCH'}`);
const h = dataHash(published);
console.log(`dataHash of published JSON = ${h}`);
const expected = args[1] && !args[1].startsWith('--') ? args[1] : undefined;
if (expected) console.log(`expected onchain hash      = ${expected} ${expected.toLowerCase() === h ? 'MATCH' : 'MISMATCH'}`);
console.log(`canonical bytes: ${canonicalJson(published).length}`);

let chainOk = true;
const vi = args.indexOf('--verify-chain');
if (vi >= 0) {
  const client = createPublicClient({ transport: http(args[vi + 1]) });
  const abi = [{ type: 'function', name: 'extsload', stateMutability: 'view', inputs: [{ name: 's', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] }] as const;
  let checked = 0, bad = 0;
  for (const leg of published.legs) for (const c of leg.constituents) for (const s of [...(c.startSamples ?? []), ...(c.endSamples ?? [])]) {
    const slot = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [c.pool as Hex, 6n]));
    const v = await client.readContract({ address: published.poolManager as Hex, abi, functionName: 'extsload', args: [slot], blockNumber: BigInt(s.block) });
    const sp = BigInt(v) & ((1n << 160n) - 1n);
    checked++; if (sp.toString() !== s.sqrtPriceX96) { bad++; console.log(`  sample mismatch ${c.symbol} block ${s.block}: chain ${sp} vs published ${s.sqrtPriceX96}`); }
  }
  chainOk = bad === 0;
  console.log(`chain samples verified: ${checked - bad}/${checked} ${chainOk ? 'MATCH' : 'MISMATCH'}`);
}
process.exit(ok && chainOk ? 0 : 2);
