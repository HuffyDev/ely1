import { state, api, esc, fmtHype, fmtPct, dur, nowSec, openRound, currentRound, roundStart, readRound, marketBlurb, ago } from '../lib';
import { winMultiple, DEFAULT_PARAMS, type Params } from '../../../keeper/src/payout';

export const toParams = (p: any): Params => p ? ({ feeBps: BigInt(p.feeBps ?? p[0]), maxProfitBps: BigInt(p.maxProfitBps ?? p[1]), fundingK: BigInt(p.fundingK ?? p[2]),
  fundingMaxBps: BigInt(p.fundingMaxBps ?? p[3]), fundingCapBps: BigInt(p.fundingCapBps ?? p[4]), tieBps: BigInt(p.tieBps ?? p[5]) }) : DEFAULT_PARAMS;

export function skewBar(L: bigint, S: bigint) {
  const tot = Number(L + S);
  const lp = tot ? (Number(L) / tot) * 100 : 50;
  return `<div class="skew"><div class="skew-bar"><div class="l" style="width:${lp}%"></div><div class="s" style="width:${100 - lp}%"></div></div>
  <div class="skew-legend"><span>Long ${fmtHype(L)} · ${tot ? lp.toFixed(0) + '%' : '—'}</span><span>${tot ? (100 - lp).toFixed(0) + '%' : '—'} · ${fmtHype(S)} Short</span></div></div>`;
}

export function notDeployed() {
  return `<div class="notice">No pool contract is configured on this deployment yet, so deposits are off. The index below is still live, read directly from Elysium.</div>`;
}

const signed = (r: number | null | undefined) => r == null ? '<span class="faint">—</span>' : `<span class="${r > 1 ? 'up' : r < 1 ? 'down' : ''}">${fmtPct(r - 1)}</span>`;

