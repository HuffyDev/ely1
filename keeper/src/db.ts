import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './config.js';

mkdirSync(dirname(cfg.dbPath), { recursive: true });
export const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const SCHEMA = 2;
db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
const ver = Number((db.prepare("SELECT v FROM kv WHERE k='schema'").get() as { v: string } | undefined)?.v ?? 0);
if (ver !== SCHEMA) {
  // v1 (GeckoTerminal-based) tables are incompatible; data is re-derived from chain.
  db.exec('DROP TABLE IF EXISTS tokens; DROP TABLE IF EXISTS samples; DROP TABLE IF EXISTS snapshots; DROP TABLE IF EXISTS results;');
  db.exec("DELETE FROM kv WHERE k LIKE 'v4:%' OR k LIKE 'factory:%'");
}

db.exec(`
CREATE TABLE IF NOT EXISTS pools (
  pool_id TEXT PRIMARY KEY, token TEXT NOT NULL, token_is_c0 INTEGER NOT NULL, quote TEXT NOT NULL,
  hooks TEXT NOT NULL, fee INTEGER, tick_spacing INTEGER, launch_block INTEGER NOT NULL, tx TEXT,
  depth_hype REAL DEFAULT 0, depth_block INTEGER, unsellable INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pools_launch ON pools(launch_block);
CREATE INDEX IF NOT EXISTS pools_token ON pools(token);
CREATE TABLE IF NOT EXISTS token_meta (token TEXT PRIMARY KEY, symbol TEXT, decimals INTEGER);
CREATE TABLE IF NOT EXISTS samples (
  pool_id TEXT NOT NULL, block INTEGER NOT NULL, ts INTEGER NOT NULL, sqrt_price_x96 TEXT NOT NULL,
  liquidity TEXT NOT NULL, price_hype REAL NOT NULL, depth_hype REAL NOT NULL, PRIMARY KEY (pool_id, block)
);
CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
CREATE TABLE IF NOT EXISTS sells (pool_id TEXT NOT NULL, tx TEXT NOT NULL, seller TEXT NOT NULL, block INTEGER NOT NULL, PRIMARY KEY (pool_id, tx));
CREATE INDEX IF NOT EXISTS sells_pool ON sells(pool_id, block);
CREATE TABLE IF NOT EXISTS snapshots (
  market_id INTEGER NOT NULL, round_id INTEGER NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (market_id, round_id)
);
CREATE TABLE IF NOT EXISTS results (
  market_id INTEGER NOT NULL, round_id INTEGER NOT NULL, json TEXT NOT NULL, data_hash TEXT NOT NULL,
  result_e18 TEXT NOT NULL, proposed_tx TEXT, settled_tx TEXT, created_at INTEGER NOT NULL,
  PRIMARY KEY (market_id, round_id)
);
CREATE TABLE IF NOT EXISTS events (
  tx TEXT NOT NULL, log_index INTEGER NOT NULL, block INTEGER NOT NULL, ts INTEGER, name TEXT NOT NULL,
  market_id INTEGER, round_id INTEGER, user TEXT, json TEXT NOT NULL, PRIMARY KEY (tx, log_index)
);
CREATE INDEX IF NOT EXISTS events_round ON events(market_id, round_id);
CREATE TABLE IF NOT EXISTS alerts (ts INTEGER NOT NULL, level TEXT NOT NULL, key TEXT NOT NULL, message TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS alerts_key ON alerts(key, ts);
`);
db.prepare("INSERT INTO kv(k,v) VALUES('schema',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(String(SCHEMA));

export const kvGet = (k: string) => (db.prepare('SELECT v FROM kv WHERE k=?').get(k) as { v: string } | undefined)?.v;
export const kvSet = (k: string, v: string) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);

/** Single-writer lease so two keeper processes can never act at once. */
export function acquireLease(owner: string, ttlSec: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  return db.transaction(() => {
    const cur = kvGet('keeper:lease');
    if (cur) { const [o, until] = cur.split('|'); if (o !== owner && Number(until) > now) return false; }
    kvSet('keeper:lease', `${owner}|${now + ttlSec}`);
    return true;
  })();
}
