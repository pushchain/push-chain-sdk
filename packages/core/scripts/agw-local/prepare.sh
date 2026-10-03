#!/usr/bin/env bash
# Prepare an ISOLATED build of the pinned AGW contracts for the SDK's local
# contract harness (review-only; never a deployment of record).
#
#   AGW_REPO   path to a push-agentic-wallets clone (default: ../../../../push-agentic-wallets
#              relative to this script). Only `git archive` / `git ls-tree` are run against it,
#              so the clone's working tree, branches and index are never touched.
#   AGW_PIN    commit to extract (default: the reviewed e704d5b).
#   OUT        destination directory (default: $TMPDIR/push-agw-local-<pin>).
#
# The script extracts the pinned tree, fetches each git submodule at the exact
# commit recorded in that tree, copies the harness-only contracts from
# ./contracts into OUT/sdk-harness, and runs `forge build`. It never broadcasts.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGW_REPO="${AGW_REPO:-$HERE/../../../../../push-agentic-wallets}"
AGW_PIN="${AGW_PIN:-e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9}"
OUT="${OUT:-${TMPDIR:-/tmp}/push-agw-local-${AGW_PIN:0:7}}"

command -v forge >/dev/null || { echo "forge not found (install Foundry)" >&2; exit 1; }
git -C "$AGW_REPO" cat-file -e "${AGW_PIN}^{commit}" 2>/dev/null || {
  echo "AGW pin $AGW_PIN is not present in $AGW_REPO; fetch it first" >&2; exit 1; }

mkdir -p "$OUT"
if [ ! -f "$OUT/.agw-pin" ] || [ "$(cat "$OUT/.agw-pin")" != "$AGW_PIN" ]; then
  echo "extracting $AGW_PIN -> $OUT"
  git -C "$AGW_REPO" archive "$AGW_PIN" | tar -x -C "$OUT"
  # Submodules are gitlinks in the archive; fetch each at its recorded commit.
  git -C "$AGW_REPO" ls-tree "$AGW_PIN" lib/ | awk '$2 == "commit" { print $3, $4 }' |
    while read -r commit path; do
      url="$(git -C "$AGW_REPO" show "$AGW_PIN:.gitmodules" |
        git config -f /dev/stdin --get "submodule.$path.url")"
      echo "submodule $path @ $commit ($url)"
      rm -rf "${OUT:?}/$path"
      git init -q "$OUT/$path"
      git -C "$OUT/$path" fetch -q --depth 1 "$url" "$commit"
      git -C "$OUT/$path" checkout -q FETCH_HEAD
      test "$(git -C "$OUT/$path" rev-parse HEAD)" = "$commit"
    done
  echo "$AGW_PIN" > "$OUT/.agw-pin"
fi

mkdir -p "$OUT/sdk-harness"
cp "$HERE"/contracts/*.sol "$OUT/sdk-harness/"

(cd "$OUT" && forge build --offline src sdk-harness lib/smartsessions/contracts/SmartSession.sol lib/openzeppelin-contracts/contracts/proxy >/dev/null)
echo "$OUT"
