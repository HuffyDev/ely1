import { state, api, esc, fmtHype, fmtPct, dur, nowSec, openRound, currentRound, roundStart, readRound, marketBlurb, ago, padName } from '../lib';
import { winMultiple, DEFAULT_PARAMS, type Params } from '../../../keeper/src/payout';
import { reveal, countUp, retColor } from '../anim';

export const toParams = (p: any): Params => p ? ({ feeBps: BigInt(p.feeBps ?? p[0]), maxProfitBps: BigInt(p.maxProfitBps ?? p[1]), fundingK: BigInt(p.fundingK ?? p[2]),
  fundingMaxBps: BigInt(p.fundingMaxBps ?? p[3]), fundingCapBps: BigInt(p.fundingCapBps ?? p[4]), tieBps: BigInt(p.tieBps ?? p[5]) }) : DEFAULT_PARAMS;

export function skewBar(L: bigint, S: bigint) {
  const tot = Number(L + S);
  const lp = tot ? (Number(L) / tot) * 100 : 50;
  return `<div class="skew"><div class="skew-bar"><div class="l" style="width:${lp}%"></div><div class="s" style="width:${100 - lp}%"></div></div>
  <div class="skew-legend"><span>▲ LONG ${fmtHype(L)} · ${tot ? lp.toFixed(0) + '%' : '—'}</span><span>${tot ? (100 - lp).toFixed(0) + '%' : '—'} · ${fmtHype(S)} SHORT ▼</span></div></div>`;
}

export function notDeployed() {
  return `<div class="notice reveal">The pool contract isn't configured on this deployment yet, so betting is off. The index shown is live, read straight from Elysium.</div>`;
}

const pctFmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const cls = (r: number | null | undefined) => r == null || r === 1 ? '' : r > 1 ? 'up' : 'down';
const ICON = {
  bolt: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z"/></svg>',
  swords: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/></svg>',
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12l5 5L20 7"/></svg>',
};

