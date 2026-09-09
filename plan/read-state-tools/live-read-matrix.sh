#!/usr/bin/env bash
# live-read-matrix.sh [revert|expiry|svm|web2|all] — the remaining live checks on Donut.
#   revert : app callback reverts → node FULFILLED but CallbackFailed (callbackDelivered=false)
#   expiry : minConfirmations=500 holds validators; expiry=head+30 wins → EXPIRED, full budget refund
#   svm    : Solana devnet lamport balance of the .env solana key (owner = raw 32-byte pubkey)
#   web2   : GET jsonplaceholder /todos/1, extract $.id uint256 + $.completed bool
# Needs DONUT_PK (funded Push Donut EOA). Optional CONTRACTS_REPO (feat-read-state checkout) for `revert`.
set -uo pipefail
R=https://evm.donut.rpc.push.org/
UC=0x00000000000000000000000000000000000000c2; CORE=0x00000000000000000000000000000000000000C0
CLIENT=0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7           # FullBudgetReadClient (writes=1), reusable
REPO="${CONTRACTS_REPO:-$HOME/Desktop/work/PUSH/push-chain-core-contracts}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${DONUT_PK:?export DONUT_PK}"
ME=$(cast wallet address --private-key "$DONUT_PK")
SOL_OWNER_HEX=0x2953026d328218b107268efe60f7d98635af1ff535a91731f75ca7cf8a859044   # 3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb
SOL_CHAIN=EtWTRABZaYq6iMfeYKouRu166VU2xqa1
SPECSIG='request(((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address),uint64)'
BUDGET=50000000000000000
DEAD=0x000000000000000000000000000000000000dEaD

evm_query() { cast abi-encode 'f((uint8,(uint8,uint64),bytes))' "(0,(0,$1),$(cast abi-encode 'f(address)' $DEAD))"; }

send_and_watch() { # $1 client  $2 spec  $3 ns  $4 chainId  $5 expect(3|4)  $6 maxIter
  local client=$1 spec=$2 ns=$3 cid=$4 expect=$5 iters=$6
  local fee; fee=$(cast call $UC 'estimateFee(string,string)(uint256)' "$ns" "$cid" --rpc-url $R | awk '{print $1}')
  local tx; tx=$(cast send "$client" "$SPECSIG" "$spec" 200000 --value $((fee+BUDGET)) --private-key "$DONUT_PK" --rpc-url $R --json 2>&1 | jq -r '.transactionHash // empty')
  [ -n "$tx" ] || { echo "  !! send failed"; return 1; }
  local rid; rid=$(cast receipt "$tx" --rpc-url $R --json | jq -r --arg uc "$UC" '.logs[] | select((.address|ascii_downcase)==$uc) | .topics[1]' | head -1)
  echo "  tx        $tx"; echo "  requestId $rid"
  local st done
  for i in $(seq 1 "$iters"); do
    st=$(cast call $UC 'statusOf(uint256)(uint8)' "$rid" --rpc-url $R)
    printf "  %s statusOf=%s (1 PENDING 2 EXECUTED 3 SETTLED 4 EXPIRED)\n" "$(date +%T)" "$st"
    if [ "$st" = "3" ] || [ "$st" = "4" ]; then break; fi
    sleep 10
  done
  echo "  --- node record ---"; "$HERE/node-read.sh" id "$rid" | tee "/tmp/rec_$rid.txt" | sed 's/^/  /'
  RID=$rid; TX=$tx; ST=$st
}

mode_revert() {
  echo "################ REVERT — callback reverts on purpose ################"
  cp "$HERE/ForkReadStateFixVerification.t.sol" "$REPO/test/fork/"
  local rc; rc=$(cd "$REPO" && forge create test/fork/ForkReadStateFixVerification.t.sol:RevertingReadClient --private-key "$DONUT_PK" --rpc-url $R --broadcast --json --constructor-args $UC 2>/dev/null | jq -r .deployedTo)
  [ -n "$rc" ] && [ "$rc" != "null" ] || { echo "  !! deploy failed"; return 1; }
  echo "  reverting client $rc"
  local h; h=$(cast call $CORE 'chainHeightByChainNamespace(string)(uint256)' 'eip155:11155111' --rpc-url $R | awk '{print $1}'); local pin=$((h-1))
  local exp=$(( $(cast block-number --rpc-url $R) + 1000 ))
  send_and_watch "$rc" "((eip155,11155111,$DEAD),$(evm_query $pin),1,$pin,$exp,100000000000000000000,$ME)" eip155 11155111 3 24
  local ful; ful=$(/usr/bin/grep -oE 'pc_tx +hash 0x[0-9a-f]{64}' "/tmp/rec_$RID.txt" | head -1 | awk '{print $3}')
  local cbf; cbf=$(cast sig-event 'CallbackFailed(uint256,bytes)'); local rf; rf=$(cast sig-event 'ReadFulfilled(uint256,bytes)')
  local topics; topics=$(cast receipt "$ful" --rpc-url $R --json | jq -r '.logs[].topics[0]')
  echo "  fulfil tx $ful"
  echo "$topics" | /usr/bin/grep -qi "$cbf" && echo "  ✔ CallbackFailed emitted  → callbackDelivered = false" || echo "  ✘ no CallbackFailed"
  echo "$topics" | /usr/bin/grep -qi "$rf"  && echo "  ✘ ReadFulfilled emitted (unexpected)" || echo "  ✔ no ReadFulfilled"
  echo "  attempts() on client = $(cast call $rc 'attempts()(uint256)' --rpc-url $R)   (0 = revert rolled it back)"
  echo "  node STATUS: $(/usr/bin/grep -oE 'STATUS +[A-Z]+' "/tmp/rec_$RID.txt")   <- FULFILLED despite the revert (documented semantics)"
}

