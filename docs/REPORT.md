# SLOPX build report (9 Nov 2026)

## 1. Research findings

Elysium mainnet reportedly launches today, so a lot is still unpublished. "Unverified" below means I could not confirm it and **you must check it before relying on it.**

| Item | Finding | Status |
|---|---|---|
| Elysium is EVM-compatible, settles to HyperEVM, HYPE gas | Arbitrum Orbit chain that settles to HyperEVM. Testnet settles to HyperEVM testnet (998) | Confirmed (Bankless, Chainstack, Alchemy) |
| Chain ID 99901 vs 99801 | **99801 is the testnet.** No public source gives the mainnet ID, so 99901 is unconfirmed | Mainnet ID **unverified**. The code uses `CHAIN_ID` from env |
| Testnet RPC / explorer | `https://testnet-rpc.elysium.kinetiq.xyz`, Alchemy `elysium-testnet.g.alchemy.com`, explorer `explorer-elysium-testnet.t.conduit.xyz` | Third-party sources |
| viem `elysiumTestnet` | **A different chain** (Vulcan Forged, ids 1338/1339). The code defines Kinetiq's chain itself | Confirmed pitfall |
| Markets.xyz | The site was unreachable from the build sandbox (blocked by the proxy). Only a mention of an Android app was found | **Unverified. Check yourself** whether it lists perps or long/short on new Elysium tokens, indexes, or launchpad pairs. If it does, SLOPX overlaps with it |
| Twoprint, $COVERT, $DUST | Nothing specific found | **Unverified** |
| Similar products | Derp.trade (Solana) offers leverage on pump.fun coins. No index/short product on Elysium or HyperEVM found | Absence **not confirmed** |
| Launchpads | Pump.fun, Ascend (KNTQ) and Montra are reported as day-one issuers. Nothing found on Obol, ElysPump, Volta or Kleos | Partially |
| **Creator fees by launchpad** | **No launchpad's creator-fee percentage could be verified.** Pump.fun's Solana "Project Ascend" fee tiers are a *different* thing from the Elysium launchpad Ascend; don't confuse them | **Unverified** |
| GeckoTerminal / DexScreener Elysium slug | Not found yet | **Unverified.** Set `GECKO_NETWORK` once listed |
| `$SLOPX` ticker | No token named SLOPX found on any chain (SLOP, SLOPY and SLPx are different). There is no indexed Elysium token list yet | **Can't confirm it's free on Elysium.** Re-check on the explorer/launchpads before launch |
| Your playbook (`Obsidian Vault/playbook/tech-narrative patterns.md`) | This build ran in a cloud container with no access to your Windows filesystem, so **I could not read it** | Not read |

## 2. What was built

- **`SlopxPools.sol`**: hourly rounds, per-market long/short deposits in native HYPE, skew funding, capped pari-mutuel payouts, per-wallet and per-side caps, keeper proposal plus guardian dispute window, permissionless settle, refunds for one-sided rounds, ties, missing results and guardian voids, pause (deposits and proposals only), unpausable claims, per-round parameter snapshot, bounded admin, two-step ownership, reentrancy guard.
- **Keeper (TypeScript + viem + SQLite)**: restart-safe loop with GeckoTerminal discovery and price sampling, an optional onchain factory-event adapter for launchpad tagging, per-round constituent snapshot, weighted-median index, canonical JSON plus keccak hash, propose and settle, and an event indexer.
- **API server**: serves the site plus JSON (live index, results, proofs, events, user history), a read-only RPC proxy, and a geo check.
- **Website**: markets, live index and constituents (included and excluded), deposit flow with payout preview and a risk acknowledgement, positions and claims, round history, a settlement proof page that **recomputes the result in the browser** and compares hashes, and docs, trust model, threat model and terms. **Every number comes from the contract or from keeper data. There is no mock data.** Empty states say so plainly.

## 3. Test results

| Suite | Result |
|---|---|
| Foundry: 18 unit + 4 fuzz (2,000 runs each) | **22/22 pass** |
| Fuzz: conservation (`lp + sp + fee == L + S`), contract equals reference, funding favours minority, end-to-end solvency with 2–30 wallets | pass |
| Unit: one-sided refund, missing price refund, tie, dispute and re-propose, reject after window blocked, pause blocks deposits and not claims, paused settlement falls back to refund, deposit window, caps, double claim, **reentrancy**, param snapshot, admin bounds | pass |
| TypeScript: index math (median, capped weights, whale resistance, filters, refund rule, hash determinism), payout conservation, Solidity parity | **8/8 pass** |
| Local end-to-end (Anvil, chain 99801, 5-min rounds) | **Pass:** deploy, 6 deposits across 2 markets, funding 0.175 HYPE as designed, keeper snapshot, propose, settle after the dispute window, claims match hand calculation (3.837 / 0.6395 / 4.4335 HYPE, fee 0.09), keeper restart mid-round, recompute CLI hash = onchain hash |

