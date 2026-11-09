import { parseEther, formatEther } from 'viem';
import { state, api, esc, fmtHype, fmtPct, fmtUsd, fmtPrice, dur, nowSec, openRound, currentRound, roundStart, readRound, marketBlurb, connect, ensureChain, contractRef, toast, modal, LS, explorerTx, short, explorerAddr, STATUS, onChange } from '../lib';
import { winMultiple, loseMultiple, applyFunding, DEFAULT_PARAMS } from '../../../keeper/src/payout';
import { skewBar, notDeployed, toParams } from './markets';

export async function renderMarket(root: HTMLElement, id: number) {
  const cfg = state.cfg!;
  const m = cfg.markets.find((x) => x.id === id);
  if (!m) { root.innerHTML = '<div class="empty"><h4>Unknown market</h4></div>'; return; }
  let side: 'long' | 'short' = 'short';

  root.innerHTML = `
  <div class="section row between wrap" style="margin-top:28px">
    <div><div class="row"><h1 style="font-size:30px;font-family:var(--mono)">${esc(m.name)}</h1>${m.legs.length > 1 ? '<span class="tag">Pair</span>' : '<span class="tag tag-accent">Index</span>'}</div>
    <p class="muted" style="margin-top:6px;max-width:640px">${esc(marketBlurb(m))}</p></div>
    <div class="row gap-lg">
      <div><div class="small muted">Live round</div><div class="mono" id="cur-round">—</div></div>
      <div><div class="small muted">Ends in</div><div class="mono countdown" id="cur-end">—</div></div>
    </div>
  </div>
  ${!cfg.contract ? notDeployed() : ''}
  <div class="grid-main">
    <div>
      <div class="card">
        <div class="card-head"><h3>Live index · current round</h3><span class="small muted" id="live-meta"></span></div>
        <div class="card-pad" id="live-body"><div class="skeleton"></div></div>
      </div>
      <div class="card mt-lg">
        <div class="card-head"><h3>Constituents</h3><span class="small muted">Frozen at round start · weights capped at ${(cfg.index.maxWeight * 100).toFixed(0)}%</span></div>
        <div class="table-wrap" id="cons"></div>
      </div>
      <div class="card mt-lg">
        <div class="card-head"><h3>Excluded this round</h3><span class="small muted">Liquidity &lt; ${fmtUsd(cfg.index.minLiquidityUsd)}, &lt; ${cfg.index.minSellers24h} sellers/24h, unsellable, or missing price</span></div>
        <div class="table-wrap" id="excl"></div>
      </div>
      <div class="card mt-lg">
        <div class="card-head"><h3>Recent rounds</h3><a class="small muted" href="#/history/${m.id}">All rounds →</a></div>
        <div class="table-wrap" id="recent"></div>
      </div>
    </div>
    <aside class="sticky">
      <div class="card card-pad" id="deposit"></div>
      <div class="card mt" id="positions"></div>
    </aside>
  </div>`;

  const t = state.timing;
  const tick = () => {
    if (!t) return;
    const cr = currentRound();
    const a = root.querySelector('#cur-round'); if (a) a.textContent = cr >= 0 ? '#' + cr : 'not started';
    const b = root.querySelector('#cur-end'); if (b) b.textContent = dur(roundStart(Math.max(cr, -1) + 1) - nowSec());
    const lk = root.querySelector('#lock-cd'); if (lk) lk.textContent = dur(roundStart(openRound()) - t.lockBuffer - nowSec());
  };
  tick();
  const iv = setInterval(tick, 1000);

  // ---------------- live index
  async function loadLive() {
    const body = root.querySelector('#live-body')!;
    if (!t) { body.innerHTML = `<div class="empty"><h4>No round schedule</h4>The contract isn't configured, so there is no round clock to anchor the index to.</div>`; root.querySelector('#cons')!.innerHTML = ''; root.querySelector('#excl')!.innerHTML = ''; return; }
    const live = await api(`/api/live/${m!.id}?genesis=${t.genesis}&duration=${t.duration}`).catch(() => null);
    if (!live || !live.snapshot) {
      body.innerHTML = `<div class="empty"><h4>No snapshot for this round yet</h4>The keeper freezes the constituent list when a round starts. ${cfg.data.geckoNetwork ? '' : 'No price source is configured yet (<code>GECKO_NETWORK</code>), so nothing is tracked.'}</div>`;
      root.querySelector('#cons')!.innerHTML = '<div class="empty">—</div>'; root.querySelector('#excl')!.innerHTML = '<div class="empty">—</div>';
      return;
    }
    const r = live.liveRatio as number | null;
    body.innerHTML = `<div class="row between wrap">
      <div><div class="small muted">${m!.legs.length > 1 ? `${esc(m!.legs[0].name)} ÷ ${esc(m!.legs[1].name)} (weighted-median return)` : 'Weighted-median return since round start'}</div>
      <div class="big-num ${r == null ? '' : r > 1 ? 'up' : 'down'}">${r == null ? 'insufficient data' : fmtPct(r - 1)}</div>
      <div class="small muted">${r == null ? `Needs ≥ ${cfg.index.minConstituents} priced constituents per leg. A round without them resolves at 1.0 and everyone is refunded.` : r > 1 ? 'LONG is winning right now' : 'SHORT is winning right now'}</div></div>
      <div class="row gap-lg">${live.legs.map((l: any) => `<div><div class="small muted">${esc(l.name)}</div><div class="mono">${l.ratio ? fmtPct(l.ratio - 1) : '—'}</div><div class="small faint">${l.priced} priced</div></div>`).join('')}</div>
    </div>`;
    root.querySelector('#live-meta')!.textContent = `round #${live.roundId} · ${live.legs.reduce((a: number, l: any) => a + l.constituents.length, 0)} constituents`;
    const rows = live.legs.flatMap((l: any) => l.constituents.map((c: any) => ({ ...c, leg: l.name })))
      .sort((a: any, b: any) => (b.liveWeight ?? 0) - (a.liveWeight ?? 0));
    root.querySelector('#cons')!.innerHTML = rows.length ? `<table><thead><tr><th>Token</th>${m!.legs.length > 1 ? '<th>Leg</th>' : ''}<th>Launchpad</th><th class="num">Liquidity</th><th class="num">Weight</th><th class="num">Start</th><th class="num">Last</th><th class="num">Return</th></tr></thead><tbody>
      ${rows.map((c: any) => `<tr><td><a href="${explorerAddr(c.token)}" target="_blank" rel="noopener"><strong>${esc(c.symbol)}</strong> <span class="faint mono small">${short(c.token)}</span></a></td>${m!.legs.length > 1 ? `<td>${esc(c.leg)}</td>` : ''}
      <td><span class="tag">${esc(c.launchpad)}</span></td><td class="num">${fmtUsd(c.liquidityUsd)}</td><td class="num">${c.liveWeight != null ? (c.liveWeight * 100).toFixed(1) + '%' : '—'}</td>
      <td class="num">${fmtPrice(c.startPrice)}</td><td class="num">${fmtPrice(c.lastPrice)}</td><td class="num ${c.ret > 1 ? 'up' : c.ret < 1 ? 'down' : ''}">${c.ret ? fmtPct(c.ret - 1) : '—'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><h4>No eligible constituents</h4>No token launched in the last 24h passes the filters.</div>';
    const ex = live.legs.flatMap((l: any) => l.excluded);
    root.querySelector('#excl')!.innerHTML = ex.length ? `<table><thead><tr><th>Token</th><th>Launchpad</th><th class="num">Liquidity</th><th class="num">Sellers 24h</th><th>Reason</th></tr></thead><tbody>
      ${ex.slice(0, 100).map((c: any) => `<tr><td>${esc(c.symbol)} <span class="faint mono small">${short(c.token)}</span></td><td>${esc(c.launchpad)}</td><td class="num">${fmtUsd(c.liquidityUsd)}</td><td class="num">${c.sellers24h}</td><td><span class="tag tag-warn">${esc(c.excludeReason)}</span></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nothing excluded.</div>';
  }

  // ---------------- recent rounds
  async function loadRecent() {
    const el = root.querySelector('#recent')!;
    const rows = await api<any[]>(`/api/results/${m!.id}`).catch(() => []);
    el.innerHTML = rows.length ? `<table><thead><tr><th>Round</th><th class="num">Result</th><th>Outcome</th><th>Proof</th></tr></thead><tbody>
      ${rows.slice(0, 8).map((r) => { const x = Number(r.result_e18) / 1e18; return `<tr><td class="mono">#${r.round_id}</td><td class="num ${x > 1 ? 'up' : x < 1 ? 'down' : ''}">${fmtPct(x - 1)}</td>
      <td>${x === 1 ? '<span class="tag tag-warn">refund</span>' : x > 1 ? '<span class="tag tag-long">long</span>' : '<span class="tag tag-short">short</span>'}</td><td><a class="small" href="#/round/${m!.id}/${r.round_id}">verify →</a></td></tr>`; }).join('')}</tbody></table>`
      : '<div class="empty">No rounds computed yet.</div>';
  }

  // ---------------- deposit panel
  async function loadDeposit() {
    const el = root.querySelector('#deposit')!;
    if (!cfg.contract || !t) { el.innerHTML = `<h3>Deposit</h3><p class="muted mt">Deposits open once the contract is deployed and configured.</p>`; return; }
    if (state.geo?.blocked) { el.innerHTML = `<h3>Deposit</h3><div class="notice notice-bad mt">SLOPX is not available in your region (${esc(state.geo.country)}).</div>`; return; }
    const r = openRound();
    const rd = await readRound(m!.id, r);
    const p = rd.paramsSet ? toParams(rd.params) : DEFAULT_PARAMS;
    let mine = { l: 0n, s: 0n }, bal = 0n;
    if (state.account) {
      const [st, b] = await Promise.all([
        state.client!.readContract({ ...contractRef(), functionName: 'stakeOf', args: [BigInt(m!.id), BigInt(r), state.account] }) as Promise<readonly [bigint, bigint]>,
        state.client!.getBalance({ address: state.account }),
      ]);
      mine = { l: st[0], s: st[1] }; bal = b;
    }
    const lim = state.limits!;
    const room = lim.maxWallet - mine.l - mine.s;
    const [eL, eS] = applyFunding(rd.longTotal, rd.shortTotal, p);
    const fundRate = rd.longTotal + rd.shortTotal > 0n ? Number((rd.shortTotal > rd.longTotal ? rd.shortTotal - eS : rd.longTotal - eL)) / Number(rd.shortTotal > rd.longTotal ? rd.shortTotal : rd.longTotal || 1n) : 0;
    el.innerHTML = `
      <div class="row between"><h3>Round #${r}</h3><span class="small muted">locks in <span class="countdown" id="lock-cd">—</span></span></div>
      ${lim.paused ? '<div class="notice notice-bad mt">Paused: deposits disabled.</div>' : ''}
      ${skewBar(rd.longTotal, rd.shortTotal)}
      <div class="small muted">Funding right now: <span class="${rd.shortTotal > rd.longTotal ? 'down' : 'up'}">${fundRate ? `${rd.shortTotal > rd.longTotal ? 'shorts' : 'longs'} pay ${(fundRate * 100).toFixed(2)}%` : 'none (balanced or empty)'}</span></div>
      <div class="side-toggle mt"><button data-s="long">Long ↑</button><button data-s="short">Short ↓</button></div>
      <div class="field"><label><span>Amount</span><span>${state.account ? `Balance ${fmtHype(bal)} HYPE` : ''}</span></label>
        <div class="input"><input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off" /><span class="unit">HYPE</span></div>
        <div class="chips">${['0.1', '0.5', '1', '5'].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div></div>
      <div class="preview" id="pv"></div>
      <div class="small muted mt">Min ${fmtHype(lim.minDeposit)} · max ${fmtHype(lim.maxWallet)} per wallet per round (room left ${fmtHype(room > 0n ? room : 0n)}) · side cap ${fmtHype(lim.maxSide)}</div>
      <button class="btn btn-block mt" id="go"></button>
      <p class="small faint mt">Unaudited contract. You may lose your entire deposit.</p>`;
    const amtEl = el.querySelector('#amt') as HTMLInputElement;
    const go = el.querySelector('#go') as HTMLButtonElement;
    const setSide = (s: 'long' | 'short') => {
      side = s;
      el.querySelectorAll('.side-toggle button').forEach((b) => (b as HTMLElement).className = (b as HTMLElement).dataset.s === s ? 'on-' + s : '');
      update();
    };
    const update = () => {
      let a = 0n; try { a = amtEl.value ? parseEther(amtEl.value as `${number}`) : 0n; } catch { a = -1n; }
      const L = rd.longTotal + (side === 'long' && a > 0n ? a : 0n), S = rd.shortTotal + (side === 'short' && a > 0n ? a : 0n);
      const pv = el.querySelector('#pv')!;
      if (a > 0n) {
        const one = L === 0n || S === 0n;
        const w = winMultiple(L, S, side, p), lo = loseMultiple(L, S, side, p);
        pv.innerHTML = one ? `<div class="small muted">The other side is empty right now. If it stays empty, the round is refunded in full.</div>` :
          `<dl class="kv"><dt>If ${side} wins</dt><dd class="up">${(Number(formatEther(a)) * w).toFixed(4)} HYPE (${w.toFixed(2)}×)</dd>
           <dt>If ${side} loses</dt><dd class="down">${(Number(formatEther(a)) * lo).toFixed(4)} HYPE</dd>
           <dt>Fee on winnings</dt><dd>${Number(p.feeBps) / 100}%</dd></dl>
           <div class="small faint" style="margin-top:6px">Based on the pool as it stands now. Final odds lock when deposits close.</div>`;
      } else pv.innerHTML = `<div class="small muted">Enter an amount to preview payouts.</div>`;
      if (!state.account) { go.textContent = 'Connect wallet'; go.className = 'btn btn-primary btn-block mt'; go.disabled = false; return; }
      go.className = `btn btn-block mt btn-${side}`; go.textContent = `${side === 'long' ? 'Long' : 'Short'} round #${r}`;
      go.disabled = lim.paused || a < lim.minDeposit || a > room || a > bal;
      if (a > room && a > 0n) go.textContent = 'Exceeds per-wallet cap';
      else if (a > bal) go.textContent = 'Insufficient balance';
    };
    el.querySelectorAll('.side-toggle button').forEach((b) => b.addEventListener('click', () => setSide((b as HTMLElement).dataset.s as any)));
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { amtEl.value = (b as HTMLElement).dataset.v!; update(); }));
    amtEl.addEventListener('input', update);
    go.addEventListener('click', async () => {
      if (!state.account) return connect();
      if (!(await acknowledge())) return;
      try {
        go.disabled = true; go.textContent = 'Confirm in wallet…';
        await ensureChain();
        const { request } = await state.client!.simulateContract({ ...contractRef(), functionName: 'deposit', args: [BigInt(m!.id), BigInt(r), side === 'long' ? 0 : 1], value: parseEther(amtEl.value as `${number}`), account: state.account });
        const hash = await state.wallet!.writeContract(request as any);
        go.textContent = 'Waiting for confirmation…';
        await state.client!.waitForTransactionReceipt({ hash });
        toast(`Deposit confirmed · ${hash.slice(0, 10)}…`, 'ok');
        loadDeposit(); loadPositions();
      } catch (e: any) {
        toast(e?.shortMessage ?? e?.message ?? 'Transaction failed', 'err');
        update();
      }
    });
    setSide(side);
  }

  // ---------------- positions & claims
  async function loadPositions() {
    const el = root.querySelector('#positions')!;
    if (!cfg.contract || !t) { el.innerHTML = ''; return; }
    if (!state.account) { el.innerHTML = `<div class="card-head"><h3>Your positions</h3></div><div class="empty">Connect a wallet to see positions and claims.</div>`; return; }
    const cur = Math.max(0, openRound());
    const ids = Array.from({ length: Math.min(cur + 1, 48) }, (_, i) => cur - i);
    const calls = ids.flatMap((r) => [
      { ...contractRef(), functionName: 'stakeOf', args: [BigInt(m!.id), BigInt(r), state.account!] },
      { ...contractRef(), functionName: 'claimable', args: [BigInt(m!.id), BigInt(r), state.account!] },
      { ...contractRef(), functionName: 'rounds', args: [BigInt(m!.id), BigInt(r)] },
      { ...contractRef(), functionName: 'claimed', args: [BigInt(m!.id), BigInt(r), state.account!] },
    ]);
    let res: any[];
    try { res = (await state.client!.multicall({ contracts: calls as any, allowFailure: false })) as unknown as any[]; }
    catch { res = await Promise.all(calls.map((c) => state.client!.readContract(c as any))); }
    const rows = ids.map((r, i) => ({ r, stake: res[i * 4], claimable: res[i * 4 + 1] as bigint, round: res[i * 4 + 2], claimed: res[i * 4 + 3] as boolean }))
      .filter((x) => x.stake[0] > 0n || x.stake[1] > 0n);
    el.innerHTML = `<div class="card-head"><h3>Your positions</h3><span class="small faint">last 48 rounds</span></div>` + (rows.length ? `<div class="table-wrap"><table><thead><tr><th>Round</th><th class="num">Long</th><th class="num">Short</th><th>Status</th><th class="num"></th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td class="mono">#${x.r}</td><td class="num">${x.stake[0] ? fmtHype(x.stake[0]) : '—'}</td><td class="num">${x.stake[1] ? fmtHype(x.stake[1]) : '—'}</td>
        <td>${x.claimed ? '<span class="tag">claimed</span>' : `<span class="tag ${x.round[4] === 2 ? 'tag-warn' : ''}">${STATUS[x.round[4]]}</span>`}</td>
        <td class="num">${x.claimable > 0n ? `<button class="btn btn-sm btn-primary" data-claim="${x.r}">Claim ${fmtHype(x.claimable)}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">No positions in this market yet.</div>');
    el.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', async () => {
      const r = Number((b as HTMLElement).dataset.claim);
      try {
        (b as HTMLButtonElement).disabled = true;
        await ensureChain();
        const { request } = await state.client!.simulateContract({ ...contractRef(), functionName: 'claim', args: [BigInt(m!.id), BigInt(r)], account: state.account! });
        const hash = await state.wallet!.writeContract(request as any);
        await state.client!.waitForTransactionReceipt({ hash });
        toast('Claimed', 'ok'); loadPositions();
      } catch (e: any) { toast(e?.shortMessage ?? e?.message, 'err'); (b as HTMLButtonElement).disabled = false; }
    }));
  }

  await Promise.all([loadLive(), loadRecent(), loadDeposit(), loadPositions()].map((p) => p.catch((e) => console.error(e))));
  const liveIv = setInterval(() => { loadLive().catch(() => {}); }, 30_000);
  const off = onChange(() => { loadDeposit(); loadPositions(); });
  return () => { clearInterval(iv); clearInterval(liveIv); off(); };
}