mode_expiry() {
  echo "################ EXPIRY — minConfirmations=500, expiry=head+30 ################"
  local h; h=$(cast call $CORE 'chainHeightByChainNamespace(string)(uint256)' 'eip155:11155111' --rpc-url $R | awk '{print $1}'); local pin=$((h-1))
  local head; head=$(cast block-number --rpc-url $R); local exp=$((head+30))
  local bal0; bal0=$(cast balance $ME --rpc-url $R)
  echo "  head $head → expiry $exp (~40 s); validators hold until Sepolia +500 blocks"
  send_and_watch "$CLIENT" "((eip155,11155111,$DEAD),$(evm_query $pin),500,$pin,$exp,100000000000000000000,$ME)" eip155 11155111 4 30
  local last; last=$(/usr/bin/grep -oE 'pc_tx +hash 0x[0-9a-f]{64}' "/tmp/rec_$RID.txt" | tail -1 | awk '{print $3}')
  local rex; rex=$(cast sig-event 'RequestExpired(uint256,address,uint256)')
  if [ -n "$last" ]; then
    local d; d=$(cast receipt "$last" --rpc-url $R --json | jq -r --arg t "$rex" '.logs[] | select(.topics[0]==$t) | .data' | head -1)
    [ -n "$d" ] && echo "  ✔ RequestExpired refunded = $(cast abi-decode 'f()(uint256)' "$d") wei (budget was $BUDGET)" || echo "  ✘ no RequestExpired in $last"
  fi
  echo "  contract statusOf = $ST (4 = EXPIRED)   node: $(/usr/bin/grep -oE 'STATUS +[A-Z]+' "/tmp/rec_$RID.txt")"
  echo "  escrowed now = $(cast call $UC 'totalEscrowed()(uint256)' --rpc-url $R)"
}

mode_svm() {
  echo "################ SVM — Solana devnet lamport balance ################"
  local slot; slot=$(cast call $CORE 'chainHeightByChainNamespace(string)(uint256)' "solana:$SOL_CHAIN" --rpc-url $R | awk '{print $1}'); local floor=$((slot-200))
  local exp=$(( $(cast block-number --rpc-url $R) + 1000 ))
  local q; q=$(cast abi-encode 'f((uint8,(uint64),bytes))' "(0,($floor),0x)")
  local truth; truth=$(curl -s -m 15 https://api.devnet.solana.com -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb\",{\"commitment\":\"finalized\"}]}" | jq -r .result.value)
  echo "  oracle slot $slot  floor $floor  ground-truth lamports $truth"
  send_and_watch "$CLIENT" "((solana,$SOL_CHAIN,$SOL_OWNER_HEX),$q,1,$floor,$exp,100000000000000000000,$ME)" solana "$SOL_CHAIN" 3 24
  local got; got=$(/usr/bin/grep -oE 'result_data +0x[0-9a-f]+' "/tmp/rec_$RID.txt" | awk '{print $2}')
  local want; want=$(cast abi-encode 'f(uint256)' "$truth")
  [ "$got" = "$want" ] && echo "  ✔ result_data == abi.encode($truth lamports)" || echo "  ✘ MISMATCH got=$got want=$want"
}

mode_web2() {
  echo "################ WEB2 — GET jsonplaceholder /todos/1 ################"
  local exp=$(( $(cast block-number --rpc-url $R) + 1000 ))
  local q; q=$(cast abi-encode 'f((uint8,string,bytes,bytes,uint64,(string,uint8,uint8,uint8)[]))' '(0,"https://jsonplaceholder.typicode.com/todos/1",0x7b7d,0x,5000,[("$.id",0,0,0),("$.completed",2,0,0)])')
  send_and_watch "$CLIENT" "((web2,https,$ME),$q,1,0,$exp,100000000000000000000,$ME)" web2 https 3 24
  local got; got=$(/usr/bin/grep -oE 'result_data +0x[0-9a-f]+' "/tmp/rec_$RID.txt" | awk '{print $2}')
  local want; want=$(cast abi-encode 'f(uint256,bool)' 1 false)
  [ "$got" = "$want" ] && echo "  ✔ result_data == abi.encode(uint256 1, bool false)" || echo "  ✘ MISMATCH got=$got want=$want"
  /usr/bin/grep -E 'result.status|error_code' "/tmp/rec_$RID.txt" | sed 's/^/  /'
}

echo "sender $ME  balance $(cast balance $ME --rpc-url $R --ether) PC  nonce-before $(( $(cast storage $UC 4 --rpc-url $R) ))"
for m in ${1:-all}; do case $m in all) mode_revert; mode_expiry; mode_svm; mode_web2;; *) "mode_$m";; esac; done
echo; echo "nonce-after $(( $(cast storage $UC 4 --rpc-url $R) ))  escrowed $(cast call $UC 'totalEscrowed()(uint256)' --rpc-url $R)"
echo "=> MATRIX DONE"
