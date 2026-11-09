# Threat model

Scope: `SlopxPools.sol`, the keeper, the index, and the website. Severity is rated at launch caps: 1 HYPE per wallet and 25 HYPE per side per round, with hard ceilings of 10 and 500.

| # | Threat | Attack | Mitigation | Residual risk |
|---|---|---|---|---|
| 1 | **Thin-coin manipulation** | Pump a tiny new coin to drag the index | Depth filter (150 HYPE, ~2× the launch seed); weighted **median**, not mean; 10% per-coin cap; frozen constituent list | To move the median you must move roughly half the index weight. With few constituents (5–10) that is cheap. **Medium** |
| 2 | **End-of-round price push** | Buy or sell constituents just before `E` | Price = median of ~10 samples over 5 minutes, so the push must be held for over 2.5 minutes; median across coins; caps | A well-funded attacker can still push several mid-weight coins. Profit is bounded by the losing pool and the per-wallet cap. **Medium** |
| 3 | **Start-price push** | Push prices at `S` (after deposits close at `S−60s`) to set a favourable base | Same 5-min median at `S`; deposits close before `S` | Same as #2 |
| 4 | **Honeypot / unsellable token** | Launch a token that can't be sold, so its price only goes up | Requires ≥ 5 distinct `tx.from` sellers seen onchain in 24h, plus an unsellable flag | A token whose sells are restricted to a whitelist of colluding sellers can still pass. **Low–medium** |
| 5 | **Wash-launch spam / fake launchpad** | Launch many coins, or deploy a hook that mints 25+ pools to qualify as a 'launchpad' | Depth and seller filters apply to every coin; median; 10% cap | Each spam coin needs 150 HYPE of depth and 5 distinct sellers. **Low–medium** |
| 6 | **Keeper posts a false result** | Compromised key | Hash commitment and public recompute; guardian rejection during a 10-min window; per-round caps | Keeper and guardian colluding can steal one round's losing pool. **High impact, low likelihood.** See trust model |
| 7 | **Keeper offline** | Crash or RPC outage | Restart-safe keeper (all state in SQLite and onchain); anyone can `settle`; automatic refund after 6h | Funds sit idle for up to 6h. **Low** |
| 8 | **Data RPC failure / lying RPC** | Elysium RPC down, or returning false state | Missing prices exclude coins; too few coins → 1.0 refund; alerts; every sample's block is published and can be re-checked on an independent archive node (`--verify-chain`) | A lying RPC is caught only if someone runs the verification. Run a second RPC cross-check before raising caps. **Medium** |
| 9 | **Reentrancy** | Malicious receiver re-enters `claim` | `nonReentrant` on every function that pays out; `claimed` set before the transfer (checks-effects-interactions); tested | **Low** |
| 10 | **Rounding / insolvency** | Rounding drift drains the pool | All divisions round down in the pool's favour; fuzz-tested so that sum(payouts) + fee ≤ deposits | Dust (≤ 1 wei per claimant) stays in the contract. **None** |
| 11 | **Funding farming** | Deposit a tiny amount on the empty side to collect funding | Funding received is capped at 50% of the minority stake; minimum deposit | Rational arbitrage, by design. Reported in the simulation |
| 12 | **Self-hedging both sides** | Deposit long and short to farm funding | Funding is a transfer between the two sides, so hedging yourself pays yourself; the per-wallet cap applies to both sides combined | **None** |
| 13 | **Admin abuse** | Owner raises fees mid-round | Parameters snapshotted per round; hard bounds; two-step ownership transfer | Owner can set a 5% fee on future rounds. **Low** |
| 14 | **Front-running deposits** | See the pool and deposit last | Pari-mutuel odds are public by design; deposits close before the round starts, so no price information leaks | **None** |
| 15 | **Sequencer / L2 risk** | Elysium sequencer down or reorg | Refund after 6h; 0.1s blocks | Depends on Elysium. **Medium** |
| 16 | **Website / phishing** | Fake frontend | Contract address published in the README; the site never asks for keys | **Medium** |
| 17 | **Regulatory** | Offered in a jurisdiction where it is illegal | Region blocklist config, terms gate, acknowledgement modal | Geo-blocking needs a country header from your proxy (e.g. Cloudflare). Self-attestation is weak. **High** — see the report |

## Recommended before mainnet

1. An independent audit of `SlopxPools.sol`.
2. A guardian multisig, kept separate from the keeper key.
3. A watcher run on independent infrastructure that `--verify-chain`s every proposal during the dispute window and rejects any mismatch (the guardian key can do this).
4. Keep the launch caps (1 HYPE per wallet, 25 HYPE per side) until there is an audit and live history.
5. A minimum constituent count higher than 5 once the ecosystem is large enough.
