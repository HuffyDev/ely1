import { state, connect, esc, fmtHype, short, explorerTx } from '../lib';

export async function renderPortfolio(root: HTMLElement) {
  root.innerHTML = `<div class="section" style="margin-top:28px"><h1 style="font-size:30px">Portfolio</h1><p class="muted" style="margin-top:6px">Your deposits and claims, from indexed contract events. Open a market to claim.</p></div><div id="pf"></div>`;
  const el = root.querySelector('#pf')!;
  if (!state.account) {
    el.innerHTML = `<div class="card empty"><h4>No wallet connected</h4><button class="btn btn-primary mt" id="c">Connect wallet</button></div>`;
    el.querySelector('#c')!.addEventListener('click', () => connect());
    return;
  }
  const rows = await fetch(`/api/user/${state.account}`).then((r) => r.json()).catch(() => []);
  let dep = 0n, cl = 0n;
  for (const e of rows) { const j = JSON.parse(e.json); if (e.name === 'Deposited') dep += BigInt(j.amount); if (e.name === 'Claimed') cl += BigInt(j.amount); }
  el.innerHTML = `<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><div class="label">Wallet</div><div class="value">${short(state.account)}</div></div>
    <div class="stat"><div class="label">Total deposited</div><div class="value">${fmtHype(dep)} HYPE</div></div><div class="stat"><div class="label">Total claimed</div><div class="value">${fmtHype(cl)} HYPE</div></div></div>
    <div class="card mt-lg"><div class="table-wrap">${rows.length ? `<table><thead><tr><th>Event</th><th>Market</th><th>Round</th><th class="num">Amount</th><th>Tx</th></tr></thead><tbody>
    ${rows.map((e: any) => { const j = JSON.parse(e.json); return `<tr><td>${esc(e.name)}${j.side !== undefined ? ` <span class="tag ${Number(j.side) === 0 ? 'tag-long' : 'tag-short'}">${Number(j.side) === 0 ? 'long' : 'short'}</span>` : ''}</td>
    <td><a href="#/market/${e.market_id}">${esc(state.cfg!.markets[e.market_id]?.name ?? e.market_id)}</a></td><td class="mono">#${e.round_id}</td><td class="num">${j.amount ? fmtHype(BigInt(j.amount)) : '—'}</td>
    <td><a class="small" href="${explorerTx(e.tx)}" target="_blank" rel="noopener">${e.tx.slice(0, 10)}…</a></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty">No activity for this wallet yet.</div>'}</div></div>`;
}
