# Preset validation commands

No app addresses were added to the production catalog. No new funded app-preset E2E was run.

- Unit: `node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --runTestsByPath packages/core/src/lib/agentic/__tests__/presets.spec.ts packages/core/src/lib/agentic/__tests__/response-surface.spec.ts`
- Local contracts: `AGW_LOCAL_DIR=/tmp/agw-oct12-v5 node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand --runTestsByPath packages/core/__agw-local__/v5-multiasset.spec.ts`
- Library, spec and local typechecks use their existing packages/core tsconfig files with `--noEmit`.
- Build: `NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache`
- Consumer checks: `node packages/core/scripts/check-agw-docs.js`, `check-agw-package.js`, `check-agw-api.js --output /tmp/agw-presets-api.json`.
- Full unit regression uses the normal core Jest config. An initial run had 2,074 passes and one existing 100ms outbound-SVM timeout test failure while other checks ran. The unchanged test passed on retry. A subsequent isolated full run is recorded separately.

The prior section-6 funded acceptance covered 68 scenarios across a 65/3 full run and a 3/3 targeted rerun. That evidence is distinct from this pure preset framework and fixture-only contract integration.
