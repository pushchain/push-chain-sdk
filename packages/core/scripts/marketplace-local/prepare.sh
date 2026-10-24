#!/usr/bin/env bash
# Compile repo-owned signature acceptance fixtures. Never broadcasts or clones another repository.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKET_FIXTURE_DIR="${MARKETPLACE_LOCAL_DIR:-${TMPDIR:-/tmp}/push-marketplace-local}"
mkdir -p "$MARKET_FIXTURE_DIR/src"
cp "$SCRIPT_DIR/../agw-local/contracts/MarketplaceOwnerFixtures.sol" "$MARKET_FIXTURE_DIR/src/"
cat > "$MARKET_FIXTURE_DIR/foundry.toml" <<'EOF'
[profile.default]
src = "src"
out = "out"
solc_version = "0.8.26"
optimizer = true
optimizer_runs = 200
EOF
forge build --root "$MARKET_FIXTURE_DIR" --offline >/dev/null
echo "$MARKET_FIXTURE_DIR"
