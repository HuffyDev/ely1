import { keccak256, toHex } from 'viem';
import { state, api, esc, fmtPct, fmtHype, explorerTx, readRound, STATUS, roundStart, fmtPrice, fmtH, padName, short, contractRef } from '../lib';
import { canonicalJson, recompute } from '../../../keeper/src/indexMath';

export async function renderHistory(root: HTMLElement, marketId = 0) {
  const cfg = state.cfg!;
  root.innerHTML = `<div class="section row between wrap" style="margin-top:28px"><div><h1 style="font-size:30px">Round history</h1>
    <p class="muted" style="margin-top:6px">Every computed round, with its result, the onchain proposal and settlement transactions, and a link to the full proof.</p></div>
    <div class="row">${cfg.markets.map((m) => `<a class="btn btn-sm ${m.id === marketId ? 'btn-primary' : ''}" href="#/history/${m.id}">${esc(m.name)}</a>`).join('')}</div></div>
    <div class="card"><div class="table-wrap" id="h"><div class="card-pad"><div class="skeleton"></div></div></div></div>
    <div class="card mt-lg"><div class="card-head"><h3>Onchain activity</h3><span class="small muted">Indexed contract events</span></div><div class="table-wrap" id="ev"></div></div>`;
  const rows = await api<any[]>(`/api/results/${marketId}`).catch(() => []);
  const h = root.querySelector('#h')!;
  if (!rows.length) { h.innerHTML = '<div class="empty"><h4>No rounds yet</h4>Rounds appear here once the keeper has computed them.</div>'; }
  else {
    const chainRounds = cfg.contract ? await Promise.all(rows.map((r) => readRound(marketId, r.round_id).catch(() => null))) : rows.map(() => null);
    h.innerHTML = `<table><thead><tr><th>Round</th><th>Window (UTC)</th><th class="num">Result</th>${cfg.markets[marketId].legs.map((l) => `<th class="num">${esc(l.name)}</th>`).join('')}<th class="num">Long pool</th><th class="num">Short pool</th><th>Status</th><th>Txs</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => { const x = Number(r.result_e18) / 1e18; const c = chainRounds[i]; const st = state.timing ? new Date(roundStart(r.round_id) * 1000).toISOString().slice(5, 16).replace('T', ' ') : '';
      return `<tr><td class="mono">#${r.round_id}</td><td class="small muted">${st}</td><td class="num ${x > 1 ? 'up' : x < 1 ? 'down' : ''}">${fmtPct(x - 1)}${r.note ? ' <span class="tag tag-warn">refund</span>' : ''}</td>
      ${r.legs.map((l: any) => `<td class="num">${l.ratio ? fmtPct(Number(l.ratio) - 1) : '—'} <span class="faint small">(${l.count})</span></td>`).join('')}
      <td class="num">${c ? fmtHype(c.longTotal) : '—'}</td><td class="num">${c ? fmtHype(c.shortTotal) : '—'}</td><td>${c ? (c.longTotal + c.shortTotal === 0n ? '<span class="faint small">no deposits</span>' : `<span class="tag">${STATUS[c.status]}</span>`) : '—'}</td>
      <td class="small">${r.proposed_tx ? `<a href="${explorerTx(r.proposed_tx)}" target="_blank" rel="noopener">propose</a>` : '<span class="faint">—</span>'} ${r.settled_tx ? `· <a href="${explorerTx(r.settled_tx)}" target="_blank" rel="noopener">settle</a>` : ''}</td>
      <td><a class="small" style="color:var(--accent)" href="#/round/${marketId}/${r.round_id}">proof →</a></td></tr>`; }).join('')}</tbody></table>`;
  }
  const ev = await api<any[]>(`/api/events/${marketId}`).catch(() => []);
  root.querySelector('#ev')!.innerHTML = ev.length ? `<table><thead><tr><th>Event</th><th>Round</th><th>Wallet</th><th class="num">Detail</th><th>Tx</th></tr></thead><tbody>
    ${ev.slice(0, 100).map((e) => { const j = JSON.parse(e.json); return `<tr><td>${esc(e.name)}</td><td class="mono">${e.round_id ?? '—'}</td><td class="mono small">${e.user ? short(e.user) : '—'}</td>
    <td class="num small">${j.amount ? fmtHype(BigInt(j.amount)) + ' HYPE' + (j.side !== undefined ? (Number(j.side) === 0 ? ' long' : ' short') : '') : j.resultE18 ? 'result ' + fmtPct(Number(j.resultE18) / 1e18 - 1) : j.reason ?? ''}</td>
    <td><a class="small" href="${explorerTx(e.tx)}" target="_blank" rel="noopener">${e.tx.slice(0, 10)}…</a></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No contract events indexed yet.</div>';
}

