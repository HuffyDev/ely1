// Monte-Carlo simulation of the skew-funding mechanism. Run: npm run sim
// Writes docs/funding-simulation.md. Seeded, so results are reproducible.
import { writeFileSync } from 'node:fs';
import { computePayouts, DEFAULT_PARAMS, type Params } from '../payout.js';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const E = 10n ** 18n;
const toW = (x: number) => BigInt(Math.round(x * 1e6)) * 10n ** 12n;

interface Scenario { name: string; pDown: number; noiseShare: number; noiseShortBias: number; agents: number }
const SCENARIOS: Scenario[] = [
  { name: 'Base: 70% noise traders, 80% of them short, fair coin', pDown: 0.5, noiseShare: 0.7, noiseShortBias: 0.8, agents: 40 },
  { name: 'Trenches really dump: P(down)=0.6', pDown: 0.6, noiseShare: 0.7, noiseShortBias: 0.8, agents: 40 },
  { name: 'Thin round: 8 agents, 90% short bias', pDown: 0.5, noiseShare: 0.8, noiseShortBias: 0.9, agents: 8 },
  { name: 'Heavily one-sided: 95% short bias, only 10% EV traders', pDown: 0.55, noiseShare: 0.9, noiseShortBias: 0.95, agents: 30 },
  { name: 'Extreme: 99% short bias, 5% EV traders', pDown: 0.55, noiseShare: 0.95, noiseShortBias: 0.99, agents: 30 },
  { name: 'Extreme + thin: 99% short bias, 6 agents', pDown: 0.55, noiseShare: 0.95, noiseShortBias: 0.99, agents: 6 },
];
const CONFIGS: { label: string; p: Params }[] = [
  { label: 'no funding (k=0)', p: { ...DEFAULT_PARAMS, fundingK: 0n } },
  { label: 'k=500, max 2.5% (CHOSEN)', p: DEFAULT_PARAMS },
  { label: 'k=1000, max 5%', p: { ...DEFAULT_PARAMS, fundingK: 1000n, fundingMaxBps: 500n } },
  { label: 'k=2000, max 10%', p: { ...DEFAULT_PARAMS, fundingK: 2000n, fundingMaxBps: 1000n } },
];

function evOf(L: bigint, S: bigint, side: 'long' | 'short', amt: bigint, pDown: number, p: Params) {
  const L2 = side === 'long' ? L + amt : L;
  const S2 = side === 'short' ? S + amt : S;
  if (L2 === 0n || S2 === 0n) return 0; // would be refunded
  const own = side === 'long' ? L2 : S2;
  const win = computePayouts(L2, S2, side === 'long', p);
  const lose = computePayouts(L2, S2, side !== 'long', p);
  const pay = (r: typeof win) => Number(((side === 'long' ? r.longPayout : r.shortPayout) * amt) / own) / 1e18;
  const pWin = side === 'long' ? 1 - pDown : pDown;
  return pWin * pay(win) + (1 - pWin) * pay(lose) - Number(amt) / 1e18;
}

function run(sc: Scenario, cfg: Params, rounds = 4000) {
  let skewAbs = 0, oneSided = 0, fees = 0, vol = 0;
  let noisePnl = 0, noiseVol = 0, arbPnl = 0, arbVol = 0, minorityFundGain = 0, minorityVol = 0;
  const skews: number[] = [];
  for (let r = 0; r < rounds; r++) {
    let L = 0n, S = 0n;
    const bets: { side: 'long' | 'short'; amt: bigint; noise: boolean }[] = [];
    for (let a = 0; a < sc.agents; a++) {
      const amt = toW(Math.max(0.01, Math.min(1, Math.exp(gauss() * 0.8 - 1.5)))); // launch caps: 0.01–1 HYPE
      const noise = rnd() < sc.noiseShare;
      let side: 'long' | 'short' | null;
      if (noise) side = rnd() < sc.noiseShortBias ? 'short' : 'long';
      else {
        const belief = Math.min(0.95, Math.max(0.05, sc.pDown + gauss() * 0.03));
        const evL = evOf(L, S, 'long', amt, belief, cfg);
        const evS = evOf(L, S, 'short', amt, belief, cfg);
        side = Math.max(evL, evS) > 0.002 * (Number(amt) / 1e18) ? (evL > evS ? 'long' : 'short') : null;
      }
      if (!side) continue;
      bets.push({ side, amt, noise });
      if (side === 'long') L += amt; else S += amt;
    }
    vol += Number(L + S) / 1e18;
    if (L === 0n || S === 0n) { oneSided++; continue; }
    const skew = Number(S - L) / Number(S + L);
    skews.push(skew); skewAbs += Math.abs(skew);
    const down = rnd() < sc.pDown;
    const res = computePayouts(L, S, !down, cfg);
    fees += Number(res.fee) / 1e18;
    const fundedL = computePayouts(L, S, true, { ...cfg, fundingK: 0n });
    void fundedL;
    for (const b of bets) {
      const pool = b.side === 'long' ? res.longPayout : res.shortPayout;
      const tot = b.side === 'long' ? L : S;
      const pnl = Number((pool * b.amt) / tot - b.amt) / 1e18;
      if (b.noise) { noisePnl += pnl; noiseVol += Number(b.amt) / 1e18; } else { arbPnl += pnl; arbVol += Number(b.amt) / 1e18; }
    }
    // funding received by minority side, as % of its stake
    const minority = S > L ? L : S;
    const crowded = S > L ? S : L;
    const rate = Math.min(Number(cfg.fundingMaxBps) / 1e4, (Math.abs(skew) * Number(cfg.fundingK)) / 1e4);
    const f = Math.min(Number(crowded) * rate, (Number(minority) * Number(cfg.fundingCapBps)) / 1e4);
    minorityFundGain += f / 1e18; minorityVol += Number(minority) / 1e18;
  }
  skews.sort((a, b) => a - b);
  return {
    meanAbsSkew: skewAbs / Math.max(1, skews.length),
    medianSkew: skews[skews.length >> 1] ?? 0,
    p90AbsSkew: [...skews].map(Math.abs).sort((a, b) => a - b)[Math.floor(skews.length * 0.9)] ?? 0,
    oneSidedPct: oneSided / rounds,
    feePctOfVol: fees / vol,
    noiseRoi: noisePnl / Math.max(1e-9, noiseVol),
    arbRoi: arbPnl / Math.max(1e-9, arbVol),
    minorityFundingPct: minorityFundGain / Math.max(1e-9, minorityVol),
    avgVol: vol / rounds,
  };
}

