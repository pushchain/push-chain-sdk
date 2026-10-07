# SDK alignment fixes — G27/G28

Both findings from the [source refresh](../source-refresh-2026-10-07/README.md) are implemented. No contract changes or new team questions are required. `setLabel` remains gated on its verified ABI/deployment.

## Behavior

**G27:** production Solana sends resolve and encode the request without evaluating granted expiry, amounts, account pins, data pins or program allow-lists locally. The contract/simulation enforces the chosen rule. Refusals flow through `wrapSendError` to `AgenticRevertError` with `decodedError`. EVM local PC-cap and asset-membership rejection was also removed; actual contract failures use the mapper there too.

SDK shape, context, asset-chain, wallet/signer balance and gateway-allowance guards remain. These are `AgenticError`s and do not pretend to be contract reverts. The strict pure SVM validators remain internal diagnostic tools; production sends do not use them to decide permissions.

**G28:** the owner door can send native SOL or SPL funds without an IDL/instruction. Requests have the specified 32-byte recipient, a positive amount and empty payload. The agent door still requires an encoded instruction. Neither door changes allowances automatically.

Send/wait/replay preserve wallet identity. Funds-only metadata adds `agentic.destinationTransfer = {recipient, token, amount}`; token is the burned Push PRC20. Native SOL transfers show the amount in `value`, SPL transfers show zero native value. Instruction metadata is absent for funds-only sends. A historical metadata-read failure retains the actual gateway summary and outbound polling rather than inventing transfer details.

Solana fee quoting now reuses core's finalization/rent budget with the AGW as execution identity and the actual source SPL mint. This covers conditional token-account rent without accidentally quoting the signer's CEA.

## Validation

| Check | Result |
| --- | --- |
| Full units | 2,003 passed, 0 failed; 12 existing skips |
| Actual contract harness | 85 passed, 0 failed; 11 suites |
| Public Solana live suite | Six scenarios have passing selected-run coverage |
| Owner funds-only SOL delivery | Passed: recipient balance increase, wallet debit, successful external receipt, wait/replay identity and amount |
| Contract refusal mapping | Passed live: account/data gates decoded as AgenticRevertError; balances, spend counters, checkpoints and nonce unchanged |
| Owner SPL funds-only | Passed locally: actual wallet/gateway pull+burn, quote mint/wallet context and zero native display value; no new live SPL transfer claimed |
| Build and types | Core build; lib/spec/local-contract/AGW-E2E typechecks pass |
| Package/API/docs | Packed imports, declarations, compiled API comparison and nine guide TypeScript blocks pass |
| Lint | Zero errors in changed TypeScript files; test-fixture non-null assertion warnings retained |
| Manifest | AGW: 48 scenarios/12 files/48 tests; default all remains 76/40/81 |

The first full six-case live run passed five cases, including funds-only delivery, and failed the refusal case with a non-policy SDK AgenticError while using an omitted/default gasLimit instead of the successful request’s gasLimit=0. Matching the quote parameters isolated the intended policy gate. The original assertion output did not record the SDK error code, so no more specific cause is claimed. The targeted retry passed with exact error-type/decoded-gate and state invariants. This is selected-run coverage, not a claimed single six-pass invocation. [Logs](logs/), [public evidence](live-evidence.json).

One intermediate full unit run hit the existing wall-clock timeout assertion (5,101ms against a 1,500ms limit). Its focused recheck and the final full run passed; no code in that timeout path was changed. Both logs are retained.

The actual-contract harness proves data-limit, PC-cap and expiry refusals using the real AGW/engine/URP. Its gateway/core/token are fixtures and do not prove relay/destination execution. Live SOL transfer checks independently prove the real destination result. Internal wire refusal E2Es were updated to assert mapped simulation errors; the historical three-case wire group was not rerun funded during this follow-up.

The live scenarios used previously authorized bounded Donut/devnet funds. Unit and local-contract runs were unfunded. No mainnet action, deployment, publication or team message was sent. Environment secrets are absent from the evidence.

## Reproduction

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand
AGW_LOCAL_DIR=/path/to/isolated-v4-build node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand
node node_modules/ts-node/dist/bin.js --transpile-only packages/core/__e2e__/ci/run.ts --verify --group agw
```

Use the established verified manifest and preflight before a funded E2E rerun; the `agw` group remains opt-in. The SDK consumer guide contains the public SOL/SPL transfer examples and supported-layout limits.
