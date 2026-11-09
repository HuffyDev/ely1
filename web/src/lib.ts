import { createPublicClient, createWalletClient, custom, http, defineChain, formatEther, type Address, type PublicClient, type WalletClient } from 'viem';
import { slopxAbi } from '../../keeper/src/abi';

export { slopxAbi };

export interface MarketDef { id: number; name: string; legs: { name: string; launchpads: string[] | 'all' }[] }
export interface AppConfig {
  chain: { id: number; name: string; rpc: string; explorer?: string };
  contract: Address | null;
  markets: MarketDef[];
  dataChain: { id: number; poolManager: string; whype: string };
  labels: { name: string; hooks: string[]; source: string | null }[];
  index: { method: string; minLiquidityHype: number; minSellers24h: number; maxWeight: number; minConstituents: number; sampleWindowSec: number; universeWindowSec: number; launchpadMinLaunches: number };
  defaultParams: Record<string, number>;
  data: { lastSample: number | null; launches24h: number; keeperEnabled: boolean; poolManagerOk: boolean };
}

export const state: {
  cfg?: AppConfig;
  client?: PublicClient;
  wallet?: WalletClient;
  account?: Address;
  timing?: { genesis: number; duration: number; lockBuffer: number; disputeWindow: number; maxPriceDelay: number };
  limits?: { minDeposit: bigint; maxWallet: bigint; maxSide: bigint; paused: boolean };
  geo?: { country: string | null; blocked: boolean };
} = {};

export async function api<T = any>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

export function chainDef(c: AppConfig['chain']) {
  return defineChain({ id: c.id, name: c.name, nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } }, blockExplorers: c.explorer ? { default: { name: 'Explorer', url: c.explorer } } : undefined });
}

export async function boot() {
  state.cfg = await api<AppConfig>('/api/config');
  // reads go through the server's RPC proxy (keeps provider keys server-side, avoids CORS)
  state.client = createPublicClient({ chain: chainDef(state.cfg.chain), transport: http(location.origin + '/api/rpc') }) as PublicClient;
  state.geo = await api('/api/geo').catch(() => ({ country: null, blocked: false }));
  if (state.cfg.contract) {
    try {
      const c = { address: state.cfg.contract, abi: slopxAbi } as const;
      const r = await state.client.multicall({ allowFailure: false, contracts: [
        { ...c, functionName: 'genesis' }, { ...c, functionName: 'roundDuration' }, { ...c, functionName: 'lockBuffer' },
        { ...c, functionName: 'disputeWindow' }, { ...c, functionName: 'maxPriceDelay' }, { ...c, functionName: 'minDeposit' },
        { ...c, functionName: 'maxWalletPerRound' }, { ...c, functionName: 'maxSidePerRound' }, { ...c, functionName: 'paused' },
      ] }).catch(async () => Promise.all((['genesis', 'roundDuration', 'lockBuffer', 'disputeWindow', 'maxPriceDelay', 'minDeposit', 'maxWalletPerRound', 'maxSidePerRound', 'paused'] as const)
        .map((fn) => state.client!.readContract({ ...c, functionName: fn } as any))));
      const [g, d, lb, dw, mpd, minD, maxW, maxS, paused] = r as any[];
      state.timing = { genesis: Number(g), duration: Number(d), lockBuffer: Number(lb), disputeWindow: Number(dw), maxPriceDelay: Number(mpd) };
      state.limits = { minDeposit: minD, maxWallet: maxW, maxSide: maxS, paused };
    } catch (e) {
      console.warn('contract read failed', e);
    }
  }
}

export const contractRef = () => ({ address: state.cfg!.contract!, abi: slopxAbi } as const);

// ---------------------------------------------------------------- rounds
export const nowSec = () => Math.floor(Date.now() / 1000);
export function currentRound() { const t = state.timing!; return Math.floor((nowSec() - t.genesis) / t.duration); }
export function openRound() { const t = state.timing!; return nowSec() < t.genesis ? 0 : currentRound() + 1; }
export const roundStart = (r: number) => state.timing!.genesis + r * state.timing!.duration;

