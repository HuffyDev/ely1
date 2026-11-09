import { parseEther, formatEther } from 'viem';
import { state, api, esc, fmtHype, fmtPct, fmtH, padName, ELYSIUM_EXPLORER, fmtPrice, dur, nowSec, openRound, currentRound, roundStart, readRound, marketBlurb, connect, ensureChain, contractRef, toast, modal, LS, explorerTx, short, explorerAddr, STATUS, onChange } from '../lib';
import { winMultiple, loseMultiple, applyFunding, DEFAULT_PARAMS } from '../../../keeper/src/payout';
import { skewBar, notDeployed, toParams } from './markets';
import { reveal, countUp, confetti, retColor } from '../anim';

export async function renderMarket(root: HTMLElement, id: number) {
  const cfg = state.cfg!;
  const m = cfg.markets.find((x) => x.id === id);
  if (!m) { root.innerHTML = '<div class="empty"><h4>Unknown market</h4></div>'; return; }
  const qs = new URLSearchParams(location.hash.split('?')[1] ?? '');
  let side: 'long' | 'short' = qs.get('side') === 'long' ? 'long' : 'short';

  root.innerHTML = `
  <div class="mhead reveal">
    <div><span class="tag ${m.legs.length > 1 ? '' : 'tag-accent'}">${m.legs.length > 1 ? '⚔ Launchpad war' : '🔥 Index'}</span>
    <h1 class="mt">${esc(m.name)}</h1>
    <p class="muted" style="margin:6px 0 0;max-width:640px;font-size:15px">${esc(marketBlurb(m))}</p></div>
    <div class="timer">
      <div><div class="k">Live round</div><div class="v" id="cur-round">—</div></div>
      <div><div class="k">Ends in</div><div class="v countdown" id="cur-end">—</div></div>
    </div>
  </div>
  ${!cfg.contract ? notDeployed() : ''}
  <div class="grid-main">
    <div>
      <div class="card glow-border reveal">
        <div class="card-head"><h3><i class="dot live"></i>Live index · round in progress</h3><span class="small muted" id="live-meta"></span></div>
        <div class="card-pad" id="live-body"><div class="skeleton"></div></div>
      </div>
      <div class="card mt-lg reveal" id="tiles-card" hidden>
        <div class="card-head"><h3>Heatmap</h3><span class="small muted">Every live constituent, coloured by its return this round</span></div>
        <div class="card-pad"><div class="tiles stagger" id="mtiles"></div></div>
      </div>
      <div class="card mt-lg reveal">
        <div class="card-head"><h3>Constituents</h3><span class="small muted">Frozen at round start · liquidity-weighted, capped at ${(cfg.index.maxWeight * 100).toFixed(0)}% · prices from Uniswap v4 slot0</span></div>
        <div class="table-wrap" id="cons"></div>
      </div>
      <div class="card mt-lg reveal">
        <div class="card-head"><h3>Excluded this round</h3><span class="small muted">Depth &lt; ${fmtH(cfg.index.minLiquidityHype)}, &lt; ${cfg.index.minSellers24h} distinct sellers in 24h, not a launchpad pool, or missing price</span></div>
        <div class="table-wrap" id="excl"></div>
      </div>
      <div class="card mt-lg reveal">
        <div class="card-head"><h3>Recent rounds</h3><a class="small muted" href="#/history/${m.id}">All rounds →</a></div>
        <div class="table-wrap" id="recent"></div>
      </div>
    </div>
    <aside class="sticky">
      <div class="card slip glow-border reveal" id="deposit"></div>
      <div class="card mt reveal" id="positions"></div>
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
    if (!t) { body.innerHTML = `<div class="empty"><h4>No round schedule</h4>Rounds start when the pool contract is deployed. Until then there is no round to snapshot.</div>`; root.querySelector('#cons')!.innerHTML = ''; root.querySelector('#excl')!.innerHTML = ''; return; }
    const live = await api(`/api/live/${m!.id}?genesis=${t.genesis}&duration=${t.duration}`).catch(() => null);
    if (!live || !live.snapshot) {
      body.innerHTML = `<div class="empty"><h4>No snapshot for this round yet</h4>The keeper freezes the constituent list when a round starts. ${cfg.data.poolManagerOk ? '' : 'The keeper has not reached the Elysium PoolManager yet.'}</div>`;
      root.querySelector('#cons')!.innerHTML = '<div class="empty">—</div>'; root.querySelector('#excl')!.innerHTML = '<div class="empty">—</div>';
      return;
    }
    const r = live.liveRatio as number | null;
    body.innerHTML = `<div class="row between wrap">
      <div><div class="small muted">${m!.legs.length > 1 ? `${esc(m!.legs[0].name)} ÷ ${esc(m!.legs[1].name)} (weighted IQM of returns)` : 'Index return since round start (weighted interquartile mean)'}</div>
      <div class="big-val ${r == null || r === 1 ? '' : r > 1 ? 'up' : 'down'}" id="mval">${r == null ? '<span class="faint" style="font-size:40px">Too few coins</span>' : '—'}</div>
      <div class="small muted">${r == null ? `Needs ≥ ${cfg.index.minConstituents} priced constituents per leg. A round without them resolves at 1.0 and everyone is refunded.` : r > 1 ? 'Long is ahead right now' : r < 1 ? 'Short is ahead right now' : 'Flat so far: an exactly flat round refunds'}</div></div>
      <div class="row gap-lg">${live.legs.map((l: any) => `<div class="stat" style="min-width:150px"><div class="label">${esc(l.name)}</div><div class="value ${l.ratio > 1 ? 'up' : l.ratio < 1 ? 'down' : ''}">${l.ratio ? fmtPct(l.ratio - 1) : '—'}</div><div class="small faint">${l.priced} coins priced</div></div>`).join('')}</div>
    </div>`;
    if (r != null) countUp(body.querySelector('#mval'), (r - 1) * 100, (n) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%');
    const tl = live.legs.flatMap((l: any) => l.constituents).filter((c: any) => c.ret != null).sort((a: any, b: any) => (b.liveWeight ?? 0) - (a.liveWeight ?? 0));
    if (tl.length) {
      root.querySelector('#mtiles')!.innerHTML = tl.map((c: any) => `<div class="tile" style="background:${retColor(c.ret, 0.55)}"><div class="s">${esc(c.symbol)}</div><div class="r ${c.ret > 1 ? 'up' : c.ret < 1 ? 'down' : ''}">${fmtPct(c.ret - 1)}</div><div class="w">weight ${((c.liveWeight ?? 0) * 100).toFixed(1)}%</div></div>`).join('');
      (root.querySelector('#tiles-card') as HTMLElement).hidden = false;
      reveal(root);
    }
    root.querySelector('#live-meta')!.textContent = `round #${live.roundId} · ${live.legs.reduce((a: number, l: any) => a + l.constituents.length, 0)} constituents`;
    const rows = live.legs.flatMap((l: any) => l.constituents.map((c: any) => ({ ...c, leg: l.name })))
      .sort((a: any, b: any) => (b.liveWeight ?? 0) - (a.liveWeight ?? 0));
    root.querySelector('#cons')!.innerHTML = rows.length ? `<table><thead><tr><th>Token</th>${m!.legs.length > 1 ? '<th>Leg</th>' : ''}<th>Launchpad</th><th>Price source</th><th class="num">Depth</th><th class="num">Weight</th><th class="num">Start (HYPE)</th><th class="num">Last (HYPE)</th><th class="num">Return</th></tr></thead><tbody>
      ${rows.map((c: any) => `<tr><td><a href="${ELYSIUM_EXPLORER}/token/${c.token}" target="_blank" rel="noopener"><strong>${esc(c.symbol)}</strong> <span class="faint mono small">${short(c.token)}</span></a></td>${m!.legs.length > 1 ? `<td>${esc(c.leg)}</td>` : ''}
      <td><span class="tag">${esc(padName(c.launchpad))}</span></td><td class="small muted mono" title="Uniswap v4 pool ${esc(c.pool)} · slot0 read at block ${c.lastBlock ?? '—'}">slot0 @${c.lastBlock ?? '—'}</td><td class="num">${fmtH(c.liveDepth ?? c.liquidityHype)}</td><td class="num">${c.liveWeight != null ? (c.liveWeight * 100).toFixed(1) + '%' : '—'}</td>
      <td class="num">${fmtPrice(c.startPrice)}</td><td class="num">${fmtPrice(c.lastPrice)}</td><td class="num ${c.ret > 1 ? 'up' : c.ret < 1 ? 'down' : ''}">${c.ret ? fmtPct(c.ret - 1) : '—'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty"><h4>No eligible constituents</h4>No token launched in the last 24h passes the filters.</div>';
    const ex = live.legs.flatMap((l: any) => l.excluded);
    root.querySelector('#excl')!.innerHTML = ex.length ? `<table><thead><tr><th>Token</th><th>Launchpad</th><th class="num">Depth</th><th class="num">Sellers 24h</th><th>Reason</th></tr></thead><tbody>
      ${ex.sort((a: any, b: any) => b.liquidityHype - a.liquidityHype).slice(0, 60).map((c: any) => `<tr><td>${esc(c.symbol)} <span class="faint mono small">${short(c.token)}</span></td><td>${esc(padName(c.launchpad))}</td><td class="num">${fmtH(c.liquidityHype)}</td><td class="num">${c.sellers24h}</td><td><span class="tag tag-warn">${esc(c.excludeReason)}</span></td></tr>`).join('')}</tbody></table>`
      + (ex.length > 60 ? `<div class="small muted" style="padding:10px 16px">+ ${ex.length - 60} more (all listed in the round proof)</div>` : '')
      : '<div class="empty">Nothing excluded.</div>';
  }

  // ---------------- recent rounds
  async function loadRecent() {
    const el = root.querySelector('#recent')!;
    const rows = await api<any[]>(`/api/results/${m!.id}`).catch(() => []);
    el.innerHTML = rows.length ? `<table><thead><tr><th>Round</th><th class="num">Result</th><th>Outcome</th><th>Proof</th></tr></thead><tbody>
      ${rows.slice(0, 8).map((r) => { const x = Number(r.result_e18) / 1e18; return `<tr><td class="mono">#${r.round_id}</td><td class="num ${x > 1 ? 'up' : x < 1 ? 'down' : ''}">${fmtPct(x - 1)}</td>
      <td>${x === 1 ? '<span class="tag tag-warn">refund</span>' : x > 1 ? '<span class="tag tag-up">long won</span>' : '<span class="tag tag-down">short won</span>'}</td><td><a class="small" style="color:var(--pink)" href="#/round/${m!.id}/${r.round_id}">verify →</a></td></tr>`; }).join('')}</tbody></table>`
      : '<div class="empty">No rounds computed yet.</div>';
  }

  // ---------------- deposit panel
  async function loadDeposit() {
    const el = root.querySelector('#deposit')!;
    if (!cfg.contract || !t) { el.innerHTML = `<h3 style="font-size:22px">Place a bet</h3><p class="muted mt">Betting opens once the pool contract is deployed and configured.</p>`; return; }
    if (state.geo?.blocked) { el.innerHTML = `<h3 style="font-size:22px">Place a bet</h3><div class="notice notice-bad mt">SLOPX is not available in your region (${esc(state.geo.country)}).</div>`; return; }
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
      <div class="row between"><h3 style="font-size:22px">Bet on round #${r}</h3><span class="tag tag-warn">⏱ <span class="countdown" id="lock-cd">—</span></span></div>
      ${lim.paused ? '<div class="notice notice-bad mt">Paused: deposits disabled.</div>' : ''}
      ${skewBar(rd.longTotal, rd.shortTotal)}
      <div class="small muted">Funding: <strong style="color:var(--text)">${fundRate ? `${rd.shortTotal > rd.longTotal ? 'shorts' : 'longs'} pay ${(fundRate * 100).toFixed(2)}%` : 'none (balanced or empty)'}</strong></div>
      <div class="slip-toggle"><button data-s="long">▲ LONG</button><button data-s="short">▼ SHORT</button></div>
      <div class="field"><label><span>Amount</span><span>${state.account ? `Balance ${fmtHype(bal)} HYPE` : ''}</span></label>
        <div class="input"><input id="amt" inputmode="decimal" placeholder="0.00" autocomplete="off" /><span class="unit">HYPE</span></div>
        <div class="chips">${['0.1', '0.5', '1', '5'].map((v) => `<button class="chip" data-v="${v}">${v}</button>`).join('')}</div></div>
      <div class="payout" id="pv"></div>
      <div class="small muted mt">Min ${fmtHype(lim.minDeposit)} · max ${fmtHype(lim.maxWallet)} per wallet per round (room left ${fmtHype(room > 0n ? room : 0n)}) · side cap ${fmtHype(lim.maxSide)}</div>
      <button class="btn btn-block mt" id="go"></button>
      <p class="small faint mt">Unaudited and betting-like. You can lose your entire deposit. <a href="#/trust" style="color:var(--pink)">Rules</a></p>`;
    const amtEl = el.querySelector('#amt') as HTMLInputElement;
    const go = el.querySelector('#go') as HTMLButtonElement;
    const setSide = (s: 'long' | 'short') => {
      side = s;
      el.querySelectorAll('.slip-toggle button').forEach((b) => (b as HTMLElement).className = (b as HTMLElement).dataset.s === s ? 'on-' + s : '');
      update();
    };
    const update = () => {
      let a = 0n; try { a = amtEl.value ? parseEther(amtEl.value as `${number}`) : 0n; } catch { a = -1n; }
      const L = rd.longTotal + (side === 'long' && a > 0n ? a : 0n), S = rd.shortTotal + (side === 'short' && a > 0n ? a : 0n);
      const pv = el.querySelector('#pv')!;
      if (a > 0n) {
        const one = L === 0n || S === 0n;
        const w = winMultiple(L, S, side, p), lo = loseMultiple(L, S, side, p);
        pv.innerHTML = one ? `<div class="small muted">The other side is empty right now. Take it and you set the odds. If it stays empty, everyone is refunded in full.</div>` :
          `<div class="small muted">If ${side} wins you get</div><div class="win">${(Number(formatEther(a)) * w).toFixed(4)} HYPE <span style="font-size:18px;opacity:.75">${w.toFixed(2)}×</span></div>
           <dl class="kv mt">
           <dt>If ${side} loses</dt><dd class="down">${(Number(formatEther(a)) * lo).toFixed(4)} HYPE</dd>
           <dt>Fee on winnings</dt><dd>${Number(p.feeBps) / 100}%</dd></dl>
           <div class="small faint" style="margin-top:6px">Based on the pool as it stands now. Final odds lock when deposits close.</div>`;
      } else pv.innerHTML = `<div class="small muted">Enter an amount to see what you could win.</div>`;
      if (!state.account) { go.textContent = 'Connect wallet'; go.className = 'btn btn-primary btn-block mt'; go.disabled = false; return; }
      go.className = `btn btn-${side} btn-block mt`; go.textContent = `${side === 'long' ? '▲ Long' : '▼ Short'} round #${r}`;
      go.disabled = lim.paused || a < lim.minDeposit || a > room || a > bal;
      if (a > room && a > 0n) go.textContent = 'Exceeds per-wallet cap';
      else if (a > bal) go.textContent = 'Insufficient balance';
    };
    el.querySelectorAll('.slip-toggle button').forEach((b) => b.addEventListener('click', () => setSide((b as HTMLElement).dataset.s as any)));
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
        toast(`You're in. ${side === 'long' ? 'Long' : 'Short'} confirmed · ${hash.slice(0, 10)}…`, 'ok');
        confetti(side === 'long' ? ['#00e59b', '#00b8d4', '#8b5cf6', '#ffffff'] : ['#ff3b6b', '#ff7a45', '#ec4899', '#ffffff']);
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
        toast('Claimed. Paid out.', 'ok'); confetti(); loadPositions();
      } catch (e: any) { toast(e?.shortMessage ?? e?.message, 'err'); (b as HTMLButtonElement).disabled = false; }
    }));
  }

  reveal(root);
  await Promise.all([loadLive(), loadRecent(), loadDeposit(), loadPositions()].map((p) => p.catch((e) => console.error(e))));
  reveal(root);
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
      <label class="check"><input type="checkbox" /> I understand results are posted by a keeper I have to trust, subject to a dispute window. See <a href="#/docs/trust" style="color:var(--pink)">what you trust</a>.</label>
      <label class="check"><input type="checkbox" /> I am not in a restricted region, and it is legal for me to use this where I live.</label>
      <label class="check"><input type="checkbox" /> I understand this is betting-like, not investing, and nothing here promises a return. I have read the <a href="#/trust" style="color:var(--pink)">rules &amp; risks</a>.</label>
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
