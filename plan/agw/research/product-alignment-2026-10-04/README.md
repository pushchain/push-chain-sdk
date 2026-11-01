# Product scope alignment validation October 4

Implements the clear [Harsh decisions](../../product-decisions-2026-10-04.md) on the worktree based at a852777. H3 defaults are byte-for-byte unchanged. No live-network transactions or deployments were performed.

## Changes

- Removed SDK approval-selector deny-lists and mandatory spender-pin policy. Explicit pins still use ABI/type validation.
- Kept generation-dependent rulesId/deriveWallet/encodeRules and RulesEncodeContext internal. Public utils contain actionId/configId/decodeRules; client.agentic.derive is unchanged.
- Removed public Spent/RulesRecord.spent. Internal readNativeSpend and expected-spend assertions remain. Tests query real policy counters directly for independent verification.
- Active-only rules.list/get; unknown/revoked IDs return RULE_NOT_FOUND. Historical log reconstruction and its capability are removed.
- Removed compileCard and its capability from AGW.
- Native agent arrays encode one executeAsAgent per action under the selected rule. UEA uses its existing multicall; native EOA uses an atomic-only 7702 path. Missing signer/executor or failed authorization cannot trigger sequential fallback. Ordinary core batching retains its previous fallback behavior.
- Native batch replay recognizes verified UEA or delegated-EOA wrappers, preserves signer origin, and reports the ordered actions in agentic.nativeCalls. An arbitrary forwarding contract is not recognized as a trusted batch sender.

## Results

| Check | Result |
| --- | --- |
| Full unit config | 1,917 passed; 12 skipped; 112 suites passed and 1 skipped |
| Local AGW config | 36 passed in 5 suites |
| Library, spec/E2E and local test typechecks | Passed |
| Core build | Passed |
| Core lint | Seven pre-existing errors in unchanged read-example/PC20 files; no new errors |
| AGW manifest | 23 scenarios / 8 files / 23 selected tests |
| Default all manifest | 76 scenarios / 40 files / 81 selected tests, unchanged |

Logs are retained in this directory. [Evidence metadata](evidence.json) records commands and checksums. Lint's seven-error baseline is recorded as such, not reported as a clean run.

## Real-contract batch test scope

The new local suite uses actual e704d5b wallet/factory/engine/policy contracts and real Anvil type-4 transactions signed by public development keys. It verifies the outer sender is the agent account, two calls consume two call counts, and a mined later-call failure rolls back both target state and counters.

The ERC-7821-shaped executor is a small test-only self-call/CALL dispatcher, not a bytecode verification of the deployed OpenZeppelin executor. Existing gateway/fee fixtures remain stubbed. There is no Cosmos, UEA relay, TSS or destination chain in this harness. UEA shaping/replay is unit-tested and reuses the existing transport; live UEA acceptance is still required.

Two opt-in live cases were added for atomic native success and rollback. They use the existing verified deployment gate and have not been executed. SVM destinations, final multi-asset artifacts, deployment, H3 defaults and public raw-offset type approval remain outstanding.

## Reproduction

From the SDK root, run the core Jest config with --runInBand, both standard tsc --noEmit configs and tsconfig.agw-local.json, then core:build/core:lint through Nx. For local contracts, run scripts/agw-local/prepare.sh and set AGW_LOCAL_DIR to its output before running jest.agw-local.config.ts. From packages/core, use e2e:verify --group agw and --group all; these inspect scenario selection without broadcasting.
