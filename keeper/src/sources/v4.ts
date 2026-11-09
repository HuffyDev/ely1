// Onchain data source: Uniswap v4 PoolManager on Elysium. No third-party APIs.
//  - launches  : PoolManager `Initialize` events (token paired with native HYPE or WHYPE)
//  - launchpad : the pool's hook contract address (labelled in launchpads.json once verified)
//  - price     : pool slot0.sqrtPriceX96 read with PoolManager.extsload at a pinned block
//  - liquidity : in-range virtual HYPE reserve x2 (price-impact depth)
//  - sellers   : distinct tx senders of Swap events where the token was paid into the pool
// Every sample stores its block number, so anyone with an archive RPC can re-read it.
import { encodeAbiParameters, keccak256, parseAbiItem, type Hex, type Address } from 'viem';
import { dataClient } from '../chain.js';
import { cfg } from '../config.js';
import { db, kvGet, kvSet } from '../db.js';
import { alert } from '../alerts.js';
import { priceHype } from '../indexMath.js';
export { priceHype };

export const INITIALIZE = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)');
export const SWAP = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)');
const EXTSLOAD = [{ type: 'function', name: 'extsload', stateMutability: 'view', inputs: [{ name: 'slots', type: 'bytes32[]' }], outputs: [{ type: 'bytes32[]' }] }] as const;
const ERC20 = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

const POOLS_SLOT = 6n; // v4-core PoolManager: mapping(PoolId => Pool.State) _pools at slot 6
const Q96 = 2n ** 96n;
const NATIVE = '0x0000000000000000000000000000000000000000';

export function poolStateSlot(id: Hex): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, POOLS_SLOT])));
}
const hex32 = (n: bigint) => ('0x' + n.toString(16).padStart(64, '0')) as Hex;

/** In-range virtual HYPE reserve x2, in HYPE. */
export function depthHype(sqrtPriceX96: bigint, liquidity: bigint, tokenIsC0: boolean): number {
  if (sqrtPriceX96 === 0n) return 0;
  const hypeRaw = tokenIsC0 ? (liquidity * sqrtPriceX96) / Q96 : (liquidity * Q96) / sqrtPriceX96;
  return (2 * Number(hypeRaw)) / 1e18;
}

export async function verifyPoolManager(): Promise<boolean> {
  const code = await dataClient.getCode({ address: cfg.poolManager });
  const ok = !!code && code.length > 2;
  kvSet('v4:ok', ok ? '1' : '0');
  if (!ok) await alert('critical', 'pool-manager-missing', `No code at PoolManager ${cfg.poolManager} on data chain; index disabled.`);
  return ok;
}

const insPool = db.prepare(`INSERT OR IGNORE INTO pools(pool_id,token,token_is_c0,quote,hooks,fee,tick_spacing,launch_block,tx) VALUES(?,?,?,?,?,?,?,?,?)`);

/** Index Initialize events from the cursor to head (backfills 24h+ on first run). */
export async function discoverLaunches(): Promise<number> {
  const head = await dataClient.getBlockNumber();
  let from = BigInt(kvGet('v4:initBlock') ?? (head - BigInt(Math.ceil((26 * 3600) / cfg.blockTimeSec))).toString());
  let n = 0;
  const whype = cfg.whype.toLowerCase();
  while (from <= head) {
    const to = from + cfg.logChunk > head ? head : from + cfg.logChunk;
    const logs = await dataClient.getLogs({ address: cfg.poolManager, event: INITIALIZE, fromBlock: from, toBlock: to });
    db.transaction(() => {
      for (const l of logs) {
        const a = l.args as any;
        const c0 = (a.currency0 as string).toLowerCase(), c1 = (a.currency1 as string).toLowerCase();
        let token: string, tokenIsC0: boolean, quote: string;
        if (c0 === NATIVE || c0 === whype) { token = c1; tokenIsC0 = false; quote = c0 === NATIVE ? 'HYPE' : 'WHYPE'; }
        else if (c1 === whype) { token = c0; tokenIsC0 = true; quote = 'WHYPE'; }
        else continue; // not HYPE-quoted: out of scope for v1
        insPool.run(a.id, token, tokenIsC0 ? 1 : 0, quote, (a.hooks as string).toLowerCase(), Number(a.fee), Number(a.tickSpacing), Number(l.blockNumber), l.transactionHash);
        n++;
      }
    })();
    kvSet('v4:initBlock', (to + 1n).toString());
    from = to + 1n;
  }
  return n;
}

