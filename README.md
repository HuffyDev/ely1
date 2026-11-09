# $SLOPX — short the Elysium trenches

> Every coin here only goes one way. Now short all of them.

**The pitch: short the whole trench at once.** SLOPX runs hourly pari-mutuel long/short pools on:
- (a) **TRENCH24**, a median index of every token launched on Elysium in the past 24 hours;
- (b) **launchpad-vs-launchpad pairs**.

Single-coin shorts are deliberately not the product. Kinetiq's own Markets.xyz offers 24/7 perps on stocks, commodities and crypto, but nothing on new-launch baskets.

Winners are paid only from losers' deposits. There is no leverage and no liquidation engine.

**Data is 100% onchain.** Launches come from Uniswap v4 `Initialize` events on Elysium mainnet, prices from pool `slot0`, and sellers from `Swap` events. Every round publishes the block of every price sample.

**⚠️ Unaudited. Betting-like. May be regulated where you are. See [docs/REPORT.md](docs/REPORT.md) before doing anything on mainnet.**

```
contracts/   Solidity + Foundry: SlopxPools.sol, tests (unit + fuzz), deploy script
keeper/      TypeScript: viem keeper, index engine, SQLite, HTTP API, funding simulation, recompute CLI
web/         Vite + vanilla TS website (markets, live index, deposit, history, proofs, docs, terms)
docs/        design, funding simulation, index method, trust model, threat model, terms, report
```

## Quick start (local)

```bash
npm install
cp .env.example .env          # fill in yourself; never commit
npm run build                 # builds the website
npm run server                # http://localhost:3000 (API + site; KEEPER_ENABLED=true also runs the keeper)
```

Contracts need [Foundry](https://book.getfoundry.sh):

```bash
cd contracts && forge install foundry-rs/forge-std --no-git   # if lib/ is empty
forge test                     # 24 unit/fuzz tests (fuzz: 2,000 runs) + 2 stateful invariants (25,600 calls)
```

TypeScript tests and the funding simulation:

```bash
npm run test:ts
npm run sim                    # regenerates docs/funding-simulation.md
```

Full-round local fork test (no mainnet transactions are sent; the keeper reads live mainnet data):

```bash
anvil --fork-url https://rpc.elysium.kinetiq.xyz --port 8546 --block-time 1 &
./scripts/fork-e2e.sh          # ~25 min: deposits, pause, snapshot, dispute, keeper restart, settle, claims, fees, missing-price refund
```

## Running on Replit

The repo includes `.replit`. Put every `.env` value in **Secrets** (not a file). Use a **Reserved VM** deployment, not Autoscale: the keeper loop and SQLite need a single persistent process. Set `KEEPER_ENABLED=true` to run the keeper in the same process as the site. Node 22.21+ needs `NODE_USE_ENV_PROXY=1` only if the host forces an HTTP proxy; Replit does not.

## How settlement works

1. Users deposit into round `N` before it starts (deposits close `lockBuffer` = 60s before).
2. At round start the keeper freezes the constituent list. At round end it computes the weighted-median return and posts `proposeResult(market, round, resultE18, keccak256(json))`.
3. After a 10-minute dispute window (the guardian can reject), **anyone** can call `settle`.
4. Winners `claim`. Rounds are refunded if one side is empty, the result is flat, there are too few constituents (result 1.0), or nothing is finalised within 6h.

Full write-ups: [how it works](docs/how-it-works.md) · [index method](docs/index-method.md) · [funding + simulation](docs/funding.md) · [trust model](docs/trust.md) · [threat model](docs/THREAT_MODEL.md) · [terms](docs/terms.md)

## Testnet deployment (Elysium testnet, chain 99801)

Note: the testnet has **no Uniswap v4** (the PoolManager address has no code there). So on testnet, keep `DATA_RPC_URL` pointed at **mainnet**: the index is read from mainnet, and settlement happens on testnet.

```bash
cd contracts
source ../.env   # DEPLOYER_PRIVATE_KEY, KEEPER_ADDRESS, GUARDIAN_ADDRESS, TREASURY_ADDRESS
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast
# then set CONTRACT_ADDRESS and START_BLOCK in .env / Replit Secrets and restart the server
```

Mainnet steps are in [docs/REPORT.md](docs/REPORT.md#mainnet-steps-you-do-these). **The operator does them, not this repo's automation.**

## Keys

- Burner wallets only. Keys go in `.env` (gitignored) or Replit Secrets.
- The code never logs keys. The browser RPC proxy (`/api/rpc`) allows **read-only** methods only.
