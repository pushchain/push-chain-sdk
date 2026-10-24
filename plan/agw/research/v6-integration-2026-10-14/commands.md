# V6 validation commands and limits

- Isolated preparation: `OUT=/tmp/agw-oct14-v6 AGW_PIN=ffd567d3e49b2d27c6f50ad36093274dbac3090f bash packages/core/scripts/agw-local/prepare.sh`. Original contract checkout was fetched/read, never checked out or modified.
- ABI snapshots: isolated Forge output; policy errors include the linked SvmRulebook ABI errors. JSON hashes are in packages/core/scripts/agw-local/abis/manifest.json; gen-abi.mjs reproduces the TS files.
- Full unit suite: `node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand`.
- Local suite: `AGW_LOCAL_DIR=/tmp/agw-oct14-v6 node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand`.
- Build: `NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache`.
- Typechecks: existing lib/spec/agw-local tsconfigs with --noEmit. Consumer checks: check-agw-docs.js, check-agw-package.js and check-agw-api.js.
- Live preflight: ci/preflight.ts --group agw --dry-run, using the existing testnet keys without printing them.
- Full live run: ci/run.ts --group agw, serial. Started with 68 selected scenarios; the later-added v6 destination-pin case was filtered out (69 loaded). Result: 67 passed, one stale allowance assertion failed, one filtered out. V6 correctly cleared a pre-existing allowance to zero; assertion fixed.
- Focused run: Jest E2E config, runInBand, v5-multiasset.spec.ts and universal-evm.spec.ts, testNamePattern `agw v5 multi-asset 3\.|agw universal evm 3\.`. Covers the corrected case and the newly added EVM EQ/MAX alternative case.

Local gateway/token fixtures prove Push contract execution, not destination delivery. Live evidence covers actual Donut→Sepolia/Solana devnet transactions. No real contracts were deployed by the SDK work. Do not describe combined full/focused coverage as one clean full run.