const pct = (x: number) => (x * 100).toFixed(2) + '%';
let md = `# Funding mechanism — simulation results\n\nGenerated by \`npm run sim\` in \`keeper/\` (seeded, reproducible; 4,000 rounds per cell). Exact bigint contract math (\`src/payout.ts\`, which is fuzz-tested to match the Solidity) is used for every payout.\n\n`;
md += `**Agent model.** Each round, N agents arrive one at a time with a lognormal stake (≈0.22 HYPE median, clipped to the launch caps 0.01–1 HYPE).\n- *Noise traders* pick short with the stated bias regardless of price.\n- *EV traders* estimate P(down) with ±3% noise, look at the live pool (including funding and the payout cap), and join whichever side has positive expected value, otherwise abstain.\n\nPositive "ROI" means that group's average return per unit staked. Fees are 2% of value transferred.\n\n`;
for (const sc of SCENARIOS) {
  md += `## ${sc.name}\n\n| Config | mean abs skew | p90 abs skew | median skew (+ = short-heavy) | one-sided (refunded) rounds | minority funding received | noise trader ROI | EV trader ROI | fees / volume |\n|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of CONFIGS) {
    seed = 42;
    const r = run(sc, c.p);
    md += `| ${c.label} | ${pct(r.meanAbsSkew)} | ${pct(r.p90AbsSkew)} | ${pct(r.medianSkew)} | ${pct(r.oneSidedPct)} | ${pct(r.minorityFundingPct)} | ${pct(r.noiseRoi)} | ${pct(r.arbRoi)} | ${pct(r.feePctOfVol)} |\n`;
  }
  md += '\n';
}
md += `## Key finding and chosen parameters\n\n**Chosen: k = 5% × skew, capped at 2.5% of the crowded side's stake, and the minority side receives at most 50% of its own stake.** The fee is 2% of value transferred, gross profit is capped at 5×, and the launch caps are 1 HYPE per wallet and 25 HYPE per side.\n\nWhy:\n- **Funding does not fix skew. It barely moves it in any scenario, including 95% and 99% short bias.** Pari-mutuel odds and the 5× profit cap already make the minority side +EV, so balancing traders join with or without funding.\n- **One-sided rounds come from too few participants, not from funding.** With a 99% short bias, 18.7% of rounds refund at 30 wallets and 78% at 6 wallets, at every funding level. They refund correctly: the contract returns every deposit.\n- **What funding does change is who pays whom.** Every step up in k moves more value from the biased majority (noise trader ROI falls) to balancers (EV trader ROI rises). A higher k is a bigger tax on retail shorts for no gain in balance.\n- The chosen half-strength setting keeps a visible, honest "shorts pay longs x%" incentive for market makers, at about half the retail cost of the earlier 10%/5% default.\n\n**Model limitation.** The number of agents per round is fixed, so the model cannot show funding *pulling in new* balancing capital. That is the one effect funding could have in production. Measure it on testnet and in the first live rounds before changing k.\n\n`;
md += `## How to read this\n\n- The pari-mutuel pool already rebalances on its own: if 80% of the money is short, a winning long earns about 4x. Funding adds a payment to the minority side that does not depend on the outcome. That draws in balancing capital sooner and makes lopsided rounds cheaper to fix.\n- Funding is a zero-sum transfer from the crowded side to the minority side. It never creates liabilities, and the conservation fuzz tests prove the totals always match.\n- The funding cap (50% of minority stake) keeps a 1-wei minority deposit from collecting a large guaranteed payment.\n\n**Status: proposed, not final.** The parameters are owner-settable within hard bounds, and each round snapshots them on its first deposit. Review these tables before mainnet.\n`;
writeFileSync(new URL('../../../docs/funding-simulation.md', import.meta.url), md);
console.log(md);