export async function renderProof(root: HTMLElement, marketId: number, roundId: number) {
  root.innerHTML = `<div class="section" style="margin-top:28px"><a class="small muted" href="#/history/${marketId}">← Round history</a>
    <h1 style="font-size:30px;margin-top:8px">Settlement proof · ${esc(state.cfg!.markets[marketId]?.name)} #${roundId}</h1></div><div id="p"><div class="skeleton"></div></div>`;
  const el = root.querySelector('#p')!;
  let data: any;
  try { data = await api(`/api/result/${marketId}/${roundId}`); }
  catch { el.innerHTML = '<div class="card empty"><h4>Not computed yet</h4>The keeper computes the result after the round ends.</div>'; return; }
  const rc = data.computation;
  const localHash = keccak256(toHex(canonicalJson(rc)));
  let onchain: any = null;
  if (state.cfg!.contract) {
    try { onchain = await state.client!.readContract({ ...contractRef(), functionName: 'proposals', args: [BigInt(marketId), BigInt(roundId)] }); } catch { /* ignore */ }
  }
  // independent recomputation in the browser
  const again = recompute(JSON.parse(JSON.stringify(rc)));
  const match = again.resultE18 === rc.resultE18;
  const onHash = onchain ? (onchain[1] as string) : null;
  const zero = '0x' + '0'.repeat(64);
  const x = Number(rc.resultE18) / 1e18;

  el.innerHTML = `<div class="grid-2">
    <div class="card card-pad"><div class="small muted">Result posted (1.0 = flat)</div><div class="big-num ${x > 1 ? 'up' : x < 1 ? 'down' : ''}">${x.toFixed(6)} <span class="small">(${fmtPct(x - 1)})</span></div>
      <div class="mt">${x === 1 ? '<span class="tag tag-warn">Refund</span>' : x > 1 ? '<span class="tag tag-up">Long won</span>' : '<span class="tag tag-down">Short won</span>'} ${rc.note ? `<span class="small muted">${esc(rc.note)}</span>` : ''}</div></div>
    <div class="card card-pad"><dl class="kv">
      <dt>Recomputed in your browser</dt><dd class="${match ? 'up' : 'down'}">${match ? '✓ match' : '✗ MISMATCH'}</dd>
      <dt>Hash of published JSON</dt><dd class="hash">${localHash.slice(0, 18)}…</dd>
      <dt>Hash posted onchain</dt><dd class="hash">${onHash && onHash !== zero ? onHash.slice(0, 18) + '…' : 'not proposed / settled event only'}</dd>
      <dt>Hashes agree</dt><dd class="${onHash === localHash ? 'up' : 'muted'}">${onHash && onHash !== zero ? (onHash === localHash ? '✓ yes' : '✗ NO') : '—'}</dd>
      <dt>Method</dt><dd>${esc(rc.method)}</dd></dl>
      <div class="row mt"><a class="btn btn-sm" href="/api/result/${marketId}/${roundId}/raw">Download JSON</a></div></div>
  </div>
  <div class="card mt-lg card-pad"><h3>Verify it yourself</h3><pre class="mono small" style="white-space:pre-wrap;color:var(--muted);margin-top:10px">git clone https://github.com/HuffyDev/ely1 && cd ely1 && npm install
npm run recompute -w keeper -- ${location.origin}/api/result/${marketId}/${roundId}/raw ${onHash && onHash !== zero ? onHash : '<onchain dataHash>'} --verify-chain <elysium-archive-rpc></pre>
  <p class="small muted">Data chain ${rc.dataChainId}, Uniswap v4 PoolManager <code>${esc(rc.poolManager)}</code>. Universe: pools initialised in blocks ${rc.window?.fromBlock}–${rc.window?.toBlock}. A hook counts as a launchpad if it created ≥ ${rc.config.launchpadMinLaunches} pools in that window, or if it carries a verified label. Each sample is <code>sqrtPriceX96</code> read at a published block, which <code>--verify-chain</code> re-reads from an archive node.</p>
  <p class="small muted">The JSON lists each constituent's raw price samples in the windows [start−${rc.config.sampleWindowSec}s, start] and [end−${rc.config.sampleWindowSec}s, end]. Each price is the median of its samples. Each return is end/start. The result is the depth-weighted interquartile mean of returns (middle 50% of weight, in log space), with weights capped at ${(rc.config.maxWeight * 100).toFixed(0)}%${rc.legs.length > 1 ? ', and for a pair it is leg A ÷ leg B' : ''}.</p></div>
  ${rc.legs.map((l: any) => `<div class="card mt-lg"><div class="card-head"><h3>${esc(l.name)}</h3><span class="small muted">ratio ${l.ratio ? Number(l.ratio).toFixed(6) : 'n/a'} · ${l.count} priced</span></div><div class="table-wrap"><table>
   <thead><tr><th>Token</th><th>Launchpad</th><th>Pool</th><th class="num">Depth</th><th class="num">Sellers</th><th class="num">Weight</th><th class="num">Start (median of n)</th><th class="num">End (median of n)</th><th class="num">Return</th><th>Status</th></tr></thead><tbody>
   ${[...l.constituents].sort((a: any, b: any) => Number(b.included) - Number(a.included) || b.liquidityHype - a.liquidityHype).slice(0, 150).map((c: any) => `<tr><td>${esc(c.symbol)} <span class="faint mono small">${short(c.token)}</span></td><td>${esc(padName(c.launchpad))}</td><td class="mono small muted" title="${esc(c.pool)}">${esc(c.pool.slice(0, 10))}…</td><td class="num">${fmtH(c.liquidityHype)}</td><td class="num">${c.sellers24h}</td><td class="num">${c.weight ? (c.weight * 100).toFixed(2) + '%' : '—'}</td>
   <td class="num">${fmtPrice(c.startPrice)} <span class="faint">(${c.startSamples?.length ?? 0})</span></td><td class="num">${fmtPrice(c.endPrice)} <span class="faint">(${c.endSamples?.length ?? 0})</span></td>
   <td class="num ${c.ret > 1 ? 'up' : c.ret < 1 ? 'down' : ''}">${c.ret ? fmtPct(c.ret - 1) : '—'}</td><td>${c.included ? '<span class="tag tag-up">in</span>' : `<span class="tag tag-warn">${esc(c.excludeReason)}</span>`}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No candidates</td></tr>'}
   </tbody></table></div></div>`).join('')}`;
}
