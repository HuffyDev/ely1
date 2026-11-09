# Trust model: what you are trusting

SLOPX is not trustless. This page lists exactly who can do what.

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Keeper** (one hot wallet run by the operator) | Read launches and prices from Elysium, compute the index, and propose each round's result and data hash, once per round. It re-proposes the same result if the guardian rejects it | Move funds, change parameters, propose before a round ends, or overwrite a proposal |
| **Guardian** (operator multisig, recommended) | Reject a proposal during the 10-min dispute window; pause deposits and new proposals; void an unsettled round, which refunds everyone | Redirect funds, block claims, or change payouts |
| **Owner** | Add or deactivate markets; change fee and funding parameters within hard-coded bounds (fee ≤ 5%, funding ≤ 20%); change caps within hard ceilings (≤ 10 HYPE per wallet, ≤ 500 HYPE per side; launch defaults are 1 and 25); change timings within bounds; change keeper, guardian and treasury | Touch deposits, or change the parameters of a round that already has deposits (they are snapshotted on its first deposit) |
| **Anyone** | Call `settle` once the window has passed; call `claim`; recompute any result | — |

## The main trust assumption

**The keeper decides the result.** A malicious or compromised keeper can post a false result. The defences are:

1. **Published data and hash.** Every proposal commits to a JSON hash, and anyone can recompute it. A false result is publicly provable.
2. **Dispute window.** The guardian can reject a false proposal within 10 minutes.
3. **Missing-result refund.** If nothing valid is finalised within 6 hours, everyone is refunded.

These defences mean **you are trusting the operator (keeper + guardian) not to collude.** If both are compromised, one round's losing pool can be paid to the wrong side. That is up to 25 HYPE per side at launch caps, and never more than 500 HYPE. Per-round caps limit that loss.

## Data trust

Launches and prices are read **directly from the Uniswap v4 PoolManager on Elysium mainnet**. No third-party API is involved, and every sample records its block number, so anyone with an archive node can re-read it.

What you still trust:
- that the keeper **sampled honestly and often enough**. It could skip samples, but it cannot invent a price, because every published sample can be checked onchain;
- that thin new coins are not manipulated around the sample windows. See the [threat model](#/docs/threats).

## Operational safeguards

- **No double settlement.** The keeper decides every action from current chain state. The contract also rejects a second proposal or a second settle, so a crash or restart cannot settle a round twice. A SQLite lease stops two keeper processes acting at once.
- **Alerts.** The keeper raises an alert, in its log, on `/api/health` and optionally through a webhook (`ALERT_WEBHOOK_URL`), when:
  - a constituent has no price;
  - a leg has too few coins, so the round will refund;
  - the price sampler goes stale;
  - a round is still unsettled 3h after it ends.

## What is guaranteed by code

- Payouts never exceed deposits. This is fuzz-tested across thousands of random cases.
- Claims and refunds can never be paused.
- A round can only pay out once per wallet.
- Each round's parameters are fixed at its first deposit.

## Not audited

None of the contracts have been audited. Treat every deposit as money you can afford to lose.
