import dotenv from 'dotenv';
// .env lives at the repo root (gitignored). Real env vars (e.g. Replit Secrets) take precedence.
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });
import { readFileSync, existsSync } from 'node:fs';
import { defineChain, type Address } from 'viem';
import { DEFAULT_INDEX_CONFIG, type IndexConfig } from './indexMath.js';

const env = (k: string, d?: string) => process.env[k] || d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

// Verified 2026-11-09 via eth_chainId: mainnet rpc.elysium.kinetiq.xyz -> 99901, testnet -> 99801.
// viem ships an unrelated `elysiumTestnet` (Vulcan Forged); Kinetiq's Elysium is defined here.
export const ELYSIUM_MAINNET = { id: 99901, rpc: 'https://rpc.elysium.kinetiq.xyz' };
export const ELYSIUM_TESTNET = { id: 99801, rpc: 'https://testnet-rpc.elysium.kinetiq.xyz', explorer: 'https://explorer-elysium-testnet.t.conduit.xyz' };

/** Settlement chain: where SlopxPools lives. */
export const chain = defineChain({
  id: num('CHAIN_ID', ELYSIUM_TESTNET.id),
  name: env('CHAIN_NAME', 'Elysium Testnet')!,
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [env('RPC_URL', ELYSIUM_TESTNET.rpc)!] } },
  blockExplorers: { default: { name: 'Explorer', url: env('EXPLORER_URL', ELYSIUM_TESTNET.explorer)! } },
});

/** Data chain: where launches and prices are read (Elysium mainnet; testnet has no Uniswap v4). */
export const dataChain = defineChain({
  id: num('DATA_CHAIN_ID', ELYSIUM_MAINNET.id),
  name: 'Elysium',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [env('DATA_RPC_URL', ELYSIUM_MAINNET.rpc)!] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export interface LaunchpadLabel {
  name: string;              // lowercase label, e.g. "montra"
  hooks: string[];           // v4 hook addresses VERIFIED to belong to this launchpad
  source?: string;           // where the address was verified
}

const lpFile = env('LAUNCHPADS_FILE', new URL('../launchpads.json', import.meta.url).pathname)!;
export const LAUNCHPADS: LaunchpadLabel[] = existsSync(lpFile)
  ? (JSON.parse(readFileSync(lpFile, 'utf8')) as LaunchpadLabel[]).map((l) => ({ ...l, hooks: (l.hooks ?? []).map((h) => h.toLowerCase()) }))
  : [];
export const labelForHook = (hook: string) => LAUNCHPADS.find((l) => l.hooks.includes(hook.toLowerCase()))?.name;

export interface MarketDef {
  id: number;
  name: string;
  /** 'all' = every launchpad-like hook; otherwise launchpad labels from launchpads.json */
  legs: { name: string; launchpads: string[] | 'all' }[];
}

export const MARKETS: MarketDef[] = JSON.parse(
  env('MARKETS_JSON') ??
    JSON.stringify([
      { id: 0, name: 'TRENCH24', legs: [{ name: 'All launches (24h)', launchpads: 'all' }] },
      { id: 1, name: 'MONTRA/ASCEND', legs: [{ name: 'Montra', launchpads: ['montra'] }, { name: 'Ascend', launchpads: ['ascend'] }] },
    ]),
);

export const cfg = {
  contract: env('CONTRACT_ADDRESS') as Address | undefined,
  keeperKey: env('KEEPER_PRIVATE_KEY') as `0x${string}` | undefined, // never logged
  dbPath: env('DB_PATH', new URL('../data/slopx.sqlite', import.meta.url).pathname)!,
  poolManager: env('POOL_MANAGER', '0xe2e105d3f7209a9da11f83ccf3e7398a753823f1') as Address,
  whype: env('WHYPE', '0xba876237b0f021a6c6d852d6c26e107997cc5e81') as Address,
  blockTimeSec: num('BLOCK_TIME_SEC', 0.105),
  logChunk: BigInt(num('LOG_CHUNK', 100_000)),
  swapLogChunk: BigInt(num('SWAP_LOG_CHUNK', 20_000)),
  sampleIntervalSec: num('SAMPLE_INTERVAL_SEC', 30),
  discoveryIntervalSec: num('DISCOVERY_INTERVAL_SEC', 120),
  port: num('PORT', 3000),
  keeperEnabled: env('KEEPER_ENABLED', 'false') === 'true',
  alertWebhook: env('ALERT_WEBHOOK_URL'),
  blockedRegions: (env('BLOCKED_REGIONS', 'US,GB,FR,SG,AU,CA-ON,KP,IR,SY,CU,RU,BY') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  startBlock: BigInt(env('START_BLOCK', '0')!),
  index: {
    ...DEFAULT_INDEX_CONFIG,
    minLiquidityHype: num('MIN_LIQUIDITY_HYPE', DEFAULT_INDEX_CONFIG.minLiquidityHype),
    minSellers24h: num('MIN_SELLERS_24H', DEFAULT_INDEX_CONFIG.minSellers24h),
    maxWeight: num('MAX_WEIGHT', DEFAULT_INDEX_CONFIG.maxWeight),
    minConstituents: num('MIN_CONSTITUENTS', DEFAULT_INDEX_CONFIG.minConstituents),
    launchpadMinLaunches: num('LAUNCHPAD_MIN_LAUNCHES', DEFAULT_INDEX_CONFIG.launchpadMinLaunches),
    sampleWindowSec: num('SAMPLE_WINDOW_SEC', DEFAULT_INDEX_CONFIG.sampleWindowSec), // keep default 300 in production
  } satisfies IndexConfig,
};
