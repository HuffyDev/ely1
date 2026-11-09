# Index methodology (`slopx-index-v2.1`)

All index data is read **directly from Elysium mainnet**. No third-party price API is used. Every number can be recomputed from the published round JSON, and every raw sample can be re-read from chain with an archive RPC.

| Source | Where |
|---|---|
| Chain | Elysium mainnet, chain id 99901 (checked with `eth_chainId` on `rpc.elysium.kinetiq.xyz`) |
| Pools | Uniswap v4 **PoolManager** `0xe2e105d3f7209a9da11f83ccf3e7398a753823f1`: code is present on mainnet and `owner()` responds. It is **not** on testnet: that address has no code there |
| Quote | Native HYPE, or WHYPE `0xba876237b0f021a6c6d852d6c26e107997cc5e81` (`symbol()` = "WHYPE") |

## 1. Discovering launches

The keeper indexes every PoolManager `Initialize` event. A pool counts as a **launch** if one side is HYPE or WHYPE and the other side is the token. Pools quoted in USDC or other assets are out of scope for v2.

**Launchpad attribution.** Each v4 pool names a *hook* contract. Launchpads deploy pools through their own hook, so the hook address is the launchpad's onchain fingerprint. Whether a hook counts as a launchpad is decided by data:

- a hook that created **at least 25 pools** in the 24h window counts as a launchpad, or
- a hook listed in `keeper/launchpads.json` with a **verified** label (for example `montra`) counts too.

Pools with no hook (plain Uniswap positions) are excluded. They are usually new pools for old tokens, not launches.

Launchpad *names* appear only after their hook addresses are verified against an official source. Until then the site shows the hook address. Pair markets such as MONTRA/ASCEND refund until their legs have verified hooks.

## 2. Universe (frozen at round start `S`)

A token is a candidate if its pool was initialised in blocks `[block(S − 24h), block(S) − 1]`. `block(t)` is the first block with a timestamp ≥ t, found by binary search, which makes it exact and reproducible. Where a token has several pools, the deepest pool is used.

## 3. Filters

| Filter | Default | Why |
|---|---|---|
| Not a launchpad pool | see §1 | Keeps the universe to new launches |
| **Depth** below the minimum | < **150 HYPE** | Every launch starts at ≈ 84 HYPE of *virtual* depth, from single-sided seed liquidity. 150 HYPE means real buying has happened. On 9 Nov, 92 of 20,672 HYPE-quoted pools cleared this bar |
| Distinct sellers in the window | < 5 | "Can it be sold?" Requires at least 5 different `tx.from` addresses that paid the token into the pool. This excludes honeypots and tokens with no exit |
| Flagged unsellable | manual | Operator override, published |

**Depth** is the pool's in-range virtual HYPE reserve × 2, computed from `liquidity` and `sqrtPriceX96`. It measures how much HYPE it takes to move the price, which is the quantity that matters for manipulation resistance.

## 4. Prices

`price = HYPE per token`, from the pool's `slot0.sqrtPriceX96`, read with `PoolManager.extsload` at a **pinned block number**. The keeper samples every ~30s and stores `(block, timestamp, sqrtPriceX96)`.

- start price = median of the samples in `(S − 5m, S]`
- end price = median of the samples in `(E − 5m, E]`. If there is none, the last sample inside the round is used, so a coin that rugs still counts.
- no start or end sample at all means `missing-price`, and the coin is excluded.

## 5. Weights and result

- return_i = end_i / start_i
- weight_i ∝ depth_i, **capped at 10%**, with the excess redistributed. Weights are equal if there are fewer than 10 coins.
- **leg ratio = weighted interquartile mean (IQM)** of the returns, which needs at least 5 priced constituents. Sort the returns, drop the lowest and highest 25% of the *weight*, and take the weight-averaged log-return of the middle 50%.

**Why the IQM rather than a plain median.** In the first real fork round on 9 Nov, 11 of 25 constituents did not trade at all during the round, so their return was exactly 1.000. A plain median landed on 1.000, the round was a tie, and it refunded. That would happen in most rounds. The IQM is still a median-family estimator: to move it, an attacker must move more than 25% of index weight, and with the 10% cap that means at least 3 coins. It does not stick at exactly 1.0, though.
- `TRENCH24` result = leg ratio. Pair result = leg A ÷ leg B.
- If any leg has too few constituents, the result is **1.0**, which refunds the round. Long wins above 1.0, and short wins below.

## 6. Proof and recomputation

The keeper publishes the full computation as canonical JSON: every candidate, each exclusion reason, hook counts, block window, raw samples, weights and returns. It posts `keccak256(json)` onchain with the result.

```
npm run recompute -w keeper -- https://<site>/api/result/0/123/raw 0x<onchain hash> --verify-chain <elysium archive rpc>
```

This command:
- recomputes the result;
- checks the hash;
- re-reads **every** price sample from the PoolManager at its block.

Each proof page also re-runs the calculation in your browser.