export function acknowledge(): Promise<boolean> {
  if (LS.get('slopx-ack-v1') === 'yes') return Promise.resolve(true);
  return new Promise((resolve) => {
    modal(`<h2>Before you deposit</h2>
      <p class="muted">SLOPX is experimental, unaudited software that works like a bet. Please confirm:</p>
      <label class="check"><input type="checkbox" /> I understand I can lose my entire deposit.</label>
      <label class="check"><input type="checkbox" /> I understand results are posted by a keeper I have to trust, subject to a dispute window. See the <a href="#/docs/trust" class="up">trust model</a>.</label>
      <label class="check"><input type="checkbox" /> I am not in a restricted region, and it is legal for me to use this where I live.</label>
      <label class="check"><input type="checkbox" /> I have read the <a href="#/terms" class="up">Terms &amp; Risk</a> page.</label>
      <div class="row mt-lg" style="justify-content:flex-end"><button class="btn btn-ghost" id="no">Cancel</button><button class="btn btn-primary" id="yes" disabled>I agree</button></div>`,
    (root, close) => {
      const boxes = [...root.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];
      const yes = root.querySelector('#yes') as HTMLButtonElement;
      boxes.forEach((b) => b.addEventListener('change', () => (yes.disabled = !boxes.every((x) => x.checked))));
      root.querySelector('#no')!.addEventListener('click', () => { close(); resolve(false); });
      yes.addEventListener('click', () => { LS.set('slopx-ack-v1', 'yes'); close(); resolve(true); });
    });
  });
}

export { explorerTx };
