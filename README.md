# $SLOPX — short the Elysium trenches

> Every coin here only goes one way. Now short all of them.

Hourly pari-mutuel long/short pools on (a) a median index of every token launched on Elysium in the past 24h and (b) launchpad-vs-launchpad pairs such as Montra vs Ascend. Winners are paid only from losers' deposits. There is no leverage and no liquidation engine.

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
forge test                     # 22 tests incl. 4 fuzz suites (2,000 runs each)
```

TypeScript tests and the funding simulation:

```bash
npm run test:ts
npm run sim                    # regenerates docs/funding-simulation.md
```

## Running on Replit

The repo includes `.replit`. Put every `.env` value in **Secrets** (not a file). Use a **Reserved VM** deployment, not Autoscale: the keeper loop and SQLite need a single persistent process. Set `KEEPER_ENABLED=true` to run the keeper in the same process as the site.

## How settlement works

1. Users deposit into round `N` before it starts (deposits close `lockBuffer` = 60s before).
2. At round start the keeper freezes the constituent list. At round end it computes the weighted-median return and posts `proposeResult(market, round, resultE18, keccak256(json))`.
3. After a 10-minute dispute window (the guardian can reject), **anyone** can call `settle`.
4. Winners `claim`. Rounds are refunded if one side is empty, the result is flat, there are too few constituents (result 1.0), or nothing is finalised within 6h.

Full write-ups: [how it works](docs/how-it-works.md) · [index method](docs/index-method.md) · [funding + simulation](docs/funding.md) · [trust model](docs/trust.md) · [threat model](docs/THREAT_MODEL.md) · [terms](docs/terms.md)

## Testnet deployment (Elysium testnet, chain 99801)

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
