#!/usr/bin/env bash
# live-read-donut.sh — fire ONE real cross-chain read on Push Donut and watch it through
# the validator ballot to settlement. Read-only except: deploys a tiny client contract and
# sends one request tx carrying a small callback budget.
#
#   export DONUT_PK=0x...                       # funded Push Donut key (~0.2 PC is plenty)
#   export CONTRACTS_REPO=/path/to/push-chain-core-contracts   # optional; feat-read-state checkout
#   ./live-read-donut.sh
#
# First real reads on Donut were made with this on 2026-09-09 (see ../read-state-sdk-spec.md).
set -euo pipefail
R=https://evm.donut.rpc.push.org/
UC=0x00000000000000000000000000000000000000c2
CORE=0x00000000000000000000000000000000000000C0
# Local checkout of push-chain-core-contracts on feat-read-state (read-only; we don't own it).
REPO="${CONTRACTS_REPO:-$HOME/Desktop/work/PUSH/push-chain-core-contracts}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DONUT_PK:?export DONUT_PK first (e.g. from packages/core/.env PUSH_PRIVATE_KEY)}"
[ -d "$REPO/src" ] || { echo "contracts checkout not found at $REPO — set CONTRACTS_REPO"; exit 2; }
# The client contract lives in our Foundry suite; drop it into the checkout so forge can compile it.
cp "$HERE/ForkReadStateFixVerification.t.sol" "$REPO/test/fork/"
ME=$(cast wallet address --private-key "$DONUT_PK")
echo "sender   $ME"
echo "balance  $(cast balance "$ME" --rpc-url $R --ether) PC"
echo "nonce-before (reads ever on Donut): $(( $(cast storage $UC 4 --rpc-url $R) ))"

# 1. Deploy a minimal UniversalReadClient-style app (from the verification suite). writes=1.
cd "$REPO"
# NOTE: --constructor-args is variadic and must be LAST or it swallows every later flag.
CLIENT=$(forge create test/fork/ForkReadStateFixVerification.t.sol:FullBudgetReadClient \
  --private-key "$DONUT_PK" --rpc-url $R --broadcast --json --constructor-args $UC 1 | jq -r .deployedTo)
echo "client   $CLIENT"

# 2. Spec: EVM AccountBalance of 0xdead on Sepolia, pinned at the oracle height − 1.
H=$(cast call $CORE 'chainHeightByChainNamespace(string)(uint256)' 'eip155:11155111' --rpc-url $R | awk '{print $1}')
PIN=$((H-1))
EXP=$(( $(cast block-number --rpc-url $R) + 1000 ))
# Envelope MUST be abi.encode of ONE tuple (validator unpacks abi.Arguments{tuple}); payload MUST be abi.encode(address).
PAYLOAD=$(cast abi-encode 'f(address)' 0x000000000000000000000000000000000000dEaD)
Q=$(cast abi-encode 'f((uint8,(uint8,uint64),bytes))' "(0,(0,$PIN),$PAYLOAD)")
SPEC="((eip155,11155111,0x000000000000000000000000000000000000dead),$Q,1,$PIN,$EXP,100000000000000000000,$ME)"
FEE=$(cast call $UC 'estimateFee(string,string)(uint256)' eip155 11155111 --rpc-url $R | awk '{print $1}')
BUDGET=50000000000000000                       # 0.05 PC callback budget — node refuses to fulfil at 0
echo "pin      $PIN (oracle $H)  expiry $EXP  protocolFee $FEE  budget $BUDGET  refundTo $ME"

# 3. Send the request.
TX=$(cast send "$CLIENT" 'request(((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address),uint64)' \
  "$SPEC" 200000 --value $((FEE+BUDGET)) --private-key "$DONUT_PK" --rpc-url $R --json | jq -r .transactionHash)
echo "tx       $TX"
RID=$(cast receipt "$TX" --rpc-url $R --json | jq -r --arg uc "$UC" '.logs[] | select((.address|ascii_downcase)==$uc) | .topics[1]' | head -1)
echo "requestId $RID"
echo "nonce-after: $(( $(cast storage $UC 4 --rpc-url $R) ))   escrowed: $(cast call $UC 'totalEscrowed()(uint256)' --rpc-url $R)"

# 4. Watch: contract status (1 PENDING · 2 EXECUTED · 3 SETTLED · 4 EXPIRED) + did the callback run.
echo; echo "watching (validators must observe Sepolia, reach 2/3 quorum, fulfil, settle)…"
for i in $(seq 1 90); do
  ST=$(cast call $UC 'statusOf(uint256)(uint8)' "$RID" --rpc-url $R)
  DONE=$(cast call "$CLIENT" 'completed()(bool)' --rpc-url $R)
  printf "%s  statusOf=%s  callbackCompleted=%s\n" "$(date +%T)" "$ST" "$DONE"
  if [ "$ST" = "3" ] || [ "$ST" = "4" ]; then break; fi
  sleep 10
done
echo; echo "final: statusOf=$ST callbackCompleted=$DONE  escrowed=$(cast call $UC 'totalEscrowed()(uint256)' --rpc-url $R)  refundTo balance $(cast balance "$ME" --rpc-url $R --ether) PC"
[ "$ST" = "3" ] && [ "$DONE" = "true" ] && echo "=> END-TO-END READ SUCCEEDED THROUGH THE VALIDATOR SET" || echo "=> did not complete cleanly — inspect requestId $RID"
