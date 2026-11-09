// Alerts: stored in SQLite (shown on /api/health and the site status), logged, and optionally
// POSTed to ALERT_WEBHOOK_URL (Discord/Slack-compatible {content,text}). De-duplicated per key/hour.
import { cfg } from './config.js';
import { db } from './db.js';

export type Level = 'info' | 'warn' | 'critical';

export async function alert(level: Level, key: string, message: string) {
  const now = Math.floor(Date.now() / 1000);
  const last = db.prepare('SELECT ts FROM alerts WHERE key=? ORDER BY ts DESC LIMIT 1').get(key) as { ts: number } | undefined;
  if (last && now - last.ts < 3600) return;
  db.prepare('INSERT INTO alerts(ts,level,key,message) VALUES(?,?,?,?)').run(now, level, key, message);
  console.log(new Date().toISOString(), `[ALERT:${level}] ${key}: ${message}`);
  if (cfg.alertWebhook) {
    try {
      await fetch(cfg.alertWebhook, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: `SLOPX ${level.toUpperCase()} — ${key}: ${message}`, text: `SLOPX ${level.toUpperCase()} — ${key}: ${message}` }) });
    } catch (e) { console.log('alert webhook failed:', (e as Error).message); }
  }
}

export function recentAlerts(limit = 50) {
  return db.prepare('SELECT ts,level,key,message FROM alerts ORDER BY ts DESC LIMIT ?').all(limit);
}
