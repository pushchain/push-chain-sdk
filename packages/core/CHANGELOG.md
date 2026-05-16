@pushchain/core@6.0.2 (unreleased)

- Token constants now expose the missing `USDT.bsc` chain-suffix accessor,
  while keeping `USDT.bnb` as a deprecated alias for backward compatibility.

- Updated Donut testnet stable token metadata to match the current source of
  truth: external moveable token addresses are kept separate from Push Chain
  PRC20 addresses, and the WPC/stable pool address audit table now reflects the
  documented PRC20/pool pairs.

---

@pushchain/core@6.0.1 (2026-05-15)

- Pre-flight UEA balance checks now default to warning-only behavior and
  proceed when short. `sendTransaction` and `prepareTransaction` accept
  `options.enforceGasCheck: true` to restore fail-fast behavior with
  `InsufficientUEABalanceError`; pre-flight progress hooks now report
  `WARNING` vs `ERROR` with shortfall metadata.

- Token constants added the `USDC.bsc` BSC suffix accessor while retaining
  `USDC.bnb` as a deprecated compatibility alias.

- Consolidated tests, renamed transaction `target` fields to `recipient`, and
  fixed SVM test cases around the release.

---

@pushchain/core@6.0.0 (2026-05-14)

- Updated audit-driven contract and pool configuration, including BNB CEA
  address changes and refreshed pool addresses.

- Fixed cascade, SVM payload, and SVM execution flows, with additional test-case
  coverage for the audited scenarios.

- Improved PC amount formatting in transaction output and diagnostics.

---

@pushchain/core@5.1.18 (2026-05-12)

- Added `executeTransactions` progress-hook coverage and fixed cascade
  scenarios, including fresh-UEA and six-hop flows.

- Removed the `allowUnderfundedSwap` parameter and tightened native PC
  formatting.

---

@pushchain/core@5.1.17 (2026-05-07)

- Fixed the R3 EVM path tag so progress hooks emit the `303` route family
  instead of `203`.

---

@pushchain/core@5.1.16 (2026-05-07)

- Added pre-flight balance-check progress hooks.

- Fixed SVM rent checks, SVM upward ceiling behavior, cascade progress-hook
  handling, and shared PC formatting.

---

@pushchain/core@5.1.5 (2026-04-20)

- Route 1 (UOA → Push) now applies Case A/B/C USD-bucket sizing to the
  Push-chain gas cost. Case A pads deposits to the $1 floor; Case B passes
  through; Case C is informational (deposits proceed up to the origin
  gateway's contract-enforced `MAX_CAP_UNIVERSAL_TX_USD`). The SDK's previous
  $1000 ceiling has been removed. New progress hooks `SEND_TX_103_03_01/02/03`
  fire with the sizer's decision, under the new `SEND_TX_103_03` "Calculating
  Prepaid Deposit" parent and `SEND_TX_103_03_04` "Prepaid Deposit Estimated"
  terminal (which replaces the prior `SEND_TX_102_02` "Gas Estimated").

- Gas abstraction scope narrowed to R1 (fee-lock USD caps) and R3 (outbound
  msg.value sizing). R2 (UOA → CEA) and cascade outbound segments no longer
  apply Case A/B/C; R2 `msg.value` now uses a live Uniswap V3 quote + 10%
  safety buffer, and the contract refunds any excess as PC back to the UEA.
  The `SEND_TX_202_03_A/B/C` progress hooks, the Case-C bridge-swap composer,
  and the `GasExceedsCategoryCWithErc20FundsError` error class have all been
  removed.

---

@pushchain/core@5.1.0 (2026-03-28)

- release: bump to 5.0.0

---

@pushchain/core@3.0.4 (2025-11-11)

- refactor: remove debug console logs from Orchestrator class
- refactor: fix sendTxWithFunds_new for new UEA

---

@pushchain/core@3.0.1 (2025-11-10)

- release: bump to 3.0.0

---

@pushchain/core@3.0.0 (2025-11-10)

- refactor: rename ExecuteParams.payWith to payGasWith (breaking)
- refactor: implement _buildMulticallPayloadData; allow BSC for multicall; rename MulticallCall type MultiCall
- refactor: update RPC URLs and rename currency in Push Testnet Donut config
- chore: add new PRC20 token and contract addresses
- feat: add getPRC20Mapping utility in utils
- refactor: internal payload-builders improvements

---

@pushchain/core@2.1.1 (2025-10-26)

- release: bump to 2.0.21

---

@pushchain/core@2.0.0 (2025-09-18)

- fix: svm gateway idl
- fix: update contracts and price fn

---

@pushchain/core@1.1.35 (2025-08-26)

- chore: fix tc

---

@pushchain/core@1.1.34 (2025-08-18)

- fix: update return type for encodeFunctionData method to ensure correct string format

---

@pushchain/core@1.1.33 (2025-08-13)

- chore: bump version to 1.1.32 and update GitHub Action test comment
- refactor: update error messages for fundGas validation in PushChain tests and orchestrator
- refactor: add read-only accessors for Orchestrator configuration
- refactor: make isReadMode property public in PushChain class
- refactor: move isUniversalAccount function to static method in PushChain class
- release: bump to 1.1.32 [skip ci]
- chore: Add fundGas property to sendTransaction
- chore: add reinitialize method to PushChain for dynamic signer updates
- patch: implement read-only mode for UniversalAccount in PushChain

---

@pushchain/core@1.1.31 (2025-08-12)

- chore: update test comment to trigger GitHub Action 10

---

@pushchain/core@1.1.30 (2025-08-12)

- chore: update test comment to trigger GitHub Action 9

---

@pushchain/core@1.1.29 (2025-08-11)

- chore: bump core version to ui-kit

---

@pushchain/core@0.4.0 (2025-08-11)

- feat: Add UEA proxy (migration support) + testnet module renaming (#190)

---

@pushchain/core@0.3.1 (2025-08-08)

- refactor: rename and enhance executor-origin conversion utilities

---

@pushchain/core@0.3.0 (2025-08-05)

- feat: enhance transaction handling and origin fetching

---

@pushchain/core@0.2.0 (2025-08-01)

- feat: New response type (#180)

---

@pushchain/core@0.1.43 (2025-07-30)

- docs: update README with test change

---

@pushchain/core@0.1.42 (2025-07-29)

- feat: implement getOriginForUEA function in Utils for Push Testnet

---

@pushchain/core@0.1.41 (2025-07-21)

- fix: refine fee locking logic in Orchestrator to handle UEA deployment and fund sufficiency

---

@pushchain/core@0.1.40 (2025-07-09)

- feat: 1 Click Signature (#159)

---

@pushchain/core@0.1.38 (2025-07-04)

- fix: revert erip712Domain - does not work with ethers

---

@pushchain/core@0.1.37 (2025-07-04)

- fix: add eip712Hash

---

@pushchain/core@0.1.35 (2025-07-03)

- chore: fix changelog gen (#158)

---

@pushchain/core@0.1.34 (2025-07-03)

- chore: change release script

---

@pushchain/core@0.1.33 (2025-07-03)

- fix: revert package version
- chore: revise changelog design, change release commands
- chore: revise changelog
- chore: changelog scripts changes
- fix: release fix

---
