# Trust model: what you are trusting

SLOPX is not trustless. This page lists exactly who can do what.

## Roles

| Role | Can | Cannot |
|---|---|---|
| **Keeper** (one hot wallet run by the operator) | Propose each round's result and data hash, once per round | Move funds, change parameters, propose before a round ends, or overwrite a proposal |
| **Guardian** (operator multisig, recommended) | Reject a proposal during the 10-min dispute window; pause deposits and new proposals; void an unsettled round, which refunds everyone | Redirect funds, block claims, or change payouts |
| **Owner** | Add or deactivate markets; change fee and funding parameters within hard-coded bounds (fee ≤ 5%, funding ≤ 20%); change caps and timings within bounds; change keeper, guardian and treasury | Touch deposits, or change the parameters of a round that already has deposits (they are snapshotted on its first deposit) |
| **Anyone** | Call `settle` once the window has passed; call `claim`; recompute any result | — |

## The main trust assumption

**The keeper decides the result.** A malicious or compromised keeper can post a false result. The defences are:

1. **Published data and hash.** Every proposal commits to a JSON hash, and anyone can recompute it. A false result is publicly provable.
2. **Dispute window.** The guardian can reject a false proposal within 10 minutes.
3. **Missing-result refund.** If nothing valid is finalised within 6 hours, everyone is refunded.

These defences mean **you are trusting the operator (keeper + guardian) not to collude.** If both are compromised, one round's losing pool, up to 500 HYPE per side, can be paid to the wrong side. Per-round caps limit that loss.

## Data trust

Prices come from third-party data (GeckoTerminal) and onchain launchpad events. If that data is wrong or manipulated, the result is wrong even with an honest keeper. See the [threat model](#/docs/threats).

## What is guaranteed by code

- Payouts never exceed deposits. This is fuzz-tested across thousands of random cases.
- Claims and refunds can never be paused.
- A round can only pay out once per wallet.
- Each round's parameters are fixed at its first deposit.

## Not audited

None of the contracts have been audited. Treat every deposit as money you can afford to lose.
