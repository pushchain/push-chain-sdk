# Extended AGW E2E coverage — October 6, 2026

Branch `feat/agw-sdk-v4`. This follow-up adds 14 additional Donut/Sepolia E2E scenarios in the opt-in `agw` group. They exercise wallet identity and management races, atomic rule lifecycle behavior, and native policy enforcement against the deployed v4 contracts. The cases use bounded testnet funds and create fresh test wallets.

## Coverage

| File                                                       | Scenarios | Checks                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | --------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/__e2e__/agw/management-extended.spec.ts`    |         6 | Prefunding a derived wallet, label/index reads, same-agent multiplicity and ambiguous-send refusal, batched add/revoke checkpoint counts, invalid revoke guards, stale update rollback after an intervening agent spend, and owner wallet-index race recovery. |
| `packages/core/__e2e__/agw/native-policy-extended.spec.ts` |         8 | Lossless raw-offset decode and recipient delivery, pin mismatch, per-call and cumulative amount caps, exact call count, explicit zero total, failed-callee rollback, and ungranted selector refusal without allowance change.                                  |

Every refusal test checks that balances and policy counters remain unchanged. The update-race test also checks that grants, checkpoint count and grant nonce remain unchanged after rollback.

## Race found and correction

The first funded run passed 13 of 14 scenarios. The wallet-index race proved that the losing create did not grant rules to the competing wallet, and the retry used the next slot, but the SDK returned a generic execution error instead of its documented `INDEX_RACE` result.

The create flow now classifies this narrow case from fresh factory/wallet reads: it requires an uncommitted failure, an advanced owner index, and a deployed wallet at the predicted slot with the same owner/index but a different immutable label. If reads are unavailable or evidence is ambiguous, the SDK preserves the original error. A unit regression and isolated live race pass. This is an internal error-classification correction; it does not change the public API.

## Validation

| Check                                                   | Result                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| Funded live run before consolidation                     | 14 passed, 0 failed (6 management + 8 native policy)             |
| Full core unit suite after the correction               | 1,982 passed, 0 failed; 12 skipped; 116 suites passed, 1 skipped |
| Focused management unit suite                           | 19 passed                                                        |
| `core` build                                            | Passed                                                           |
| `tsconfig.lib.json` and `tsconfig.spec.json` typechecks | Passed                                                           |
| Default E2E selection                                   | Unchanged: 76 scenarios / 40 files / 81 tests                    |
| AGW selection after consolidation                       | 39 scenarios/11 files/39 tests; all 14 additions are opt-in with the AGW group |

The 14 cases now live under `packages/core/__e2e__/agw/` and share the existing `--group agw`. They remain excluded from `all`, which still selects 76 scenarios. The combined group is guarded by the same verified manifest. Reproduce selection (no transactions):

```sh
cd packages/core
npx ts-node --transpile-only __e2e__/ci/run.ts --verify --group agw
```

Running the group broadcasts testnet transactions and spends testnet funds. It can be selected from the E2E workflow dispatch:

```sh
cd packages/core
npx ts-node --transpile-only __e2e__/ci/preflight.ts --group agw --dry-run
npx ts-node --transpile-only __e2e__/ci/run.ts --group agw
```

Use the existing test environment and preflight procedure before a rerun. Logs below are sanitized; private keys and environment values are not included.

## Logs

- [Final full funded run](../live-svm-wire-2026-10-06/logs/live-agw-extended-final.log)
- [Initial index-race reproduction](../live-svm-wire-2026-10-06/logs/live-agw-extended-index-race.log)
- [Initial full run](../live-svm-wire-2026-10-06/logs/live-agw-extended.log)
- [Unit suite](../live-svm-wire-2026-10-06/logs/unit-final.log)
- [Focused management unit suite](../live-svm-wire-2026-10-06/logs/management-unit.log)
- [Build](../live-svm-wire-2026-10-06/logs/build-final.log)
