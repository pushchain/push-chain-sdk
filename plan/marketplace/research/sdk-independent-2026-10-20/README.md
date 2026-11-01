# Independent SDK completion — October 20

Follow-up to `fdfcd460`, on `feat/agw-sdk-v4`. Source/deployment targets remain UniversalMarketplace v2 `443b4e2` and AGW v6 `ffd567d`. [Completed checklist and external boundaries](../../sdk-readiness.md), [consumer guide](../../../../packages/core/MARKETPLACE.md).

## Final acceptance

| Check | Result / evidence |
| --- | --- |
| Full units | 2,246 passed, 12 existing skips, zero failures; [compressed raw Jest output](unit-results.json.gz) |
| Real-contract fork | 11 passed, zero failures; [Jest output](fork-results.json) |
| Basic live run | 3 passed, zero failures/skips, process exit 0; [report](live-results.json), [transactions/read requests](live-evidence.json) |
| Owned-token live funding run | 3 passed, zero failures/skips, process exit 0; [report](funding-results.json), [transactions](funding-evidence.json) |
| Cleanup | Cards 4/5 inactive; market jobs 4/7/8/9 Rejected with grants disabled; plain jobs 5/6 Completed; all six clients have zero principal/payment token balances; [read-only post-state](post-live-state.json) |
| Build/types/docs/package | Build, library/spec/fork types, eight guide TS blocks, compiled CJS/ESM imports, declarations and npm dry-run contents pass |
| API | Source/compiled surfaces match; [compressed report](api-comparison.json.gz). Its baseline includes earlier SDK changes. |
| Lint | New marketplace/job modules pass with zero warnings; native transport retains its 13 baseline warnings, with no new diagnostic. [Summary](validation-summary.json) |

The 18 added unit cases cover history authentication, watcher delivery/recovery, descriptions, prepared-read sending, paid-preview recovery/mismatch rejection, CI completion reporting, opening receipt errors and native broadcast-hash preservation. Native atomic confirmation failures cannot fall back to sequential execution after broadcast.

The real-contract fork adds a valid ERC-1271 owner through a public UniversalSigner adapter, invalid magic/trailing-data/short returns, compatible and echo-only 7702 delegates, and same-block opening/card-update history. The self-contained fixture builds from repository source using cached solc 0.8.26; it needs no sibling contract checkout or live deployment. The existing fork lifecycle still covers escrow/payout, price/version drift, binary descriptions, paused refunds, permissions and cancellation. Its external UEA signature uses a native submitting transport because Anvil has no Cosmos transport; actual external-owner transport is tested live.

The basic live run covers native and external UEA opening/cancellation, receipt recovery, paid validator-consensus preview, sending a pure prepared read and authenticated request-ID recovery with zero new payment. The CI reporter now derives success from final counts and preserves Jest's pre-final `success` flag separately.

The funding run uses assets owned by the configured master, without public impersonation: actual principal/fee/PC deposits; 0.01 pUSDC escrow/payout per native/AGW plain job; 0.01 USDT bridged from a fresh BSC origin; and up to 0.01 pBNB for BSC source-gas setup. A fresh controlled evaluator completes the plain jobs. The marketplace evaluator is unchanged. Principal, reserve and payout tokens are returned; bounded PC/BNB funds test gas. Cleanup is independently checked on-chain.

## Earlier failure and correction

An earlier local acceptance run passed ten cases but timed out reading the ERC-1271 adapter's submitted transaction receipt. [Raw earlier report](fork-before-confirmation-fix.json.gz). The local adapter now waits for explicit Anvil confirmation mining before returning its hash. The audit also exposed missing recovery metadata in shared native single/atomic transport: those errors now retain broadcast hashes, and a typed unsupported-signing error after broadcast cannot cause sequential fallback. Regression cases and the final full unit/fork runs pass. This is not a claim that every intermediate attempt passed.

The live runs precede the final native error-only recovery guard; that guard is covered by the final unit and fork runs. Its successful transaction path is unchanged.

The funding run completed before the reporter correction and retains its original `success: false` sampling discrepancy despite three passed tests and process exit 0. The later basic live report has `success: true` and `jestReportedSuccess: false`, exercising the corrected counter-based reporting. Raw reports are unchanged.

## Remaining boundary

There is no SDK-only implementation or acceptance item left in the current EVM v2 checklist. The contract/deployment dependencies are (1) aligned CEA manifests on three destinations and (2) a compatible automatic evaluator/hook/shared schema with a public verify/retry ABI. No automatic verdict, marketplace-evaluator impersonation, mainnet rollout, new marketplace/kernel/hook/evaluator deployment or npm publication is claimed. Deferred product features remain outside this boundary.

## Reproduction

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --silent
node node_modules/jest/bin/jest.js --config packages/core/jest.marketplace-local.config.ts --runInBand
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-funding --verify
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-funding
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.spec.json --noEmit
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.marketplace-local.json --noEmit
node packages/core/scripts/check-agw-docs.js packages/core/MARKETPLACE.md
node packages/core/scripts/check-agw-package.js
node packages/core/scripts/check-agw-api.js --output /tmp/marketplace-api.json
```

Run funded groups serially: they share the configured master for setup and gas. All marketplace groups remain excluded from default `all`; funding acceptance is explicit. [Checked source hashes](checked-files.json) and retained-result checksums are recorded with the validation summary.
