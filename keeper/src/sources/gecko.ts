// GeckoTerminal adapter: discovery of new pools + batch price sampling.
// Elysium's network slug must be set in GECKO_NETWORK once GeckoTerminal lists it. Until then
// this adapter is inert and the site shows "no data" rather than anything invented.
import { cfg, LAUNCHPADS } from '../config.js';
import { db } from '../db.js';

async function gt(path: string): Promise<any> {
  const res = await fetch(`${cfg.geckoBase}${path}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} ${path}`);
  return res.json();
}

function launchpadFor(dexId: string): string | undefined {
  for (const lp of LAUNCHPADS) if (lp.geckoDexIds?.includes(dexId)) return lp.name;
  return undefined;
}

const upsert = db.prepare(`INSERT INTO tokens(token,pool,symbol,launchpad,launched_at,liquidity_usd,sellers_24h,updated_at)
VALUES(@token,@pool,@symbol,@launchpad,@launched_at,@liq,@sellers,@now)
ON CONFLICT(token) DO UPDATE SET liquidity_usd=excluded.liquidity_usd, sellers_24h=excluded.sellers_24h, updated_at=excluded.updated_at,
  pool=CASE WHEN excluded.liquidity_usd > tokens.liquidity_usd THEN excluded.pool ELSE tokens.pool END`);

/** Pull the newest pools (several pages) and record tokens launched in the last ~25h. */
export async function discover(): Promise<number> {
  if (!cfg.geckoNetwork) return 0;
  const now = Math.floor(Date.now() / 1000);
  let n = 0;
  for (let page = 1; page <= 10; page++) {
    const j = await gt(`/networks/${cfg.geckoNetwork}/new_pools?page=${page}&include=base_token,dex`);
    const tokens = new Map<string, any>((j.included ?? []).filter((x: any) => x.type === 'token').map((x: any) => [x.id, x]));
    let older = false;
    for (const p of j.data ?? []) {
      const a = p.attributes;
      const created = Math.floor(Date.parse(a.pool_created_at) / 1000);
      if (now - created > 25 * 3600) { older = true; continue; }
      const dexId: string = p.relationships?.dex?.data?.id ?? 'unknown';
      const baseId: string = p.relationships?.base_token?.data?.id;
      const tok = tokens.get(baseId);
      const address = (tok?.attributes?.address ?? baseId?.split('_').pop() ?? '').toLowerCase();
      if (!address) continue;
      upsert.run({
        token: address, pool: a.address.toLowerCase(), symbol: tok?.attributes?.symbol ?? a.name?.split(' / ')[0] ?? '?',
        launchpad: launchpadFor(dexId) ?? dexId, launched_at: created, liq: Number(a.reserve_in_usd ?? 0),
        sellers: Number(a.transactions?.h24?.sellers ?? 0), now,
      });
      n++;
    }
    if (older || (j.data ?? []).length === 0) break;
  }
  return n;
}

const insSample = db.prepare('INSERT OR IGNORE INTO samples(token,ts,price_usd) VALUES(?,?,?)');
const updLiq = db.prepare('UPDATE tokens SET liquidity_usd=?, sellers_24h=?, updated_at=? WHERE pool=?');

/** Sample prices for every tracked pool (batches of 30). */
export async function samplePrices(): Promise<number> {
  if (!cfg.geckoNetwork) return 0;
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare('SELECT token,pool FROM tokens WHERE launched_at > ?').all(now - 26 * 3600) as { token: string; pool: string }[];
  const byPool = new Map(rows.map((r) => [r.pool, r.token]));
  const pools = [...byPool.keys()];
  let n = 0;
  for (let i = 0; i < pools.length; i += 30) {
    const batch = pools.slice(i, i + 30);
    const j = await gt(`/networks/${cfg.geckoNetwork}/pools/multi/${batch.join(',')}`);
    db.transaction(() => {
      for (const p of j.data ?? []) {
        const a = p.attributes;
        const token = byPool.get(a.address.toLowerCase());
        const price = Number(a.base_token_price_usd);
        if (!token || !(price > 0)) continue;
        insSample.run(token, now, price);
        updLiq.run(Number(a.reserve_in_usd ?? 0), Number(a.transactions?.h24?.sellers ?? 0), now, a.address.toLowerCase());
        n++;
      }
    })();
    await new Promise((r) => setTimeout(r, 2100)); // public API ~30 req/min
  }
  return n;
}
