# SDK-owned follow-up — October 6, 2026

This follow-up completes work that does not require new product or contract decisions. It changes tests, developer documentation and package metadata, not public SDK method signatures, exported types or transaction behavior.

## Completed

1. **Delayed-index replay/wait acceptance.** Six cases run real AGW/factory/engine/validator/URP transactions and obtain actual Anvil EVM receipts. Public `trackTransaction` first sees a root-only universal record that core identifies as Push-only. The AGW adapter restores the outbound route from verified wallet calldata. Public `wait()` then runs the actual indexer poller across missing/root-only records into destination success, destination failure or timeout, on both owner and agent doors. Wallet/signer identity stays correct, terminal hooks fire once to each callback, both actors' pending nonces stay unchanged, and Cosmos sub-ID extraction is cached. This closes the prior mock-poller-only coverage limit.
2. **Consumer guide with checked examples.** [packages/core/AGW.md](../../../../packages/core/AGW.md) covers owner/agent identity, native rules, independent funding, lifecycle, EVM token caps, explicit bounded gateway allowance, receipts/replay/partial-create recovery and current scope. Seven TypeScript blocks are checked together against public exports without evaluation. The examples use explicit native limits and one matching rule. They do not choose H3/H4.5/H6 behavior. Existing transaction return types are inferred; no new root type export was added for the documentation.
3. **Documentation packaging and status cleanup.** The guide is linked from the package README and included in the npm files list. `docs:check:agw` invokes its checker from the SDK checkout. The checker uses the root workspace's TypeScript compiler as developer tooling; only this unshipped script is excluded from Nx's runtime-dependency check, keeping compiler dependencies out of the published SDK. Stale network-blocked, unfinished-native-batch and unrun-funded statements were removed from active blocker/question/design documents. Web2 alias/literal migration notes are supplied.

## Validation

| Check | Result |
| --- | --- |
| Full actual-contract local suite | 59 passed in 8 suites (previous 53 plus 6 delayed-index cases) |
| Focused suite after strengthening the no-resubmission nonce check | 6 passed |
| Guide examples | 7 TypeScript blocks typecheck using public exports; not executed |
| Local harness typecheck | Pass |
| Changed-file lint | 0 errors; 6 conventional non-null assertion warnings in tests |
| Core build | Pass |
| npm dry-run | [Guide included in proposed package contents](package-inspection.json); no publication |
| Prior production unit evidence | 1,947 passed, 12 existing skips; production source unchanged by this follow-up |
| Prior live acceptance | All 25 registered AGW scenarios have passing coverage; no new live scenario/funding is needed for this follow-up |

Logs are in [logs/](logs/). Log trailing whitespace and EOF blank lines are normalized. The six new cases control origin lookup and indexer responses; gateway/core/token/destination lookup remain local fixtures. The destination hashes/outcomes are fixture observations, not live TSS or destination receipts. Existing [live acceptance](../live-acceptance-2026-10-06/README.md) remains the production gateway/UEA/Sepolia evidence. No `.env` keys were loaded, no funded transactions were submitted and no contract checkout was changed by this follow-up.

## API impact

**This follow-up:** no public SDK API or default/authorization behavior changes. The package gains a guide and a developer command; tests gain deterministic delayed-index coverage.

**Earlier AGW work:** the target agentic namespace and agenticWallet initialization remain; v4 enables the specified EVM assets[] model and native arrays. AGW responses add wallet/signature-origin metadata. Raw native offsets and EVM beneficiaryOffset remain the previously introduced public type extensions awaiting H4.5. Multiple matches return AMBIGUOUS_RULE; no caller selection parameter was added. Web2 public constants use web2 while the old web2:https literal remains accepted. Spend/history/generation helpers and compileCard follow Harsh's accepted removals/deferrals. These are not new decisions in this follow-up.

## Remaining work

- H3 native defaults/public maxValueTotal and token wording.
- H4.5 public raw-offset authoring/read shape.
- H6 selecting among multiple matching rules, including arrays.
- Ref/editable-label v1 delivery or deferral.
- Public Solana destination mapping, registry/IDL integration, dispatch/tracking and live acceptance.
- Platform executor support for creditRevert; refunds currently do not restore policy spend.

None of these choices is silently settled by the new guide or tests. Standalone history/compiler scope stays deferred.

## Reproduce

```sh
node packages/core/scripts/check-agw-docs.js
AGW_LOCAL_DIR="${TMPDIR:-/tmp}/push-agw-local-v4" node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.agw-local.json --noEmit
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
```

The package inspection uses npm pack --dry-run --json --ignore-scripts from dist/packages/core after the build. It is a local content inspection, not an npm publish.