async function fillTokenMeta() {
  // liquid pools first, so constituents always get a symbol
  for (let round = 0; round < 25; round++) {
    const missing = db.prepare(`SELECT p.token FROM pools p LEFT JOIN token_meta m ON m.token=p.token WHERE m.token IS NULL GROUP BY p.token ORDER BY MAX(p.depth_hype) DESC LIMIT 400`).all() as { token: Address }[];
    if (!missing.length) return;
    await fillBatch(missing);
  }
}

async function fillBatch(missing: { token: Address }[]) {
  const res = await dataClient.multicall({ allowFailure: true, contracts: missing.flatMap((t) => [
    { address: t.token, abi: ERC20, functionName: 'symbol' }, { address: t.token, abi: ERC20, functionName: 'decimals' }]) });
  const ins = db.prepare('INSERT OR REPLACE INTO token_meta(token,symbol,decimals) VALUES(?,?,?)');
  db.transaction(() => missing.forEach((t, i) => {
    const sym = res[i * 2].status === 'success' ? String(res[i * 2].result).slice(0, 24) : '?';
    const dec = res[i * 2 + 1].status === 'success' ? Number(res[i * 2 + 1].result) : 18;
    ins.run(t.token, sym, dec);
  }))();
}

/** Read slot0 + liquidity for many pools at one pinned block. */
export async function readPools(ids: Hex[], blockNumber: bigint) {
  const out = new Map<string, { sqrtPriceX96: bigint; liquidity: bigint }>();
  for (let i = 0; i < ids.length; i += 400) {
    const batch = ids.slice(i, i + 400);
    const slots = batch.flatMap((id) => { const s = poolStateSlot(id); return [hex32(s), hex32(s + 3n)]; });
    const vals = (await dataClient.readContract({ address: cfg.poolManager, abi: EXTSLOAD, functionName: 'extsload', args: [slots], blockNumber })) as Hex[];
    batch.forEach((id, j) => {
      const s0 = BigInt(vals[j * 2]);
      out.set(id, { sqrtPriceX96: s0 & ((1n << 160n) - 1n), liquidity: BigInt(vals[j * 2 + 1]) & ((1n << 128n) - 1n) });
    });
  }
  return out;
}

const insSample = db.prepare('INSERT OR IGNORE INTO samples(pool_id,block,ts,sqrt_price_x96,liquidity,price_hype,depth_hype) VALUES(?,?,?,?,?,?,?)');
const updDepth = db.prepare('UPDATE pools SET depth_hype=?, depth_block=? WHERE pool_id=?');

/** Refresh depth for every pool launched in the window (cheap, batched), sample prices for liquid ones. */
export async function samplePools(full: boolean): Promise<number> {
  const head = await dataClient.getBlock();
  const minBlock = Number(head.number) - Math.ceil((26 * 3600) / cfg.blockTimeSec);
  const where = full ? 'launch_block > ?' : 'launch_block > ? AND depth_hype >= ?';
  const pools = db.prepare(`SELECT p.pool_id, p.token_is_c0, COALESCE(m.decimals,18) dec FROM pools p LEFT JOIN token_meta m ON m.token=p.token WHERE ${where}`)
    .all(...(full ? [minBlock] : [minBlock, cfg.index.minLiquidityHype * 0.5])) as { pool_id: Hex; token_is_c0: number; dec: number }[];
  if (!pools.length) return 0;
  const state = await readPools(pools.map((p) => p.pool_id), head.number);
  const ts = Number(head.timestamp), blk = Number(head.number);
  let n = 0;
  db.transaction(() => {
    for (const p of pools) {
      const s = state.get(p.pool_id); if (!s || s.sqrtPriceX96 === 0n) continue;
      const depth = depthHype(s.sqrtPriceX96, s.liquidity, !!p.token_is_c0);
      updDepth.run(depth, blk, p.pool_id);
      if (depth >= cfg.index.minLiquidityHype * 0.5) {
        insSample.run(p.pool_id, blk, ts, s.sqrtPriceX96.toString(), s.liquidity.toString(), priceHype(s.sqrtPriceX96, !!p.token_is_c0, p.dec), depth);
        n++;
      }
    }
  })();
  kvSet('v4:lastSampleTs', String(ts));
  if (full) await fillTokenMeta();
  return n;
}

