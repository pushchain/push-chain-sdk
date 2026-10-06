# Nine SDK-owned items — completion report

October 6, 2026. Branch feat/agw-sdk-v4. This completes the nine approved SDK-owned tasks without selecting H3/H4.5/H6 behavior or enabling public Solana destinations. Contract source remains e8db748; no contract checkout was edited.

| Item | Completion and files |
| --- | --- |
| 1 Internal SVM reads | reads/svm.ts decodes the verified getter, verifies mode/action/config shape, retains expired enabled rules and returns ordered counters and the pinned block. Actual-contract round-trip/read/revoke coverage passes. |
| 2 Context/asset resolution | management/svm-context.ts and svm-metadata.ts validate PRC20 source chains, native gas-token identity, mint ownership/initialization, configured cluster genesis, and registry/mint substitutions. Every listed/output mint contributes its correctly resolved SPL/Token-2022 ATA. Missing cluster/gateway configuration fails explicitly. |
| 3 Instruction integration | execution/svm-instruction.ts connects the existing IDL resolver with the wallet's configured CEA authority. Explicit wire-account input supports non-Anchor/dataless instructions. The existing payload/pin/alias validator is applied to both. No guessed public authoring form. |
| 4 Internal lifecycle | management/svm.ts verifies wallet generation/version and owner, prepares explicit-wire grants, and performs all-asset assert/revoke/grant in one owner execution. Revoke uses the existing owner path. Receipt events provide actual IDs if another owner grant advances the nonce. Atomic update, five checkpoints, second-asset race rollback and initialization failure rollback pass against real contracts. |
| 5 Prepared execution | execution/svm-send.ts connects verified wallet/rule/signer identity, resolved context, payload, current quote, PC/token/allowance/gas checks and executeAsAgent wrapping. It returns raw signer response plus internal wire context; public SVM display/types are not invented. No automatic approval. |
| 6 Confirmation/tracking | Shared outbound-sync now verifies pending Solana observations through the selected cluster's RPC, supporting base58 and raw 64-byte hex signatures. Only confirmed/finalized outcomes settle; processed/missing/wrong-cluster/RPC-error cases keep polling. Confirmed errors preserve failure/hash. Authoritative Cosmos failure still wins. |
| 7 Automated regression | agw-sdk-validation.yml adds an unfunded PR/manual job with a pinned public contract checkout and Foundry version. agw-verify.js runs focused units, types, guide, prepared contracts, actual local tests, build and package/API checks. Logs capture stdout/stderr. Existing funded workflow stays manual. |
| 8 Harness cleanup | Waits for SDK account-status reads and Anvil exit, with bounded SIGKILL fallback. The warning was traced to viem's scheduled 4-second poll sleeps surviving unwatch, not unclosed contract transactions. Local clients use 25ms polling through real RPC/actions; production defaults stay unchanged. All nine suites exit without warning or forceExit. |
| 9 Package/API checks | check-agw-package.js validates CJS/ESM imports, guide examples against built declarations and npm dry-run contents. check-agw-api.js compares source/declarations and reports session-baseline root exports, AGW types, initialize and constants. These tools report changes rather than approving pending API decisions. |

All listed code paths are internal except the shared Solana confirmation improvement and developer tooling. Internal files are not exported from the package root; UNIVERSAL_SVM_RULES is still absent from advertised capabilities.

## Validation

| Check | Final result |
| --- | --- |
| Full unfiltered unit suite | 1,975 passed, 0 failed; 12 existing skips; 115 suites passed, 1 skipped |
| New focused SVM/confirmation unit cases | 28 passed |
| Actual local contracts | 68 passed, 0 failed; 9 suites; no open-handle warning/forceExit |
| New backend actual-contract cases | 9 passed |
| Library/spec/local typechecks | Pass via unfunded command |
| Guide | 7 blocks typecheck without execution |
| Build, package imports/declarations/contents | Pass |
| Changed-file lint | 0 errors; 49 existing-style non-null/unused warnings across inspected tests/shared files |
| Workflow definition | YAML parses; read-only permissions; no wallet-key secrets; pinned contract source/Foundry |
| Local CI-equivalent command | Completes successfully; GitHub-hosted job has not been run yet |
| Prior live acceptance | 25 distinct registered native/EVM/UEA scenarios passed previously; not repeated or counted as new SVM settlement |

[Logs](logs/). Local tests use actual factory/wallet/engine/validator/URP; token/core/gateway and metadata/indexer/destination observations are fixtures. They prove SDK preflight, wrapping and contract enforcement, not Solana CPI/TSS settlement. This work did not load .env keys, broadcast funded transactions, deploy live contracts or publish npm.

The cluster check follows [Solana CAIP-2 genesis-prefix resolution](https://namespaces.chainagnostic.org/solana/caip2). CI uses the official [Foundry toolchain action](https://github.com/foundry-rs/foundry-toolchain) and the pinned [public contract source](https://github.com/pushchain/push-agentic-wallets/tree/e8db74815cfbbf5389593805e464fe8d85f7f735).

## API impact

[Automated comparison](api-comparison.json) against b1597b9: no added/removed root exports and no changed initialize signature. The changed root-visible AGW types are AGENTIC_ERROR_CODE (DUPLICATE_RULE → AMBIGUOUS_RULE) and AllowedCall (beneficiaryOffset). Donut agentic constants also changed. Those differences were introduced in the earlier v4 migration, not this backend batch. Native defaults/public raw authoring/multiple-rule selection remain unresolved.

Behavioral changes in this batch: Solana observations can settle from a confirmed/finalized destination RPC while Cosmos lags; wrong-cluster or processed observations cannot settle. The existing public method/receipt shapes remain. Internal wire requests can be executed by the backend tests, but public AGW Solana sends remain capability-gated. Existing public IDL resolution retains its default authority; only the internal AGW seam supplies the wallet's authority.

## What still needs external input or later integration

H3 native defaults/token wording, H4.5 public raw-offset shape, H6 multi-rule selection, ref/label v1 delivery/deferral and live SVM cluster fixtures remain. Once the SVM authoring/read model is agreed, connect it to the completed backend, agree public response presentation, enable the capability and run live Solana destination acceptance. creditRevert still needs the platform executor; nothing here restores spend automatically.

## Reproduction

```sh
AGW_LOCAL_DIR="${TMPDIR:-/tmp}/push-agw-local-v4" node packages/core/scripts/agw-verify.js
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand
```

The verification command never invokes funded E2Es or publication. AGW_REPO can point at the read-only pinned contract checkout; an absent local build is prepared in an isolated output directory.
