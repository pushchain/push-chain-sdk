#!/usr/bin/env bash
# Build the exact reviewed contract revision locally. No broadcast, checkout, fetch or deployment.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_REPO="${CORE_CONTRACTS_DIR:-$SCRIPT_DIR/../../../../../push-chain-core-contracts}"
PIN="8666c2ac2304ffd97a7ada121170c397d0f6125d"
if [[ "$(git -C "$CORE_REPO" rev-parse HEAD)" != "$PIN" ]]; then
  echo "CORE_CONTRACTS_DIR must contain the reviewed pre/post revision $PIN" >&2
  exit 1
fi
git -C "$CORE_REPO" diff --quiet "$PIN" -- src test foundry.toml remappings.txt
git -C "$CORE_REPO" submodule foreach --quiet 'test "$(git rev-parse HEAD)" = "$sha1" && git diff --quiet HEAD'
forge build --root "$CORE_REPO" --offline >/dev/null
printf '%s\n' "$(cd "$CORE_REPO" && pwd)"
