# SLOPX build report — second pass (9 Nov 2026)

## 0. Honest audit of the first pass (before this pass's changes)

| Area | First-pass reality |
|---|---|
| Contract | **Real and working.** 22 tests passed. Caps were high (10 HYPE per wallet, 500 per side) |
| Index data | **Stubbed.** The GeckoTerminal adapter had no network slug set, and the launchpad factory list was empty. The "real" index therefore had **no data source**. The only index results ever computed came from a **synthetic seeder** (fake `TEST0…TEST13` tokens) in a throwaway local database |
| Launchpad attribution | **Not real.** It was a config of names with no addresses |
| "Unsellable" detection | **Planned only.** It relied on a sellers count from an API that was never connected, and no detector existed |
| Keeper E2E | **Real, but only on a blank local Anvil chain** with the synthetic prices above. It found and fixed 2 bugs |
| Alerts | **None** |
| Keeper double-run protection | **None** (single process assumed) |
| Funding | Implemented. The simulation only covered moderately one-sided markets |
| UI | Worked, but used a neon-green casino style, had dark mode only, and its first screen was too busy |
| Testnet / mainnet | **Never deployed.** I couldn't reach any Elysium host from the sandbox |
| Markets.xyz check | **Not done** (blocked) |

## 1. What changed in this pass

### Positioning
I reached Markets.xyz after this session's network access was widened. Markets.xyz is **"Markets.xyz by Kinetiq"**: 24/7 perps on stocks, indices, commodities and crypto, settled on Hyperliquid. It does **not** offer a new-launch basket, a launchpad pair or memecoin shorts.

SLOPX is therefore positioned as **the way to short the whole Elysium trench at once**: the TRENCH24 index plus launchpad-vs-launchpad pairs. Single-coin shorts are deliberately not offered. The site headline is "Bet against every coin launched on Elysium in the last 24 hours."

### Verified facts (checked onchain this pass)
- `eth_chainId`: `rpc.elysium.kinetiq.xyz` returns **99901**, and `testnet-rpc.elysium.kinetiq.xyz` returns **99801**.
- **Uniswap v4 PoolManager `0xe2e105d3f7209a9da11f83ccf3e7398a753823f1`:**
  - mainnet has 48 KB of code there, and `owner()` returns `0xA9aE…Da8D`;
  - **testnet has no code there**, which confirms what you saw;
  - I could **not** find it in Uniswap's official deployment docs: they render client-side, and a GitHub code search for the address returned nothing. The address is therefore verified **by RPC only**.
- **WHYPE** `0xba876237…5e81`: `symbol()` returns "WHYPE".
- **Multicall3** is deployed at the canonical address.
- **Block time** is ≈ 0.105 s, about 820k blocks per day.

### Real index, fully onchain (no APIs)
- **Launches:** every PoolManager `Initialize` event, HYPE/WHYPE-quoted. **20,672 pools were seen in 26 h.**
- **Launchpad:** the pool's v4 hook address. A hook counts as a launchpad if it created ≥ 25 pools in the window. On 9 Nov, hook `0x6b12…` alone created 17,321 pools. **No hook could be matched to a launchpad name (Montra, Ascend, …), because no official source publishes those addresses.** Names stay unverified until you confirm them, and pair markets refund until then.
- **Price:** `slot0.sqrtPriceX96` read with `extsload` at a pinned block. This was checked against GeckoTerminal's price for the same pool.
- **Depth:** the in-range virtual HYPE reserve × 2. **Launch seed liquidity ≈ 84 HYPE**, so the floor is set at **150 HYPE**. Only 92 of 20,672 pools cleared it.
- **Sellability:** at least 5 distinct `tx.from` sellers, taken from `Swap` events. **45 tokens** passed both the depth and the seller filters.
- **Proof:** every round publishes every candidate with its exclusion reason, the hook counts, the block window, and each sample's block and `sqrtPriceX96`. `recompute --verify-chain` re-reads every sample from an archive node.
- **Method change, forced by real data:** in the first real fork round, 11 of 25 constituents didn't trade, so the plain weighted median was exactly 1.000 and the round refunded as a tie. The index now uses the **weighted interquartile mean** (`slopx-index-v2.1`). It still needs more than 25% of weight to move, but it doesn't stick at 1.0.

### Balance / funding
- **Simulated** with heavily one-sided markets (95% and 99% short bias), under the new launch caps.
- **Finding:** funding does **not** reduce skew in any scenario. Refunds come from too few participants, not from funding: with a 99% short bias, 18.7% of rounds refund at 30 wallets and 78% at 6 wallets. What funding does change is how much the biased majority pays.
- **Chosen parameters:** k = 5% × skew, max 2.5% of the crowded side's stake, minority cap 50%. That is half the earlier default.

### Safety changes
- **Launch caps lowered to 1 HYPE per wallet and 25 HYPE per side per round, with hard ceilings of 10 / 500** that even the owner cannot exceed.
- **Stateful invariant fuzzing** added: 25,600 random calls covering deposits, proposals, rejections, settles, voids, pauses, claims and fee withdrawals. The pool stays solvent throughout.
- **Keeper:**
  - a SQLite lease stops two keepers acting at once;
  - actions are driven by chain state, so a restart cannot double-settle;
  - alerts (log, `/api/health`, optional webhook) fire for missing prices, thin legs, a stale sampler and rounds still unsettled near the refund deadline.
- **Rules & Risk page:**
  - plain-language rules;
  - total-loss risk and unaudited status;
  - "betting-like, possibly regulated, not investing";
  - the **live region-block config**.