export async function renderMarkets(root: HTMLElement) {
  const cfg = state.cfg!;
  const t = state.timing;
  root.innerHTML = `
  <section class="hero fade-in">
    <h1>Bet against every coin launched on Elysium in the last 24 hours.</h1>
    <p class="sub">Hourly rounds. Winners are paid only from losers. A round with one side empty is refunded.</p>
    <div class="hero-index">
      <div class="label"><i class="dot" id="live-dot"></i><span>TRENCH24 · live index, this round</span></div>
      <div class="value" id="hero-val"><span class="faint">—</span></div>
      <div class="meta" id="hero-meta">Loading…</div>
      <div class="ls">
        <a class="btn btn-primary" href="#/market/0?side=long">Long</a>
        <a class="btn" href="#/market/0?side=short">Short</a>
      </div>
    </div>
  </section>

  ${!cfg.contract ? notDeployed() : ''}
  ${state.limits?.paused ? `<div class="notice notice-bad mt">The guardian has paused deposits. Claims and refunds still work.</div>` : ''}

  <section class="section">
    <div class="stats">
      <div class="stat"><div class="label">Next round opens to deposits</div><div class="value" id="st-round">—</div></div>
      <div class="stat"><div class="label">Deposits close in</div><div class="value countdown" id="st-lock">—</div></div>
      <div class="stat"><div class="label">Launches seen (24h, onchain)</div><div class="value">${cfg.data.launches24h.toLocaleString()}</div></div>
      <div class="stat"><div class="label">Last price sample</div><div class="value">${cfg.data.lastSample ? ago(cfg.data.lastSample) : '—'}</div></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Markets</h2><span class="sub">Pool sizes are read live from the contract</span></div>
    <div class="card">${cfg.markets.map((m) => `<a class="market" href="#/market/${m.id}" id="mk-${m.id}">
      <div><div class="row"><span class="name">${esc(m.name)}</span>${m.legs.length > 1 ? '<span class="tag">Pair</span>' : '<span class="tag tag-accent">Index</span>'}</div><div class="desc">${esc(marketBlurb(m))}</div></div>
      <div class="hide-sm"><div class="eyebrow">Live</div><div class="num" data-live>—</div></div>
      <div class="hide-sm"><div class="eyebrow">Pool (next round)</div><div class="num" data-pool>—</div></div>
      <div><div class="eyebrow">Long / Short pays</div><div class="num" data-odds>—</div></div>
      <div class="faint">→</div></a>`).join('')}</div>
  </section>

  <section class="section grid-3">
    <div class="card card-pad"><h3>No house</h3><p class="muted small mt">Winners split the losing side's deposits, minus a 2% fee. The pool can never owe more than it holds.</p></div>
    <div class="card card-pad"><h3>Shorts are crowded, so shorts pay</h3><p class="muted small mt">The bigger side pays the smaller side up to ${(cfg.defaultParams.fundingMaxBps / 100).toFixed(1)}% of its stake, whatever the outcome. <a href="#/docs/funding" style="color:var(--accent)">Simulation →</a></p></div>
    <div class="card card-pad"><h3>Check every result</h3><p class="muted small mt">Each result commits a hash onchain. It covers every constituent, sample block and weight, so anyone can recompute it.</p></div>
  </section>`;

  const tick = () => {
    if (!t) return;
    const r = openRound();
    const a = root.querySelector('#st-round'); if (a) a.textContent = '#' + r;
    const b = root.querySelector('#st-lock'); if (b) b.textContent = dur(roundStart(r) - t.lockBuffer - nowSec());
  };
  tick();
  const iv = setInterval(tick, 1000);

  async function loadLive() {
    const val = root.querySelector('#hero-val')!, meta = root.querySelector('#hero-meta')!, dot = root.querySelector('#live-dot')!;
    if (!t) { val.innerHTML = '<span class="faint">—</span>'; meta.textContent = cfg.contract ? 'Contract unreachable' : 'Waiting for the pool contract (round clock).'; return; }
    const lives = await Promise.all(cfg.markets.map((m) => api(`/api/live/${m.id}?genesis=${t.genesis}&duration=${t.duration}`).catch(() => null)));
    const l0 = lives[0];
    if (!l0?.snapshot) { val.innerHTML = '<span class="faint">No data yet</span>'; meta.textContent = `Round #${Math.max(0, currentRound())} has no constituent snapshot yet. The keeper takes it at round start.`; }
    else {
      const r = l0.liveRatio as number | null;
      val.innerHTML = r == null ? '<span class="faint">Too few coins</span>' : signed(r);
      dot.className = 'dot live';
      const leg = l0.legs[0];
      meta.textContent = r == null ? `${leg.priced} priced of ${leg.eligible} eligible. A round needs ≥ ${cfg.index.minConstituents}, otherwise it refunds.`
        : `${leg.priced} constituents · ends in ${dur(l0.end - nowSec())} · ${r < 1 ? 'shorts ahead' : r > 1 ? 'longs ahead' : 'flat so far'}`;
    }
    cfg.markets.forEach((m, i) => { const el = root.querySelector(`#mk-${m.id} [data-live]`); if (el) el.innerHTML = lives[i]?.snapshot ? signed(lives[i].liveRatio) : '<span class="faint">no data</span>'; });
  }

  async function loadPools() {
    if (!cfg.contract || !t) return;
    const r = openRound();
    await Promise.all(cfg.markets.map(async (m) => {
      const card = root.querySelector(`#mk-${m.id}`)!;
      try {
        const rd = await readRound(m.id, r);
        const p = rd.paramsSet ? toParams(rd.params) : DEFAULT_PARAMS;
        card.querySelector('[data-pool]')!.textContent = `${fmtHype(rd.longTotal)} / ${fmtHype(rd.shortTotal)}`;
        const one = rd.longTotal === 0n || rd.shortTotal === 0n;
        card.querySelector('[data-odds]')!.innerHTML = one ? '<span class="faint" style="font-family:var(--sans);font-size:12px">no opposing side yet</span>'
          : `${winMultiple(rd.longTotal, rd.shortTotal, 'long', p).toFixed(2)}× / ${winMultiple(rd.longTotal, rd.shortTotal, 'short', p).toFixed(2)}×`;
      } catch { card.querySelector('[data-pool]')!.innerHTML = '<span class="down">RPC error</span>'; }
    }));
  }

  await Promise.all([loadLive(), loadPools()].map((p) => p.catch(console.error)));
  const liv = setInterval(() => { loadLive().catch(() => {}); loadPools().catch(() => {}); }, 30_000);
  return () => { clearInterval(iv); clearInterval(liv); };
}
