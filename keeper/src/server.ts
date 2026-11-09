// HTTP server: JSON API (from SQLite) + static website (web/dist). Optionally runs the keeper
// in-process (KEEPER_ENABLED=true) so a single Replit deployment can host everything.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { cfg, chain, dataChain, MARKETS, LAUNCHPADS, labelForHook } from './config.js';
import { db, kvGet } from './db.js';
import { recentAlerts } from './alerts.js';
import { getSnapshot } from './rounds.js';
import { median, weightedIQM, cappedWeights, METHOD_VERSION, canonicalJson, priceHype } from './indexMath.js';
import { DEFAULT_PARAMS } from './payout.js';

const WEB = new URL('../../web/dist/', import.meta.url).pathname;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function country(req: IncomingMessage): string | undefined {
  const h = req.headers;
  const v = h['cf-ipcountry'] ?? h['x-vercel-ip-country'] ?? h['x-country-code'] ?? h['x-appengine-country'] ?? h['cloudfront-viewer-country'];
  return (Array.isArray(v) ? v[0] : v)?.toUpperCase();
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const now = () => Math.floor(Date.now() / 1000);

function liveLeg(leg: any, start: number) {
  // live return of each frozen constituent vs its start price, from real onchain samples only
  const last = db.prepare('SELECT block, ts, sqrt_price_x96, depth_hype FROM samples WHERE pool_id=? ORDER BY block DESC LIMIT 1');
  const startS = db.prepare('SELECT sqrt_price_x96 FROM samples WHERE pool_id=? AND ts > ? AND ts <= ?');
  const rows = leg.constituents.filter((c: any) => c.included).map((c: any) => {
    const sp = median((startS.all(c.pool, start - cfg.index.sampleWindowSec, start) as any[]).map((r) => priceHype(r.sqrt_price_x96, c.tokenIsC0, c.decimals)));
    const l = last.get(c.pool) as any;
    const lp = l ? priceHype(l.sqrt_price_x96, c.tokenIsC0, c.decimals) : null;
    return { ...c, startPrice: sp ?? null, lastPrice: lp, lastBlock: l?.block ?? null, lastTs: l?.ts ?? null, liveDepth: l?.depth_hype ?? null, ret: sp && lp ? lp / sp : null };
  });
  const priced = rows.filter((r: any) => r.ret !== null);
  const w = cappedWeights(priced.map((r: any) => r.liquidityHype), cfg.index.maxWeight);
  priced.forEach((r: any, i: number) => (r.liveWeight = w[i]));
  const ratio = priced.length >= cfg.index.minConstituents ? weightedIQM(priced.map((r: any) => r.ret), w) : undefined;
  return { name: leg.name, launchpads: leg.launchpads, ratio: ratio ?? null, priced: priced.length, eligible: rows.length, constituents: rows,
    excluded: leg.constituents.filter((c: any) => !c.included) };
}

async function api(req: IncomingMessage, res: ServerResponse, path: string, q: URLSearchParams) {
  if (path === '/api/health') {
    const lastSample = Number(kvGet('v4:lastSampleTs') ?? 0) || null;
    return json(res, 200, { ok: true, time: now(), lastSample, sampleAgeSec: lastSample ? now() - lastSample : null, poolManagerOk: kvGet('v4:ok') === '1', alerts: recentAlerts(20) });
  }
  if (path === '/api/geo') {
    const c = country(req);
    return json(res, 200, { country: c ?? null, blocked: !!c && cfg.blockedRegions.includes(c), detection: c ? 'header' : 'unavailable', blockedRegions: cfg.blockedRegions });
  }
  if (path === '/api/config') {
    const lastSample = Number(kvGet('v4:lastSampleTs') ?? 0) || null;
    const head = Number(kvGet('v4:initBlock') ?? 0);
    const minBlock = head - Math.ceil(86_400 / cfg.blockTimeSec);
    const launches24h = (db.prepare('SELECT COUNT(*) n FROM pools WHERE launch_block > ?').get(minBlock) as any).n;
    return json(res, 200, {
      chain: { id: chain.id, name: chain.name, rpc: chain.rpcUrls.default.http[0], explorer: chain.blockExplorers?.default.url },
      dataChain: { id: dataChain.id, poolManager: cfg.poolManager, whype: cfg.whype },
      contract: cfg.contract ?? null, markets: MARKETS, index: { method: METHOD_VERSION, ...cfg.index },
      labels: LAUNCHPADS.map((l) => ({ name: l.name, hooks: l.hooks, source: l.source ?? null })),
      defaultParams: Object.fromEntries(Object.entries(DEFAULT_PARAMS).map(([k, v]) => [k, Number(v)])),
      data: { lastSample, launches24h, keeperEnabled: cfg.keeperEnabled, poolManagerOk: kvGet('v4:ok') === '1' },
    });
  }
  let m;
  if ((m = path.match(/^\/api\/live\/(\d+)$/))) {
    const marketId = Number(m[1]);
    const g = Number(q.get('genesis')), d = Number(q.get('duration'));
    if (!(g > 0 && d > 0)) return json(res, 400, { error: 'genesis & duration required' });
    const roundId = Math.floor((now() - g) / d);
    const start = g + roundId * d;
    const snap = roundId >= 0 ? getSnapshot(marketId, roundId) : null;
    if (!snap) return json(res, 200, { marketId, roundId, start, end: start + d, snapshot: false, legs: [] });
    const legs = snap.legs.map((l: any) => liveLeg(l, start));
    const ratio = legs.length === 1 ? legs[0].ratio : legs[0].ratio && legs[1].ratio ? legs[0].ratio / legs[1].ratio : null;
    return json(res, 200, { marketId, roundId, start, end: start + d, snapshot: true, window: snap.window, hookCounts: snap.hookCounts, liveRatio: ratio, legs });
  }
  if (path === '/api/launchpads') {
    const head = Number(kvGet('v4:initBlock') ?? 0);
    const rows = db.prepare('SELECT hooks, COUNT(*) n, SUM(depth_hype >= ?) liquid FROM pools WHERE launch_block > ? GROUP BY hooks ORDER BY n DESC LIMIT 40')
      .all(cfg.index.minLiquidityHype, head - Math.ceil(86_400 / cfg.blockTimeSec)) as any[];
    return json(res, 200, rows.map((r) => ({ ...r, label: labelForHook(r.hooks) ?? null })));
  }
  if ((m = path.match(/^\/api\/results\/(\d+)$/))) {
    const rows = db.prepare('SELECT round_id, data_hash, result_e18, proposed_tx, settled_tx, created_at, json FROM results WHERE market_id=? ORDER BY round_id DESC LIMIT 200').all(Number(m[1])) as any[];
    return json(res, 200, rows.map(({ json: j, ...r }) => { const p = JSON.parse(j); return { ...r, note: p.note ?? null, legs: p.legs.map((l: any) => ({ name: l.name, ratio: l.ratio, count: l.count })) }; }));
  }
  if ((m = path.match(/^\/api\/result\/(\d+)\/(\d+)(\/raw)?$/))) {
    const row = db.prepare('SELECT json, data_hash FROM results WHERE market_id=? AND round_id=?').get(Number(m[1]), Number(m[2])) as any;
    if (!row) return json(res, 404, { error: 'not computed yet' });
    if (m[3]) {
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="slopx-${m[1]}-${m[2]}.json"`, 'access-control-allow-origin': '*' });
      return res.end(canonicalJson(JSON.parse(row.json)));
    }
    return json(res, 200, { dataHash: row.data_hash, computation: JSON.parse(row.json) });
  }
  if ((m = path.match(/^\/api\/events\/(\d+)$/))) {
    return json(res, 200, db.prepare('SELECT * FROM events WHERE market_id=? ORDER BY block DESC, log_index DESC LIMIT 300').all(Number(m[1])));
  }
  if ((m = path.match(/^\/api\/user\/(0x[0-9a-fA-F]{40})$/))) {
    return json(res, 200, db.prepare('SELECT * FROM events WHERE user=? ORDER BY block DESC LIMIT 300').all(m[1].toLowerCase()));
  }
  return json(res, 404, { error: 'not found' });
}

// Read-only JSON-RPC proxy for the browser. Write methods are rejected (wallets sign & send directly).
const RPC_ALLOW = new Set(['eth_call', 'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getLogs', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_estimateGas', 'eth_gasPrice', 'eth_getCode', 'net_version', 'eth_maxPriorityFeePerGas', 'eth_feeHistory']);
async function rpcProxy(req: IncomingMessage, res: ServerResponse) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 200_000) return json(res, 413, { error: 'too large' }); }
  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length > 50 || calls.some((c) => !RPC_ALLOW.has(c?.method))) return json(res, 403, { error: 'method not allowed' });
  const up = await fetch(chain.rpcUrls.default.http[0], { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  res.writeHead(up.status, { 'content-type': 'application/json' });
  res.end(await up.text());
}

function serveStatic(res: ServerResponse, path: string) {
  let file = normalize(join(WEB, path));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB, 'index.html');
  if (!existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain' }); return res.end('Website not built. Run: npm run build'); }
  const ext = extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/api/rpc' && req.method === 'POST') return await rpcProxy(req, res);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname, url.searchParams);
    return serveStatic(res, url.pathname);
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
});

server.listen(cfg.port, '0.0.0.0', () => console.log(`SLOPX server on :${cfg.port}`));
if (cfg.keeperEnabled) import('./keeper.js').then((k) => k.runKeeper());
process.on('SIGTERM', () => { server.close(); db.close(); process.exit(0); });
