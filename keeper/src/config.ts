import dotenv from 'dotenv';
// .env lives at the repo root (gitignored). Real env vars (e.g. Replit Secrets) take precedence.
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });
import { readFileSync, existsSync } from 'node:fs';
import { defineChain } from 'viem';
import { DEFAULT_INDEX_CONFIG, type IndexConfig } from './indexMath.js';

const env = (k: string, d?: string) => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

// NOTE: viem ships an unrelated `elysiumTestnet` (Vulcan Forged). Kinetiq's Elysium is defined here.
// Testnet chain id 99801 is confirmed by public sources; mainnet id must be set via CHAIN_ID once
// Kinetiq publishes it (99901 is reported but UNVERIFIED).
export const chain = defineChain({
  id: num('CHAIN_ID', 99801),
  name: env('CHAIN_NAME', 'Elysium Testnet')!,
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: [env('RPC_URL', 'https://testnet-rpc.elysium.kinetiq.xyz')!] } },
  blockExplorers: { default: { name: 'Explorer', url: env('EXPLORER_URL', 'https://explorer-elysium-testnet.t.conduit.xyz')! } },
});

export interface MarketDef {
  id: number;
  name: string;
  /** one leg = index of launchpads; two legs = leg0 / leg1 ratio */
  legs: { name: string; launchpads: string[] | 'all' }[];
}

export const MARKETS: MarketDef[] = JSON.parse(
  env('MARKETS_JSON') ??
    JSON.stringify([
      { id: 0, name: 'TRENCH24', legs: [{ name: 'All launches (24h)', launchpads: 'all' }] },
      { id: 1, name: 'MONTRA/ASCEND', legs: [{ name: 'Montra', launchpads: ['montra'] }, { name: 'Ascend', launchpads: ['ascend'] }] },
    ]),
);

export interface LaunchpadSource {
  name: string;              // lowercase id, e.g. "montra"
  /** GeckoTerminal dex ids whose pools belong to this launchpad */
  geckoDexIds?: string[];
  /** onchain factory emitting a creation event, optional */
  factory?: `0x${string}`;
  event?: string;            // e.g. "event TokenCreated(address indexed token, address indexed creator)"
  tokenArg?: string;         // name of the token address arg
}

const lpFile = env('LAUNCHPADS_FILE', new URL('../launchpads.json', import.meta.url).pathname)!;
export const LAUNCHPADS: LaunchpadSource[] = existsSync(lpFile) ? JSON.parse(readFileSync(lpFile, 'utf8')) : [];

export const cfg = {
  contract: env('CONTRACT_ADDRESS') as `0x${string}` | undefined,
  keeperKey: env('KEEPER_PRIVATE_KEY') as `0x${string}` | undefined, // never logged
  dbPath: env('DB_PATH', new URL('../data/slopx.sqlite', import.meta.url).pathname)!,
  geckoNetwork: env('GECKO_NETWORK'),            // GeckoTerminal network slug for Elysium (unset until listed)
  geckoBase: env('GECKO_BASE', 'https://api.geckoterminal.com/api/v2')!,
  sampleIntervalSec: num('SAMPLE_INTERVAL_SEC', 30),
  discoveryIntervalSec: num('DISCOVERY_INTERVAL_SEC', 300),
  port: num('PORT', 3000),
  keeperEnabled: env('KEEPER_ENABLED', 'false') === 'true',
  blockedRegions: (env('BLOCKED_REGIONS', 'US,GB,FR,SG,AU,KP,IR,SY,CU,RU,BY') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  startBlock: BigInt(env('START_BLOCK', '0')!),
  index: {
    ...DEFAULT_INDEX_CONFIG,
    minLiquidityUsd: num('MIN_LIQUIDITY_USD', DEFAULT_INDEX_CONFIG.minLiquidityUsd),
    minSellers24h: num('MIN_SELLERS_24H', DEFAULT_INDEX_CONFIG.minSellers24h),
    maxWeight: num('MAX_WEIGHT', DEFAULT_INDEX_CONFIG.maxWeight),
    minConstituents: num('MIN_CONSTITUENTS', DEFAULT_INDEX_CONFIG.minConstituents),
  } satisfies IndexConfig,
};
