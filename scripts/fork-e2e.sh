#!/usr/bin/env bash
# Full-round end-to-end test on a LOCAL FORK of Elysium mainnet.
#   - SlopxPools deployed on an anvil fork (chain 99901); no mainnet transactions are ever sent.
#   - The keeper reads LIVE launches/prices from real Elysium mainnet (DATA_RPC_URL) and settles on the fork.
#   - Exercises: multi-wallet deposits under launch caps, funding, pause, index snapshots, guardian dispute
#     + re-proposal, keeper restart mid-round, settlement, winner claims, fee accounting, missing-price refund.
# Uses anvil's public well-known test keys only. Requires: anvil fork running on $FORK (see README).
set -euo pipefail
export PATH=$HOME/.foundry/bin:$PATH
ROOT=$(cd "$(dirname "$0")/.." && pwd)
FORK=${FORK:-http://127.0.0.1:8546}
WORK=${WORK:-$ROOT/.e2e}; mkdir -p "$WORK"
DB=$WORK/fork.sqlite
[ -n "${SEED_DB:-}" ] && cp "$SEED_DB" "$DB"
LOG=$WORK/e2e.log; : > "$LOG"
say() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG"; }
# anvil default accounts (public test keys)
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
KEEPER_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
U_PK=(0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e 0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356 0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97)
addr() { cast wallet address "$1"; }
now() { cast block latest -f timestamp --rpc-url $FORK; }
waitts() { until [ "$(now)" -ge "$1" ]; do sleep 3; done; }

say "chain id: $(cast chain-id --rpc-url $FORK)"
cd "$ROOT/contracts"
OUT=$(DEPLOYER_PRIVATE_KEY=$OWNER_PK KEEPER_ADDRESS=$(addr $KEEPER_PK) GUARDIAN_ADDRESS=$(addr $OWNER_PK) TREASURY_ADDRESS=$TREASURY ROUND_DURATION=300 \
  forge script script/Deploy.s.sol --rpc-url $FORK --broadcast 2>&1)
C=$(echo "$OUT" | grep -oE "SlopxPools 0x[0-9a-fA-F]{40}" | awk '{print $2}'); G=$(echo "$OUT" | grep -oE "genesis [0-9]+" | awk '{print $2}')
say "deployed SlopxPools $C genesis $G"
cast send $C "setTiming(uint256,uint256,uint256)" 10 60 660 --private-key $OWNER_PK --rpc-url $FORK >/dev/null
cast send $C "addMarket(string)" "ORPHAN (no keeper feed: tests missing-price refund)" --private-key $OWNER_PK --rpc-url $FORK >/dev/null
echo "$C $G" > "$WORK/contract.txt"

pkill -f "src/server.ts" || true; sleep 1
say "starting keeper+server (settle on fork, data from live Elysium mainnet)"
start_keeper() {
  (cd "$ROOT/keeper" && env NODE_USE_ENV_PROXY=1 DB_PATH=$DB CHAIN_ID=99901 CHAIN_NAME="Elysium mainnet fork (local)" RPC_URL=$FORK \
    DATA_RPC_URL=https://rpc.elysium.kinetiq.xyz CONTRACT_ADDRESS=$C KEEPER_PRIVATE_KEY=$KEEPER_PK KEEPER_ENABLED=true \
    SAMPLE_INTERVAL_SEC=15 SAMPLE_WINDOW_SEC=60 PORT=3000 \
    MARKETS_JSON='[{"id":0,"name":"TRENCH24","legs":[{"name":"All launches (24h)","launchpads":"all"}]},{"id":1,"name":"HOOK-E0DE/HOOK-3AB8","legs":[{"name":"hook 0xe0de","launchpads":["0xe0def4221b9840a610d4e7d55812a79a6431a8ec"]},{"name":"hook 0x3ab8","launchpads":["0x3ab88ddc3cf2a012af88b60828edb4553697e5dc"]}]}]' \
    npx tsx src/server.ts >> "$WORK/keeper.log" 2>&1 & echo $! > "$WORK/keeper.pid")
}
start_keeper

R=1; S1=$((G + 300)); E1=$((G + 600))
say "round $R: [$S1, $E1]; waiting for genesis so round $R opens for deposits"
waitts $((G + 1))
dep() { cast send $C "deposit(uint256,uint256,uint8)" $1 $R $2 --value $3 --private-key ${U_PK[$4]} --rpc-url $FORK >/dev/null && say "  wallet$4 market$1 $( [ $2 = 0 ] && echo LONG || echo SHORT ) $3"; }
say "deposits (launch caps: 1 HYPE/wallet/round)"
dep 0 1 1ether 0; dep 0 1 1ether 1; dep 0 1 0.8ether 2; dep 0 1 1ether 3; dep 0 0 0.5ether 4
dep 1 0 1ether 0; dep 1 0 0.7ether 5; dep 1 1 0.6ether 1; dep 1 1 0.4ether 2
dep 2 0 0.3ether 3; dep 2 1 0.3ether 4
if cast send $C "deposit(uint256,uint256,uint8)" 0 $R 1 --value 0.5ether --private-key ${U_PK[0]} --rpc-url $FORK >/dev/null 2>&1; then say "FAIL: per-wallet cap not enforced"; exit 1; else say "  ok: 2nd deposit over 1 HYPE wallet cap reverted"; fi
say "funding market0 (effL,effS): $(cast call $C 'fundingFor(uint256,uint256)(uint256,uint256)' 0 $R --rpc-url $FORK | tr '\n' ' ')"

say "pause test"
cast send $C "setPaused(bool)" true --private-key $OWNER_PK --rpc-url $FORK >/dev/null
if cast send $C "deposit(uint256,uint256,uint8)" 1 $R 0 --value 0.1ether --private-key ${U_PK[4]} --rpc-url $FORK >/dev/null 2>&1; then say "FAIL: deposit while paused"; exit 1; else say "  ok: deposit reverted while paused"; fi
cast send $C "setPaused(bool)" false --private-key $OWNER_PK --rpc-url $FORK >/dev/null; say "  unpaused"

say "waiting for round $R to start (keeper snapshots constituents)"; waitts $((S1 + 20))
say "waiting for round end + keeper proposal"; waitts $E1
until [ "$(cast call $C 'proposals(uint256,uint256)(uint256,bytes32,uint64)' 0 $R --rpc-url $FORK | sed -n 3p | awk '{print $1}')" != "0" ]; do sleep 3; done
P=$(cast call $C 'proposals(uint256,uint256)(uint256,bytes32,uint64)' 0 $R --rpc-url $FORK | tr '\n' ' '); say "keeper proposed market0: $P"
say "DISPUTE: guardian rejects market0 proposal inside the window"
cast send $C "rejectResult(uint256,uint256)" 0 $R --private-key $OWNER_PK --rpc-url $FORK >/dev/null && say "  rejected"
say "RESTART: killing keeper mid-dispute and restarting it"
pkill -f "node.*tsx.*src/server.ts" || true; pkill -f "tsx src/server.ts" || true
until ! pgrep -f "src/server.ts" >/dev/null; do sleep 1; done; say "  keeper process gone"; start_keeper
until [ "$(cast call $C 'proposals(uint256,uint256)(uint256,bytes32,uint64)' 0 $R --rpc-url $FORK | sed -n 3p | awk '{print $1}')" != "0" ]; do sleep 3; done
say "keeper re-proposed after restart: $(cast call $C 'proposals(uint256,uint256)(uint256,bytes32,uint64)' 0 $R --rpc-url $FORK | tr '\n' ' ')"
st() { cast call $C 'rounds(uint256,uint256)(uint128,uint128,uint128,uint128,uint8,bool,(uint16,uint16,uint16,uint16,uint16,uint16))' $1 $R --rpc-url $FORK | sed -n 5p | awk '{print $1}'; }
until [ "$(st 0)" != "0" ] && [ "$(st 1)" != "0" ]; do sleep 5; done
say "settled: market0 status $(st 0), market1 status $(st 1) (1=settled, 2=refunded)"
for m in 0 1; do
  say "  market$m published result: $(curl -s localhost:3000/api/result/$m/$R | python3 -c 'import json,sys;d=json.load(sys.stdin);c=d["computation"];print(c["resultE18"], [(l["name"], l["count"]) for l in c["legs"]], c.get("note"), d["dataHash"])')"
  say "  market$m onchain (L S Lpay Spay): $(cast call $C 'rounds(uint256,uint256)(uint128,uint128,uint128,uint128,uint8,bool,(uint16,uint16,uint16,uint16,uint16,uint16))' $m $R --rpc-url $FORK | head -4 | awk '{print $1}' | tr '\n' ' ')"
done

say "claims"
for i in 0 1 2 3 4 5; do for m in 0 1; do
  a=$(cast call $C 'claimable(uint256,uint256,address)(uint256)' $m $R $(addr ${U_PK[$i]}) --rpc-url $FORK | awk '{print $1}')
  if [ "$a" != "0" ]; then cast send $C "claim(uint256,uint256)" $m $R --private-key ${U_PK[$i]} --rpc-url $FORK >/dev/null; say "  wallet$i claimed $a wei from market$m"; fi
done; done
FEES=$(cast call $C 'feesAccrued()(uint256)' --rpc-url $FORK | awk '{print $1}'); TB=$(cast balance $TREASURY --rpc-url $FORK)
cast send $C "withdrawFees()" --private-key $OWNER_PK --rpc-url $FORK >/dev/null
say "fees accrued $FEES wei; treasury delta $(( $(cast balance $TREASURY --rpc-url $FORK) - TB ))"

say "MISSING PRICE: ORPHAN market has no keeper feed; waiting until end + maxPriceDelay (660s)"
waitts $((E1 + 661))
cast send $C "settle(uint256,uint256)" 2 $R --private-key ${U_PK[5]} --rpc-url $FORK >/dev/null
say "  ORPHAN status $(st 2) (2 = refunded)"
for i in 3 4; do a=$(cast call $C 'claimable(uint256,uint256,address)(uint256)' 2 $R $(addr ${U_PK[$i]}) --rpc-url $FORK | awk '{print $1}'); cast send $C "claim(uint256,uint256)" 2 $R --private-key ${U_PK[$i]} --rpc-url $FORK >/dev/null; say "  wallet$i refunded $a wei"; done

say "double-settlement check: one resolution event per (market, round)"
NS=$(cast logs --from-block 1 --address $C "RoundSettled(uint256 indexed,uint256 indexed,uint256,bytes32,uint256,uint256,uint256)" --rpc-url $FORK | grep -c "transactionHash" || true)
NV=$(cast logs --from-block 1 --address $C "RoundVoided(uint256 indexed,uint256 indexed,string)" --rpc-url $FORK | grep -c "transactionHash" || true)
say "  RoundSettled=$NS RoundVoided=$NV (3 market-rounds resolved; expect total 3)"
[ $((NS + NV)) -eq 3 ] || { say "FAIL: resolution events != 3"; exit 1; }
for m in 0 1 2; do
  if cast send $C "settle(uint256,uint256)" $m $R --private-key ${U_PK[5]} --rpc-url $FORK >/dev/null 2>&1; then say "FAIL: second settle accepted (market $m)"; exit 1; fi
done
say "  ok: a second settle reverts on every market"
say "contract balance after all claims: $(cast balance $C --rpc-url $FORK) wei (dust only)"
say "DONE"
