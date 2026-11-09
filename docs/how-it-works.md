# How SLOPX works

SLOPX lets you bet whether the Elysium trenches go up or down over the next hour. You can also bet on whether one launchpad's coins beat another's.

<div class="callout">You can lose your entire deposit. SLOPX is unaudited, experimental software. Read the <a href="#/terms">Terms &amp; Risk</a> page before using it.</div>

## The short version

1. **Pick a market.** `TRENCH24` tracks every token launched on Elysium in the past 24 hours. `MONTRA/ASCEND` compares Montra launches with Ascend launches.
2. **Pick a side and deposit HYPE** into the *next* hourly round. Deposits close 60 seconds before the round starts.
3. **The round runs for one hour.** The constituent list is frozen at the start.
4. **At the end,** the keeper posts the result: the median return of the constituents over the hour.
5. **Winners split the losers' deposits** in proportion to their stake, minus a 2% fee on the winnings. Claim from the market page.

## Where the money comes from

SLOPX is **pari-mutuel**: there is no house taking the other side of your bet. Everything paid to winners comes out of the losing side's deposits, so the pool can never owe more than it holds.

- If 90% of the money is short and shorts win, each short earns a small profit (about 11% before fees).
- If longs win the same round, each long earns a large profit (about 9× before fees and the cap).

The more lopsided the pool, the better the odds for the unpopular side. The market page shows a live preview.

## Funding: the crowded side pays

Most people will want to short. On top of the odds above, the side with more money pays the other side a **funding** charge, whatever the outcome:

- rate = 10% × skew, capped at 5% of the crowded side's stake
- the minority side can receive at most 50% of its own stake this way

This is a transfer between depositors. It is never new money. See [funding design and simulation](#/docs/funding).

## Caps

The code is new and unaudited, so it limits exposure:

| Limit | Default |
|---|---|
| Minimum deposit | 0.01 HYPE |
| Max per wallet, per market, per round | 10 HYPE |
| Max per side, per market, per round | 500 HYPE |
| Max gross profit | 5× your effective stake (excess goes back to the losers) |

## When you get your money back (refunds)

You get your full deposit back, with no fee, if:

- **one side is empty** when the round ends,
- the result is **exactly flat**,
- the index has **too few eligible coins** (fewer than 5 per leg), so the keeper posts 1.0,
- **no result is finalised within 6 hours** of the round ending (keeper failure, disputes, or pause),
- the **guardian voids the round** in an emergency. The guardian can only trigger refunds and can never redirect funds.

Claims and refunds **can never be paused**.

## Settlement timeline

1. Round ends at `T`.
2. The keeper proposes the result, posting the hash of the full calculation JSON.
3. **Dispute window (10 min):** the guardian can reject a bad proposal, and the keeper must re-propose.
4. Anyone can call `settle`. Winners claim.
5. If nothing is finalised by `T + 6h`, the round is refunded.