export interface RoundState { longTotal: bigint; shortTotal: bigint; longPayout: bigint; shortPayout: bigint; status: number; paramsSet: boolean; params: any }
export async function readRound(m: number, r: number): Promise<RoundState> {
  const x = (await state.client!.readContract({ ...contractRef(), functionName: 'rounds', args: [BigInt(m), BigInt(r)] })) as unknown as any[];
  return { longTotal: x[0], shortTotal: x[1], longPayout: x[2], shortPayout: x[3], status: Number(x[4]), paramsSet: x[5], params: x[6] };
}

// ---------------------------------------------------------------- wallet
declare global { interface Window { ethereum?: any } }

export async function connect() {
  if (!window.ethereum) { toast('No browser wallet found. Install Rabby or MetaMask.', 'err'); return; }
  const chain = chainDef(state.cfg!.chain);
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) });
  const [account] = await wallet.requestAddresses();
  state.wallet = wallet; state.account = account;
  await ensureChain();
  window.ethereum.on?.('accountsChanged', (a: string[]) => { state.account = a[0] as Address | undefined; emit(); });
  window.ethereum.on?.('chainChanged', () => emit());
  emit();
}

export async function ensureChain() {
  const c = state.cfg!.chain;
  const hex = '0x' + c.id.toString(16);
  const cur = await window.ethereum.request({ method: 'eth_chainId' });
  if (cur === hex) return;
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code === 4902) {
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: c.name,
        nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: c.explorer ? [c.explorer] : [] }] });
    } else throw e;
  }
}

const listeners = new Set<() => void>();
export const onChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
export const emit = () => listeners.forEach((f) => f());

// ---------------------------------------------------------------- formatting
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function fmtHype(v: bigint, dp = 3) { const n = Number(formatEther(v)); return n.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: n > 0 && n < 1 ? Math.min(dp, 2) : 0 }); }
export const fmtPct = (x: number, dp = 2) => (x >= 0 ? '+' : '') + (x * 100).toFixed(dp) + '%';
export const fmtH = (x: number | null | undefined) => x == null ? '—' : (x >= 1000 ? (x / 1000).toFixed(1) + 'k' : x.toFixed(x >= 100 ? 0 : 1)) + ' HYPE';
/** launchpad label: verified name, or shortened hook address */
export const padName = (lp: string) => lp?.startsWith('0x') ? 'hook ' + lp.slice(0, 6) + '…' + lp.slice(-4) : lp;
export const ELYSIUM_EXPLORER = 'https://explorer.elysium.kinetiq.xyz';
export const fmtUsd = (x: number) => x >= 1e6 ? '$' + (x / 1e6).toFixed(2) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'k' : '$' + x.toFixed(0);
export function fmtPrice(x: number | null | undefined) { if (x == null) return '—'; if (x >= 1) return x.toFixed(4); return x < 1e-4 ? x.toExponential(3) : x.toPrecision(4); }
export const short = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);
export function dur(s: number) { if (s < 0) s = 0; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (h ? h + 'h ' : '') + String(m).padStart(2, '0') + 'm ' + String(ss).padStart(2, '0') + 's'; }
export function ago(ts: number) { const s = nowSec() - ts; if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago'; }
export const explorerTx = (h: string) => state.cfg?.chain.explorer ? `${state.cfg.chain.explorer}/tx/${h}` : '#';
export const explorerAddr = (a: string) => state.cfg?.chain.explorer ? `${state.cfg.chain.explorer}/address/${a}` : '#';
export const STATUS = ['Open', 'Settled', 'Refunded'];

// ---------------------------------------------------------------- ui helpers
export function toast(msg: string, kind: 'ok' | 'err' | '' = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  document.getElementById('toast-root')!.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

export function modal(html: string, onMount?: (root: HTMLElement, close: () => void) => void) {
  const root = document.getElementById('modal-root')!;
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => (root.innerHTML = '');
  root.querySelector('.modal-backdrop')!.addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  onMount?.(root.querySelector('.modal') as HTMLElement, close);
  return close;
}

export function initTheme() {
  const btn = document.getElementById('theme');
  btn?.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'light'; // dark is the default theme
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; LS.set('slopx-theme', next);
  });
}

export const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export function marketBlurb(m: MarketDef) {
  if (m.legs.length === 1) return m.legs[0].launchpads === 'all'
    ? 'Every token launched on Elysium in the last 24 hours, as one robust median-family index.'
    : `${m.legs[0].name} launches from the last 24 hours.`;
  return `${m.legs[0].name} launches against ${m.legs[1].name} launches. Long means ${m.legs[0].name} outperforms this hour.`;
}