### UI
Near-monochrome, with one indigo accent and no neon. Light and dark modes (system preference plus a toggle). Inter and JetBrains Mono, with subtle motion. The first screen is one sentence, the live TRENCH24 value and one Long / Short action. It shows real numbers only, with explicit empty states.

## 2. Status

### Proven working (run against real Elysium mainnet data)
- Launch discovery, pricing, depth and seller indexing on live mainnet, plus constituent snapshots of **25 real tokens** and per-round result computation.
- `recompute` reproduces the published result and hash.

### Tested locally only (fork of Elysium mainnet, contract on the fork)
- deposits from 6 wallets under the caps;
- the cap revert;
- funding, which matched the formula: 0.095 HYPE moved from shorts to longs;
- a deposit reverting while paused;
- guardian rejection inside the dispute window;
- a **keeper killed mid-dispute and restarted**, which re-proposed the identical hash;
- settlement and claims;
- the missing-price refund after 660 s;
- a second settle reverting;
- fee accounting (see the run-2 numbers below).

The contract tests (24 unit/fuzz + 2 invariants) and the TypeScript tests (12) all pass.

**Fork E2E run 3 (`scripts/fork-e2e.sh`, 9 Nov 11:48–12:11 UTC), against live mainnet index data:**
- **Deposits:** 11, from 6 wallets across 3 markets. The over-cap deposit reverted, and so did the deposit made while paused.
- **TRENCH24 #1:** 24 real constituents, result **1.005390** (+0.54%), long won.
  - Effective stakes after funding: 0.595 long / 3.705 short (funding 0.095 HYPE).
  - The 5× profit cap bound, so 2.975 HYPE moved to longs and 0.73 HYPE was returned to shorts.
  - Long payout: 3.5105 HYPE on a 0.5 HYPE stake.
- **Hook pair `0xe0de` vs `0x3ab8` #1:** 12 vs 9 constituents, result **1.013309**, long won. Longs were the crowded side and paid 1.29% funding.
- **Guardian rejection, then keeper killed and restarted:** it re-proposed the **identical** hash.
- **Fees:** 0.0799386 HYPE accrued, and exactly that reached the treasury.
- **ORPHAN market:** got no result, so it **refunded** after 660s, at 0.3 HYPE per wallet.
- **Resolution:** exactly one resolution event per market-round, and a second `settle` reverts on all 3.
- **Dust:** 4 wei left in the contract after all claims.
- **Independent recompute against real Elysium mainnet:** results and hashes **match**, and `--verify-chain` re-read **72/72** and **63/63** samples, all matching.
- **Bugs this pass's fork runs found and fixed:**
  - a plain median stuck at exactly 1.0 on real data, so rounds tied (switched to the IQM);
  - stale results were reused after a contract redeploy with the same DB (fixed with deployment binding);
  - the test driver didn't really kill the keeper (fixed).

### Not done
- No testnet or mainnet deployment.
- The UI was not tested with a real browser wallet. It was rendered with Playwright against the fork; it has no injected wallet.

### Still blocks a safe launch
1. **No audit** of `SlopxPools.sol`.
2. **Launchpad names are unverified.** No hook can be labelled Montra, Ascend and so on until official addresses exist, so pair markets refund until then.
3. **Sampling trust:** the keeper chooses when to sample. The samples are verifiable but selectable. Run an independent watcher that re-checks every proposal during the 10-minute window.
4. **Short test rounds:** the fork rounds were 5 minutes with 60 s windows. Production is 1 h with 5-minute windows and has not been observed live yet.
5. **The guardian must be a multisig**, separate from the keeper key.
6. **Regulation:** this is betting-like. The default blocklist (`US, GB, FR, SG, AU, CA-ON` plus sanctioned countries) is a starting point, not legal advice, and it works only behind a CDN that sets a country header. **Get legal advice for every region you intend to serve.**
7. **The Uniswap v4 address** is verified by RPC, not yet by an official Uniswap page.
8. **Ascend** reportedly quotes pools in USDC or RWAs, which index v2.1 excludes (HYPE/WHYPE only).

## 3. Exact deployment steps (you do these)

**Testnet (settles on 99801, reads data from mainnet)**
1. Create burner keys: a deployer, a keeper (fund it with a little testnet HYPE) and a guardian (ideally a multisig). Put them in `.env`, which is gitignored, or in Replit Secrets.
2. Set `CHAIN_ID=99801`, `RPC_URL=https://testnet-rpc.elysium.kinetiq.xyz` and `DATA_RPC_URL=https://rpc.elysium.kinetiq.xyz`.
3. Deploy:
   ```bash
   cd contracts && forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
   ```
4. Set `CONTRACT_ADDRESS` and `START_BLOCK` (the deploy block), then run `npm start` with `KEEPER_ENABLED=true`.
5. Run at least 48 hourly rounds. Check every `/api/result/*/*/raw` with `recompute --verify-chain`.

**Mainnet (after the audit)**
1. Set `CHAIN_ID=99901`, `RPC_URL=https://rpc.elysium.kinetiq.xyz`, and the explorer URL.
2. Deploy with the same script. **Keep the launch caps.** `transferOwnership(multisig)` and `acceptOwnership()`; `setGuardian(multisig)`; `setTreasury(multisig)`.
3. Verify the source on the explorer, and publish the address in the README.
4. Replit: use a Reserved VM, put Cloudflare in front, set `BLOCKED_REGIONS` and `ALERT_WEBHOOK_URL`.
5. Add **verified** launchpad hooks to `keeper/launchpads.json`, citing the official source for each.
6. Launch the $SLOPX coin separately, after re-checking the ticker and creator-fee terms on the launchpad you choose. The creator fee is still **unverified** for every launchpad.
