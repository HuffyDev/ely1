# Rules & Risk

<div class="callout"><strong>You can lose everything you deposit.</strong> SLOPX is a betting-like product. It is not investing, and nothing here promises or suggests any return.</div>

## The rules, in plain words

1. **You pick a side for the next hour.** *Long* means you think the index of recent Elysium launches will be higher at the end of the hour than at the start. *Short* means lower.
2. **Deposits close 60 seconds before the hour starts.** After that, the pool is locked.
3. **Winners are paid only from losers.** There is no house money. If your side wins, you get your deposit back plus a share of the losing side's deposits, in proportion to your stake, minus a 2% fee on what you win.
4. **If your side loses, you lose your deposit.** The only exception is that a small part can come back when the profit cap is hit.
5. **Wins are capped** at 5× your effective stake. Anything above the cap goes back to the losing side.
6. **The bigger side pays the smaller side** a funding charge of up to 2.5% of its stake, whether it wins or loses. Most people short, so this usually means shorts pay longs.
7. **You get a full refund, with no fee,** if: one side is empty; the result is exactly flat; there were too few eligible coins (fewer than 5 per leg); no result was finalised within 6 hours; or the guardian voided the round.
8. **Limits while the code is unaudited:** at most **1 HYPE per wallet per market per round**, and **25 HYPE per side per round**.
9. **Claiming is never blocked.** Pausing only stops new deposits and new results.

## What you are trusting

- **The keeper** (run by the operator) computes the index and posts each hourly result. It could post a wrong result.
- **The guardian** (the operator's multisig) has 10 minutes to reject a wrong result. It can also pause deposits or void a round. Voiding a round refunds everyone. The guardian cannot move your money anywhere else.
- **The data** comes from Uniswap v4 pools on Elysium, and thin new coins can be manipulated.
- **You are not trusting** the operator to hold your funds. Payouts are enforced by the contract and can never exceed what was deposited.

Every result's calculation is published, and its hash is stored onchain, so a wrong result can be proven publicly. Proof does not refund you automatically, though. Full details: [what you trust](#/docs/trust) · [threat model](#/docs/threats).

## Unaudited software

The SlopxPools contract **has not been audited.** It has extensive automated tests: unit tests, fuzz tests, and stateful invariant tests checking that the pool can always pay what it owes. Tests cannot rule out every bug. A bug could lose all funds in the contract.

## Betting-like, and possibly regulated

Products like this can count as **gambling, betting, binary options or derivatives**. Many countries restrict or ban them. Whether you may use SLOPX depends on where you live, and **it is your responsibility to check.** Do not use it if it is not allowed where you are, if you are under 18, or if betting is a problem for you.

## Regional blocking

The site blocks deposits from the regions configured by the operator, shown below. It detects your country from a header set by the hosting proxy. **Blocking is a courtesy, not a guarantee.** The contract itself cannot see where you are, and using a VPN to get around blocking breaks these rules.

## No advice, no promises

Nothing on this site is financial, legal or tax advice, an offer of investment, or a prediction. Past rounds say nothing about future rounds. SLOPX is provided as is, with no warranty, to the fullest extent permitted by law.
