# Index methodology (`slopx-index-v1`)

Each round's result is computed from published data, so anyone can recompute it.

## 1. Universe

At round start `S`, a token is a candidate if it launched on an Elysium launchpad within `[S − 24h, S]` and has a priced pool. The launchpad comes from the factory's creation event where one is configured, and otherwise from the DEX/launchpad id reported by the data source.

## 2. Filters (applied at `S`, frozen for the round)

A candidate is **excluded** if any of these are true:

| Filter | Default | Why |
|---|---|---|
| Pool liquidity below the minimum | < $5,000 | Thin coins are cheap to push |
| Too few distinct sellers in the past 24h | < 5 | A token nobody has sold may be a honeypot |
| Flagged unsellable | manual / detector | Excludes tokens that can't be sold |
| Launched outside the 24h window | — | Keeps the universe definition |

The full candidate list, with each exclusion reason, is published every round.

## 3. Weights

Each remaining constituent is weighted by pool liquidity, with **no coin above 10%**. The excess is redistributed iteratively. If there are too few coins for a 10% cap to be feasible (fewer than 10), weights are equal.

## 4. Prices

Each price is the **median of all samples** in the 5 minutes before a boundary (the keeper samples every ~30s):

- start price = median of samples in `[S − 5m, S]`
- end price = median of samples in `[E − 5m, E]`. If there is none, the last sample inside the round is used, so a coin that rugged and stopped trading still counts.

A constituent with no start price, or no price at all during the round, is excluded as `missing-price`.

## 5. Result

- return_i = end_i / start_i
- **leg ratio = weighted median of return_i**, which needs at least 5 priced constituents
- `TRENCH24` result = leg ratio. Pair result = leg A ratio ÷ leg B ratio.
- If any leg has too few constituents, the result is **1.0**, which refunds the round.
- **Long wins if the result is above 1.0. Short wins if it is below.**

## 6. Proof

The keeper serialises the whole computation as canonical JSON (sorted keys). That includes every candidate, its exclusion reason, raw price samples, weights and returns. It posts `keccak256(json)` onchain with the result. The site serves the exact bytes at `/api/result/<market>/<round>/raw`, and every proof page re-runs the calculation in your browser.

```
npm run recompute -w keeper -- https://<site>/api/result/0/123/raw 0x<onchain dataHash>
```