const insSell = db.prepare('INSERT OR IGNORE INTO sells(pool_id,tx,seller,block) VALUES(?,?,?,?)');

/** Index sells (token paid into pool) for liquid candidate pools, recording tx.from. */
export async function indexSells(): Promise<number> {
  const head = await dataClient.getBlockNumber();
  const minBlock = Number(head) - Math.ceil((26 * 3600) / cfg.blockTimeSec);
  const pools = db.prepare('SELECT pool_id, token_is_c0 FROM pools WHERE launch_block > ? AND depth_hype >= ?').all(minBlock, cfg.index.minLiquidityHype * 0.9) as { pool_id: Hex; token_is_c0: number }[];
  if (!pools.length) return 0;
  const isC0 = new Map(pools.map((p) => [p.pool_id.toLowerCase(), !!p.token_is_c0]));
  let from = BigInt(kvGet('v4:swapBlock') ?? String(minBlock));
  let n = 0;
  const seenTx = new Map<string, string>();
  while (from <= head) {
    const to = from + cfg.swapLogChunk > head ? head : from + cfg.swapLogChunk;
    for (let i = 0; i < pools.length; i += 100) {
      const ids = pools.slice(i, i + 100).map((p) => p.pool_id);
      const logs = await dataClient.getLogs({ address: cfg.poolManager, event: SWAP, args: { id: ids }, fromBlock: from, toBlock: to });
      // v4 deltas are from the swapper's view: negative token amount = token paid into pool = a sell
      const sells = logs.filter((l) => { const a = l.args as any; return (isC0.get((a.id as string).toLowerCase()) ? a.amount0 : a.amount1) < 0n; });
      const need = [...new Set(sells.map((l) => l.transactionHash!))].filter((h) => !seenTx.has(h));
      for (let k = 0; k < need.length; k += 50) {
        const txs = await Promise.all(need.slice(k, k + 50).map((hash) => dataClient.getTransaction({ hash })));
        txs.forEach((tx) => seenTx.set(tx.hash, tx.from.toLowerCase()));
      }
      db.transaction(() => {
        for (const l of sells) { insSell.run(((l.args as any).id as string).toLowerCase(), l.transactionHash, seenTx.get(l.transactionHash!), Number(l.blockNumber)); n++; }
      })();
    }
    kvSet('v4:swapBlock', (to + 1n).toString());
    from = to + 1n;
  }
  return n;
}

/** First block with timestamp >= ts (binary search; exact and reproducible). */
export async function blockAtOrAfter(ts: number): Promise<bigint> {
  const cached = kvGet(`blk:${ts}`); if (cached) return BigInt(cached);
  const head = await dataClient.getBlock();
  if (Number(head.timestamp) < ts) throw new Error('timestamp in future');
  let lo = 1n, hi = head.number;
  let guess = head.number - BigInt(Math.floor((Number(head.timestamp) - ts) / cfg.blockTimeSec));
  if (guess < 1n) guess = 1n;
  // bracket around the estimate first to keep the search short
  for (let w = 2_000n; ; w *= 4n) {
    const a = guess - w < 1n ? 1n : guess - w, b = guess + w > head.number ? head.number : guess + w;
    const [ta, tb] = await Promise.all([dataClient.getBlock({ blockNumber: a }), dataClient.getBlock({ blockNumber: b })]);
    if (Number(ta.timestamp) < ts && Number(tb.timestamp) >= ts) { lo = a; hi = b; break; }
    if (a === 1n && b === head.number) break;
  }
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (Number((await dataClient.getBlock({ blockNumber: mid })).timestamp) >= ts) hi = mid; else lo = mid + 1n;
  }
  kvSet(`blk:${ts}`, lo.toString());
  return lo;
}
