import './styles.css';
import { boot, state, connect, onChange, short, toast, initTheme } from './lib';
import { renderMarkets } from './pages/markets';
import { renderMarket } from './pages/market';
import { renderHistory, renderProof } from './pages/history';
import { renderPortfolio } from './pages/portfolio';
import { renderDocs, renderTerms, renderTrust } from './pages/docs';
import { reveal, initRipples } from './anim';

const app = document.getElementById('app')!;
let cleanup: (() => void) | void;

async function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  const [p0, p1, p2] = parts;
  document.querySelectorAll('#nav a, .mobile-nav a').forEach((a) => a.classList.toggle('active', (a as HTMLElement).dataset.r === (p0 === 'market' || !p0 ? 'markets' : p0 === 'round' ? 'history' : p0)));
  window.scrollTo({ top: 0 });
  app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter');
  try {
    if (!p0) cleanup = await renderMarkets(app);
    else if (p0 === 'market') cleanup = await renderMarket(app, Number(p1));
    else if (p0 === 'history') await renderHistory(app, Number(p1 ?? 0));
    else if (p0 === 'round') await renderProof(app, Number(p1), Number(p2));
    else if (p0 === 'portfolio') await renderPortfolio(app);
    else if (p0 === 'docs') renderDocs(app, p1 ?? '');
    else if (p0 === 'terms') renderTerms(app);
    else if (p0 === 'trust') renderTrust(app);
    else app.innerHTML = '<div class="empty"><h4>Page not found</h4><a href="#/">Back to markets</a></div>';
    // every card, table and doc section animates in as it scrolls into view
    app.querySelectorAll('.card:not(.reveal), .stats:not(.stagger), .prose > *, .doc-nav').forEach((el) => el.classList.add('reveal'));
    reveal(app);
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="empty"><h4>Something went wrong</h4>${(e as Error).message}</div>`;
  }
}

function renderChrome() {
  const btn = document.getElementById('connect') as HTMLButtonElement;
  btn.textContent = state.account ? short(state.account) : 'Connect wallet';
  btn.className = state.account ? 'btn btn-sm' : 'btn btn-primary btn-sm';
  const pill = document.getElementById('net-pill')!;
  const ok = !!state.timing;
  pill.innerHTML = `<i class="dot ${ok ? 'ok' : state.cfg?.contract ? 'bad' : 'warn'}"></i><span>${state.cfg?.chain.name ?? '…'}</span>`;
  const banner = document.getElementById('geo-banner')!;
  if (state.geo?.blocked) { banner.hidden = false; banner.textContent = `SLOPX is not available in your region (${state.geo.country}). Deposits are disabled.`; }
}

(async () => {
  initTheme();
  initRipples();
  // mobile nav
  const nav = document.getElementById('nav')!;
  const mob = document.createElement('nav'); mob.className = 'mobile-nav'; mob.innerHTML = nav.innerHTML;
  document.querySelector('.topbar')!.after(mob);
  try { await boot(); } catch (e) { app.innerHTML = `<div class="empty"><h4>Can't reach the SLOPX server</h4>${(e as Error).message}</div>`; return; }
  document.getElementById('connect')!.addEventListener('click', () => (state.account ? null : connect().catch((e) => toast(e.message, 'err'))));
  onChange(renderChrome);
  renderChrome();
  // silently restore an already-authorised wallet
  window.ethereum?.request({ method: 'eth_accounts' }).then((a: string[]) => { if (a?.length) connect().catch(() => {}); }).catch(() => {});
  window.addEventListener('hashchange', route);
  route();
})();