## 4. Funding design: decision needed

Full details are in [funding.md](funding.md) and [funding-simulation.md](funding-simulation.md). **Headline: funding barely moves skew, because the pari-mutuel odds already do the balancing. Funding mostly moves value from biased short traders to whoever takes the other side.** I implemented a modest default (k = 10%, max 5%, minority cap 50%). The owner can adjust it within bounds, and you can set it to zero. **Please review the simulation tables and confirm or change these parameters before mainnet.**

## 5. Testnet status

Elysium testnet deployment **was not done.** The keeper and deployer keys are yours to supply, and the testnet RPC host could not be reached from the build sandbox. Instead, the full loop was run on a local Anvil chain using chain id 99801: deploy, deposit (both markets), funding check, keeper snapshot, propose, dispute window, settle, claim. That run used synthetic test prices in a throwaway database, which was never committed or shown on any real site.

The run found and fixed two bugs:
- a SQL quoting error in constituent selection;
- the keeper using wall-clock time instead of chain time, which made it propose too early on a node whose clock lagged.

## 6. Regulatory flag ⚠️

**This product is functionally a fixed-odds or pari-mutuel bet on a price outcome.** Many regulators would classify it as **gambling, binary options or a derivative/swap**:

- **US:** CFTC (event contracts, swaps) plus state gambling law. Treat it as prohibited without a licence.
- **UK:** the FCA bans retail binary options, and the Gambling Commission also has jurisdiction.
- **EU:** ESMA restricts binary options, and member-state gambling laws apply.
- **Also restrictive:** Singapore, Australia, France and Ontario, among others.
- **Sanctioned jurisdictions:** must be blocked outright.

The default `BLOCKED_REGIONS` is `US,GB,FR,SG,AU,KP,IR,SY,CU,RU,BY`. It is **a starting point, not legal advice.** Geo-blocking only works behind a proxy that sets a country header (e.g. Cloudflare), and the contract itself cannot geo-block. **Get advice from a lawyer in your jurisdiction before offering this anywhere.** The terms page is a draft.

## 7. Coin fee-flow recommendation

- **Creator fees:** I could not verify which Elysium launchpad pays creator fees, or at what percentage. Before launch, open each candidate launchpad's token factory contract on the explorer and confirm (a) that a creator-fee recipient exists in code, (b) its basis points, and (c) whether fees continue after graduation to the DEX. Launch on the one where this is enforced onchain, not one that only promises it in docs.
- **Protocol fees (2% of winnings):** send them to a treasury multisig. A suggested split is **40% buyback-and-burn $SLOPX, 30% insurance fund** (covers keeper gas and backstops bugs), **30% operations**. Keep the coin and the pools separate: **don't** use $SLOPX as collateral in v1.
- Present the token as a community/meme token, not as a claim on revenue. A revenue share can turn it into a security.

## 8. Open risks

1. No audit. **Highest priority before mainnet.**
2. Keeper is a single trusted operator, and a compromised keeper plus guardian can misreport one round (bounded by caps).
3. There is one price source (GeckoTerminal), and its Elysium slug is unconfirmed. Without it, the index has no data.
4. Few launches early on means small constituent sets, which makes manipulation cheaper and refunds more frequent.
5. Launchpad attribution for the pair markets needs verified factory addresses in `keeper/launchpads.json`.
6. Geo-blocking needs a CDN in front of Replit.
7. The mainnet chain ID is unverified.

## Mainnet steps (you do these)

1. Confirm the mainnet chain ID, RPC and explorer from Kinetiq's official docs. Set `CHAIN_ID`, `RPC_URL` and `EXPLORER_URL`.
2. Get an audit. Lower the caps for launch: `setLimits(0.01e18, 1e18, 50e18)`.
3. Create the guardian multisig and the treasury multisig, plus a dedicated burner keeper key funded with ~1 HYPE for gas.
4. Put the keys in `.env` (local) or Replit Secrets. Never paste them anywhere else.
5. `cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify` (add verifier flags for the Elysium explorer).
6. `transferOwnership(<multisig>)`, then `acceptOwnership()` from the multisig.
7. Set `CONTRACT_ADDRESS` and `START_BLOCK`, plus `GECKO_NETWORK` once it is listed, and fill `keeper/launchpads.json` with verified factories.
8. Deploy on Replit as a Reserved VM with `KEEPER_ENABLED=true`. Put Cloudflare in front for region blocking.
9. Watch the first 24 rounds with real but tiny deposits before announcing.
10. Launch the coin separately, after checking the ticker and the creator-fee terms.
