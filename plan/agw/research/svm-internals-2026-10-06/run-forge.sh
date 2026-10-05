#!/usr/bin/env bash
# Offline in-process EVM checks. No network, private keys, signing or broadcast.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK_ROOT="$(cd "$HERE/../../../.." && pwd)"
SDK_SVM_BUILD_DIR="${AGW_LOCAL_DIR:-${TMPDIR:-/tmp}/push-agw-local-v4}"
test "$(cat "$SDK_SVM_BUILD_DIR/.agw-pin")" = "e8db74815cfbbf5389593805e464fe8d85f7f735"
cd "$SDK_ROOT"
TS_NODE_PROJECT=packages/core/tsconfig.lib.json node -r ts-node/register/transpile-only "$HERE/generate-vectors.ts"
cp "$HERE/SdkSvmWire.t.sol" "$SDK_SVM_BUILD_DIR/sdk-harness/SdkSvmWire.t.sol"
cp "$HERE/sdk-vectors.json" "$SDK_SVM_BUILD_DIR/sdk-harness/sdk-vectors.json"
python3 - "$SDK_SVM_BUILD_DIR/foundry.toml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); text = p.read_text()
entry = '{ access = "read", path = "sdk-harness/" }'
if entry not in text:
    p.write_text(text.replace('fs_permissions = [', 'fs_permissions = [\n    ' + entry + ','))
PY
FOUNDRY_TEST=sdk-harness forge test --root "$SDK_SVM_BUILD_DIR" --offline --match-contract SdkSvmWireTest -vv
