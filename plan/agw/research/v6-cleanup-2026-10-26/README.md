# V6-only AGW cleanup — October 26, 2026

The user confirmed that no AGW backward compatibility is required. The runtime already registered only the pinned v6 ABI/source; this cleanup removes dormant compatibility scaffolding and stale naming. It builds on the uncommitted PRE/POST evaluator work and leaves the combined workspace local, without committing, pushing, deploying or publishing.

Removed the capability enum, all-enabled set, checks and context/manifest fields. Every supported v6 deployment implements those features; unsupported networks and unrecognized factories still fail through the deployment registry. Manifest capability overrides are refused. Removed the unused `encodeDeployWallet` wrapper; wallet creation continues using the index-bound deployment path with its race checks.

`PresetOptionsWithAgent` replaces `ReadyPresetOptions`, with no compatibility alias. Preset templates and the typed agent-supplied overload remain supported. Factory/wallet/source pins, policy version checks, owner/agent authorization, address restrictions, exact spend assertions and token-route verification are retained. Solana SPL and Token-2022 support is current functionality, not an old AGW adapter.

Renamed both local/live `v5-multiasset.spec.ts` files to `multiasset.spec.ts`, corrected current-contract v5 labels/comments/evidence names to v6, and updated the three E2E scenario IDs and file/title mappings. No test coverage was deleted. Historical research, ABI provenance and older changelog entries are preserved.

## Acceptance

- Full unit run: **2,302 passed**, 12 existing skips, zero failed.
- Full local AGW suite: **108 passed**, across 14 suites, zero failed/skipped.
- Local evaluator SDK suite: **8 passed**, zero failed/skipped; the earlier PRE/POST implementation still works after the AGW simplification.
- Build, full spec/local types, source/built API equality, CJS/ESM imports, compiled declaration examples and npm-content checks pass. AGW guide has eight checked TypeScript blocks; marketplace guide has nine.
- E2E runner verification passes: 76 scenario mappings, 40 files, 81 distinct tests. This checks selection consistency without broadcasting.
- Changed production lint passes with zero errors/warnings. Three existing test warnings remain (two non-null assertions and an unused `NativeRule` import); those tests received label/import-context updates only.

The local AGW harness uses real pinned v6 contracts on isolated Anvil with fixture gateway/core/destination services; the evaluator suite additionally uses the actual kernel, hook, evaluator and Read State, with manually supplied consensus results. No live delivery/consensus claim is made. The earlier deployed-marketplace fork RPC limitation is unchanged; this cleanup does not convert it into a passing check.

[Validation summary](validation-summary.json), [unit results, gzip](unit-results.json.gz), [local AGW results](agw-local-results.json), [local evaluator results](evaluator-local-results.json), [API comparison, gzip](api-comparison.json.gz), [workspace file hashes](checked-files.json).