export async function renderMarkets(root: HTMLElement) {
  const cfg = state.cfg!;
  const t = state.timing;
  const pairs = cfg.markets.filter((m) => m.legs.length > 1);
  root.innerHTML = `
  <section class="hero">
    <div class="reveal">
      <span class="badge"><b>LIVE</b> Hourly rounds on Elysium</span>
      <h1>Every coin here only goes <span class="strike">up</span> <span class="grad-text">one way.</span></h1>
      <p class="lead">Short <strong>every token launched in the last 24 hours</strong> in one bet. Or pit launchpads against each other. Winners are paid from losers, and every result can be checked onchain.</p>
      <div class="hero-ctas">
        <a class="btn btn-short btn-lg" href="#/market/0?side=short">▼ Short the trenches</a>
        <a class="btn btn-lg" href="#/market/0?side=long">▲ Long the trenches</a>
      </div>
      <div class="hero-proof">
        <span>${ICON.check} Paid from losers only</span><span>${ICON.check} One-sided rounds refund</span><span>${ICON.check} Every result recomputable</span>
      </div>
    </div>
    <div class="card index-panel glow-border reveal">
      <div class="top"><span class="label"><i class="dot" id="live-dot"></i>TRENCH24 · live this round</span><span class="tag" id="hero-round">—</span></div>
      <div class="big-val" id="hero-val">—</div>
      <div class="index-meta" id="hero-meta">Loading live index…</div>
      <div class="heat" id="heat"></div>
      <div class="heat-axis"><span>worst</span><span id="heat-n"></span><span>best</span></div>
      <div class="ls">
        <a class="btn btn-long" href="#/market/0?side=long"><span>▲ LONG<small id="pay-long">pays —</small></span></a>
        <a class="btn btn-short" href="#/market/0?side=short"><span>▼ SHORT<small id="pay-short">pays —</small></span></a>
      </div>
    </div>
  </section>

  <div class="ticker" id="ticker" hidden><div class="ticker-track" id="ticker-track"></div></div>

  ${!cfg.contract ? notDeployed() : ''}
  ${state.limits?.paused ? `<div class="notice notice-bad mt reveal">The guardian has paused deposits. Claims and refunds still work.</div>` : ''}

  <section class="stats stagger">
    <div class="stat"><div class="label">Next round</div><div class="value" id="st-round">—</div></div>
    <div class="stat"><div class="label">Betting closes in</div><div class="value countdown" id="st-lock">—</div></div>
    <div class="stat"><div class="label">Launches · 24h onchain</div><div class="value" id="st-launches">0</div></div>
    <div class="stat"><div class="label">Last price tick</div><div class="value">${cfg.data.lastSample ? ago(cfg.data.lastSample) : '—'}</div></div>
  </section>

  <section class="section">
    <div class="section-head reveal"><div><div class="kicker">Markets</div><h2>Pick your side</h2></div><span class="sub">Pool sizes and odds are live from the contract</span></div>
    <div class="markets stagger">${cfg.markets.map((m, i) => `<a class="card mcard lift" href="#/market/${m.id}" id="mk-${m.id}">
      <div class="art" style="background:${i === 0 ? 'var(--short)' : 'var(--violet)'}"></div>
      <div class="row between"><span class="tag ${m.legs.length > 1 ? '' : 'tag-accent'}">${m.legs.length > 1 ? '⚔ Launchpad war' : '🔥 Index'}</span><span class="small muted" data-pool>—</span></div>
      <div class="name mt">${esc(m.name)}</div>
      <div class="desc">${esc(marketBlurb(m))}</div>
      <div class="row between"><div><div class="small muted">Live this round</div><div class="live" data-live>—</div></div></div>
      <div data-skew></div>
      <div class="odds"><div><div class="k">Long pays</div><div class="v up" data-ol>—</div></div><div><div class="k">Short pays</div><div class="v down" data-os>—</div></div></div>
      <span class="cta">Open market →</span></a>`).join('')}</div>
  </section>

  <section class="section" id="heatmap-sec" hidden>
    <div class="section-head reveal"><div><div class="kicker">Inside the index</div><h2>This hour's trench, coin by coin</h2></div><a class="btn btn-sm" href="#/market/0">Full constituent list →</a></div>
    <div class="tiles stagger" id="tiles"></div>
  </section>

  <section class="section">
    <div class="section-head reveal"><div><div class="kicker">Why SLOPX</div><h2>Built for the trenches</h2></div></div>
    <div class="features stagger">
      <div class="card feature lift"><div class="ico" style="background:rgba(255,59,107,.15);color:var(--short)">${ICON.bolt}</div><h3>Short 24h of launches in one click</h3><p>No hunting for a coin to short. TRENCH24 bundles every new Elysium launch with real liquidity and real sellers into one live index.</p></div>
      <div class="card feature lift"><div class="ico" style="background:rgba(139,92,246,.15);color:var(--violet)">${ICON.swords}</div><h3>Launchpad vs launchpad</h3><p>Back one launchpad's coins against another's for the hour.${pairs.length ? '' : ' Pairs go live once launchpad addresses are verified.'}</p></div>
      <div class="card feature lift"><div class="ico" style="background:rgba(0,229,155,.15);color:var(--long)">${ICON.shield}</div><h3>No house, provable results</h3><p>Winners are paid only from losers. The bigger side pays funding to the smaller one. Every result commits a hash onchain that anyone can recompute.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head reveal"><div><div class="kicker">How it works</div><h2>One hour. Two sides. One winner.</h2></div><a class="btn btn-sm" href="#/trust">Rules &amp; risk →</a></div>
    <div class="steps stagger">
      <div class="card step lift"><h3>Pick a side</h3><p>Long or short the next hourly round. Betting closes 60s before it starts.</p></div>
      <div class="card step lift"><h3>Index freezes</h3><p>At the start, the coin list is locked and published.</p></div>
      <div class="card step lift"><h3>Result posts</h3><p>The keeper posts the result with a proof hash. There is a 10-minute dispute window.</p></div>
      <div class="card step lift"><h3>Winners claim</h3><p>Losers' deposits pay winners (2% fee). One side empty? Everyone is refunded.</p></div>
    </div>
  </section>`;
  reveal(root);

  const tick = () => {
    if (!t) return;
    const r = openRound();
    const a = root.querySelector('#st-round'); if (a) a.textContent = '#' + r;
    const b = root.querySelector('#st-lock'); if (b) b.textContent = dur(roundStart(r) - t.lockBuffer - nowSec());
  };
  tick();
  const iv = setInterval(tick, 1000);
  countUp(root.querySelector('#st-launches'), cfg.data.launches24h, (n) => Math.round(n).toLocaleString(), 1400);

  async function loadLive() {
    const val = root.querySelector('#hero-val')!, meta = root.querySelector('#hero-meta')!;
    if (!t) { val.innerHTML = '<span class="faint">—</span>'; meta.textContent = cfg.contract ? 'Contract unreachable.' : 'Waiting for the pool contract to start the round clock.'; return; }
    const lives = await Promise.all(cfg.markets.map((m) => api(`/api/live/${m.id}?genesis=${t.genesis}&duration=${t.duration}`).catch(() => null)));
    const l0 = lives[0];
    root.querySelector('#hero-round')!.textContent = 'Round #' + Math.max(0, currentRound());
    if (!l0?.snapshot) { val.innerHTML = '<span class="faint" style="font-size:40px">No data yet</span>'; meta.textContent = 'The keeper snapshots the constituents when the round starts.'; }
    else {
      const r = l0.liveRatio as number | null;
      const leg = l0.legs[0];
      if (r == null) { val.innerHTML = '<span class="faint" style="font-size:40px">Too few coins</span>'; meta.textContent = `${leg.priced} priced. A round needs ${cfg.index.minConstituents} or more, otherwise it refunds.`; }
      else {
        val.className = 'big-val ' + cls(r);
        countUp(val, (r - 1) * 100, pctFmt);
        meta.textContent = `${leg.priced} coins · ends in ${dur(l0.end - nowSec())} · ${r < 1 ? 'shorts are winning' : r > 1 ? 'longs are winning' : 'dead flat so far'}`;
      }
      (root.querySelector('#live-dot') as HTMLElement).className = 'dot live';
      // heat strip + ticker + tiles from real constituents
      const cons = (leg.constituents as any[]).filter((c) => c.ret != null).sort((a, b) => a.ret - b.ret);
      const maxDev = Math.max(0.02, ...cons.map((c) => Math.abs(c.ret - 1)));
      root.querySelector('#heat')!.innerHTML = cons.map((c, i) => `<i title="${esc(c.symbol)} ${fmtPct(c.ret - 1)}" style="height:${12 + 88 * Math.abs(c.ret - 1) / maxDev}%;background:${retColor(c.ret)};animation-delay:${i * 18}ms"></i>`).join('');
      root.querySelector('#heat-n')!.textContent = `${cons.length} coins`;
      if (cons.length) {
        const items = [...cons].sort((a, b) => (b.liveWeight ?? 0) - (a.liveWeight ?? 0)).map((c) => `<span class="ticker-item"><b>${esc(c.symbol)}</b><span class="${cls(c.ret)}">${fmtPct(c.ret - 1)}</span><span class="faint">${esc(padName(c.launchpad))}</span></span>`).join('');
        root.querySelector('#ticker-track')!.innerHTML = items + items;
        (root.querySelector('#ticker') as HTMLElement).hidden = false;
        const tiles = [...cons].sort((a, b) => (b.liveWeight ?? 0) - (a.liveWeight ?? 0));
        root.querySelector('#tiles')!.innerHTML = tiles.map((c) => `<div class="tile" style="background:${retColor(c.ret, 0.55)}"><div class="s">${esc(c.symbol)}</div><div class="r ${cls(c.ret)}">${fmtPct(c.ret - 1)}</div><div class="w">weight ${((c.liveWeight ?? 0) * 100).toFixed(1)}%</div></div>`).join('');
        (root.querySelector('#heatmap-sec') as HTMLElement).hidden = false;
        reveal(root);
      }
    }
    cfg.markets.forEach((m, i) => {
      const el = root.querySelector(`#mk-${m.id} [data-live]`);
      if (!el) return;
      const r = lives[i]?.liveRatio;
      if (lives[i]?.snapshot && r != null) { el.className = 'live ' + cls(r); countUp(el, (r - 1) * 100, pctFmt); }
      else el.innerHTML = '<span class="faint" style="font-size:22px">no data yet</span>';
    });
  }

  async function loadPools() {
    if (!cfg.contract || !t) return;
    const r = openRound();
    await Promise.all(cfg.markets.map(async (m, i) => {
      const card = root.querySelector(`#mk-${m.id}`)!;
      try {
        const rd = await readRound(m.id, r);
        const p = rd.paramsSet ? toParams(rd.params) : DEFAULT_PARAMS;
        card.querySelector('[data-pool]')!.textContent = `Round #${r} · ${fmtHype(rd.longTotal + rd.shortTotal)} HYPE in`;
        card.querySelector('[data-skew]')!.innerHTML = skewBar(rd.longTotal, rd.shortTotal);
        const one = rd.longTotal === 0n || rd.shortTotal === 0n;
        const lw = one ? null : winMultiple(rd.longTotal, rd.shortTotal, 'long', p), sw = one ? null : winMultiple(rd.longTotal, rd.shortTotal, 'short', p);
        card.querySelector('[data-ol]')!.textContent = lw ? lw.toFixed(2) + '×' : 'be first';
        card.querySelector('[data-os]')!.textContent = sw ? sw.toFixed(2) + '×' : 'be first';
        if (i === 0) {
          root.querySelector('#pay-long')!.textContent = lw ? `pays ${lw.toFixed(2)}×` : 'empty side: be first';
          root.querySelector('#pay-short')!.textContent = sw ? `pays ${sw.toFixed(2)}×` : 'empty side: be first';
        }
      } catch { card.querySelector('[data-pool]')!.innerHTML = '<span class="down">RPC error</span>'; }
    }));
  }

  await Promise.all([loadLive(), loadPools()].map((p) => p.catch(console.error)));
  const liv = setInterval(() => { loadLive().catch(() => {}); loadPools().catch(() => {}); }, 30_000);
  return () => { clearInterval(iv); clearInterval(liv); };
}
