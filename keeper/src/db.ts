import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cfg } from './config.js';

mkdirSync(dirname(cfg.dbPath), { recursive: true });
export const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY, pool TEXT NOT NULL, symbol TEXT, launchpad TEXT NOT NULL,
  launched_at INTEGER NOT NULL, liquidity_usd REAL DEFAULT 0, sellers_24h INTEGER DEFAULT 0,
  unsellable INTEGER DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_launched ON tokens(launched_at);
CREATE TABLE IF NOT EXISTS samples (
  token TEXT NOT NULL, ts INTEGER NOT NULL, price_usd REAL NOT NULL, PRIMARY KEY (token, ts)
);
CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
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
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

export const kvGet = (k: string) => (db.prepare('SELECT v FROM kv WHERE k=?').get(k) as { v: string } | undefined)?.v;
export const kvSet = (k: string, v: string) => db.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v);
