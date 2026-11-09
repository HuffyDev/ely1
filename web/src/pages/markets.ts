import { state, api, esc, fmtHype, fmtPct, dur, nowSec, openRound, roundStart, readRound, marketBlurb, ago } from '../lib';
import { winMultiple, DEFAULT_PARAMS, type Params } from '../../../keeper/src/payout';

export const toParams = (p: any): Params => p ? ({ feeBps: BigInt(p.feeBps ?? p[0]), maxProfitBps: BigInt(p.maxProfitBps ?? p[1]), fundingK: BigInt(p.fundingK ?? p[2]),
  fundingMaxBps: BigInt(p.fundingMaxBps ?? p[3]), fundingCapBps: BigInt(p.fundingCapBps ?? p[4]), tieBps: BigInt(p.tieBps ?? p[5]) }) : DEFAULT_PARAMS;

export function skewBar(L: bigint, S: bigint) {
  const tot = Number(L + S);
  const lp = tot ? (Number(L) / tot) * 100 : 50;
  return `<div class="skew"><div class="skew-bar"><div class="l" style="width:${lp}%"></div><div class="s" style="width:${100 - lp}%"></div></div>
  <div class="skew-legend"><span class="up">LONG ${fmtHype(L)} · ${tot ? lp.toFixed(0) : '—'}%</span><span class="down">${tot ? (100 - lp).toFixed(0) : '—'}% · ${fmtHype(S)} SHORT</span></div></div>`;
}

export function notDeployed() {
  return `<div class="notice notice-info">The pool contract is not configured on this deployment yet (<code>CONTRACT_ADDRESS</code> is unset), so there are no live pools. Index data below comes from the keeper when it is running.</div>`;
}

export async function renderMarkets(root: HTMLElement) {
  const cfg = state.cfg!;
  root.innerHTML = `
  <section class="hero">
    <div>
      <div class="kicker">Elysium · Hourly rounds · Pari-mutuel</div>
      <h1>Every coin here only goes one way.<br/>Now <span style="color:var(--short)">short all of them.</span></h1>
      <p class="lead">SLOPX runs hourly long/short pools on an index of every token launched on Elysium in the past 24 hours, plus launchpad-vs-launchpad pairs. Winners are paid only from losers' deposits. There is no leverage and no liquidations, and a round with one side empty is refunded.</p>
      <div class="row mt-lg wrap"><a class="btn btn-primary" href="#/market/0">Trade TRENCH24</a><a class="btn btn-ghost" href="#/docs">How it works</a></div>
    </div>
    <div class="stats" id="hero-stats">
      <div class="stat"><div class="label">Round open for deposits</div><div class="value" id="st-round">—</div></div>
      <div class="stat"><div class="label">Deposits close in</div><div class="value countdown" id="st-lock">—</div></div>
      <div class="stat"><div class="label">Tokens tracked (24h)</div><div class="value">${cfg.data.trackedTokens24h}</div></div>
      <div class="stat"><div class="label">Last price sample</div><div class="value">${cfg.data.lastSample ? ago(cfg.data.lastSample) : '—'}</div></div>
    </div>
  </section>
  ${!cfg.contract ? notDeployed() : ''}
  ${state.limits?.paused ? `<div class="notice notice-bad mt">Deposits are paused by the guardian. Claims and refunds still work.</div>` : ''}
  <section class="section">
    <div class="section-head"><h2>Markets</h2><span class="sub small">All pool numbers are read live from the contract.</span></div>
    <div class="grid-2" id="mk-grid">${cfg.markets.map((m) => `<a class="card market" href="#/market/${m.id}" id="mk-${m.id}">
      <div class="row between"><span class="name">${esc(m.name)}</span>${m.legs.length > 1 ? '<span class="tag">Pair</span>' : '<span class="tag tag-accent">Index</span>'}</div>
      <div class="desc">${esc(marketBlurb(m))}</div>
      <div data-pool><div class="skeleton" style="width:100%"></div></div>
      <dl class="kv mt" data-kv></dl></a>`).join('')}</div>
  </section>
  <section class="section grid-2">
    <div class="card card-pad"><h3>Payouts come from losers only</h3><p class="muted mt">The pool never owes more than it holds. Profit is capped at ${(cfg.defaultParams.maxProfitBps / 1e4).toFixed(0)}× the effective stake. If the cap binds, the excess goes back to the losing side.</p></div>
    <div class="card card-pad"><h3>The crowded side pays</h3><p class="muted mt">The side holding more money pays the other side a skew-based funding charge of up to ${(cfg.defaultParams.fundingMaxBps / 100).toFixed(1)}% of its stake, whatever the outcome. <a href="#/docs/funding" class="up">See the simulation →</a></p></div>
    <div class="card card-pad"><h3>Recomputable index</h3><p class="muted mt">Each round's constituents, price samples, weights and result are published, and their hash is posted onchain. You can check any result yourself, in the browser or with the CLI.</p></div>
    <div class="card card-pad"><h3>You can lose everything</h3><p class="muted mt">If your side loses, you lose most or all of your deposit. The contracts are unaudited and a keeper posts results. <a href="#/terms" class="down">Read the risks →</a></p></div>
  </section>`;

  const tick = () => {
    if (!state.timing) return;
    const r = openRound();
    const lockAt = roundStart(r) - state.timing.lockBuffer;
    const el = root.querySelector('#st-round'); if (el) el.textContent = '#' + r;
    const lk = root.querySelector('#st-lock'); if (lk) lk.textContent = dur(lockAt - nowSec());
  };
  tick();
  const iv = setInterval(tick, 1000);

  if (cfg.contract && state.timing) {
    const r = openRound();
    await Promise.all(cfg.markets.map(async (m) => {
      const card = root.querySelector(`#mk-${m.id}`)!;
      try {
        const [rd, live] = await Promise.all([readRound(m.id, r), api(`/api/live/${m.id}?genesis=${state.timing!.genesis}&duration=${state.timing!.duration}`).catch(() => null)]);
        const p = rd.paramsSet ? toParams(rd.params) : DEFAULT_PARAMS;
        card.querySelector('[data-pool]')!.innerHTML = skewBar(rd.longTotal, rd.shortTotal);
        const one = rd.longTotal === 0n || rd.shortTotal === 0n;
        card.querySelector('[data-kv]')!.innerHTML = `
          <dt>Round</dt><dd>#${r}</dd>
          <dt>Long wins pays</dt><dd class="up">${one ? 'refund if empty' : winMultiple(rd.longTotal, rd.shortTotal, 'long', p).toFixed(2) + '×'}</dd>
          <dt>Short wins pays</dt><dd class="down">${one ? 'refund if empty' : winMultiple(rd.longTotal, rd.shortTotal, 'short', p).toFixed(2) + '×'}</dd>
          <dt>Live index (current round)</dt><dd class="${live?.liveRatio > 1 ? 'up' : live?.liveRatio < 1 ? 'down' : ''}">${live?.liveRatio ? fmtPct(live.liveRatio - 1) : 'no data'}</dd>`;
      } catch (e) {
        card.querySelector('[data-pool]')!.innerHTML = `<div class="small down">RPC read failed: ${esc((e as Error).message.slice(0, 80))}</div>`;
      }
    }));
  } else {
    root.querySelectorAll('[data-pool]').forEach((e) => (e.innerHTML = '<div class="small muted">No contract configured.</div>'));
  }
  return () => clearInterval(iv);
}
