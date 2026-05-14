# Audit 2026-05 — SDK Impact Analysis

This folder contains everything related to the May 2026 contract audit and the resulting SDK changes required.

**Audit comparison:** `audit-main` (pre-audit) → `audit-main-fixes` (post-audit)
**Date:** 2026-05-12
**SDK owner:** Shoaib

---

## Documents in this folder

| File | Purpose | Audience |
|---|---|---|
| [`sdk-changes-required.md`](./sdk-changes-required.md) | **Action-oriented** punch list of SDK changes with file paths, severities, and ready-to-paste code snippets. Optimized for engineers picking up tickets. | SDK team |
| [`sdk-audit-deep-dive.md`](./sdk-audit-deep-dive.md) | **Reference** doc with full audit-item-by-item mapping, contract source quotes, and all "verified non-impact" rationale. The "show your work" companion to the punch list. | SDK team (deep dive); engineering lead (audit traceability) |
| [`cea-factory-proxy-addresses.md`](./cea-factory-proxy-addresses.md) | Post-audit `CEAFactory (proxy)` addresses for ETH Sepolia, Base Sepolia, Arbitrum Sepolia, and BNB Testnet. | SDK + contracts team |
| [`pc-stable-pool-addresses.md`](./pc-stable-pool-addresses.md) | Confirmed Push Chain PRC-20 stable-token addresses and WPC/stable pool addresses for moveable/payable token resolution, gas sizing, and PC/USD oracle reads. | SDK + contracts team |
| [`route2-usdt-e2e-contract-mismatch.md`](./route2-usdt-e2e-contract-mismatch.md) | **Investigation note** for the BNB Testnet Route 2 USDT E2E failure: test command, failure sequence, UEA domain workaround, current C0/C1 interface mismatch, and required contract fix. | SDK + contracts team |

---

## Source audit documents

These are the original audit diff docs produced by the contracts team, kept here for traceability.

| File | Pages | Covers |
|---|---|---|
| [`audit-source/Core_Audit_Diff_Check_Doc.pdf`](./audit-source/Core_Audit_Diff_Check_Doc.pdf) | 34 | UniversalCore, CEA, CEAFactory, UEAFactory, UEA_EVM, UEA_SVM, UEAProxy, PRC20, WPC, Errors, StringUtils, plus testnetV0 variants |
| [`audit-source/EVM_Gateway_Audit_Diff_Doc.pdf`](./audit-source/EVM_Gateway_Audit_Diff_Doc.pdf) | 33 | UniversalGateway (source-chain inbound), UniversalGatewayPC (Push Chain outbound), Vault, VaultPC, IUniversalCore cross-repo dependency |
| [`audit-source/SVM_Gateway_Audit_Diff_Doc.pdf`](./audit-source/SVM_Gateway_Audit_Diff_Doc.pdf) | 69 | SVM Gateway program: errors, admin/governance, deposit, execute (finalize), rescue, revert, TSS, withdraw, lib, state |

---

## External references consulted

These were inspected directly via `git show` against the post-audit branches to verify open questions and confirm contract semantics.

### Repos

| Repo | Path | Branch checked |
|---|---|---|
| `push-chain-core-contracts` | `/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-core-contracts` | `origin/audit-main-fixes` |
| `push-chain-gateway-contracts` | `/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-gateway-contracts` | Local `audit-main-fixes` at `d696777` / `origin/audit-main-fixes` |
| `push-chain` (Cosmos module) | `/Users/shoaibmohammed/Desktop/work/PUSH/push-chain` | Local `cherry/release-pipeline-onto-audit-fixes` tracking `origin/audit-fixes` at `7d748bdf` as of 2026-05-11; also checked `origin/cherry/release-pipeline-onto-audit-fixes` |

### Specific contract files inspected

**push-chain-core-contracts (`origin/audit-main-fixes`):**
- `src/uea/UEA_EVM.sol` — domain separator, executeUniversalTx, _handleMigration (lines 89, 137, ~225)
- `src/uea/UEA_SVM.sol` — SVM domain separator (line 94)
- `src/Interfaces/IUEA.sol` — confirmed only ONE entrypoint `executeUniversalTx` exists post-audit
- `src/cea/CEA.sol` — _handleSingleCall funds-parking guard, _handleMigration self-target (lines 225-261)
- `src/UniversalCore.sol` — getOutboundTxGasAndFees 6-tuple ordering (line 280)
- `src/Interfaces/IUniversalCore.sol` — interface contract for SDK ABI
- `src/uea/UEAFactory.sol` — pushChainId initialization, getOriginForUEA
- `src/Interfaces/IUEAFactory.sol`
- `src/libraries/Types.sol` — `MIGRATION_SELECTOR = bytes4(keccak256("UEA_MIGRATION"))`

**push-chain-gateway-contracts (`audit-main-fixes` / `origin/audit-main-fixes`):**
- `contracts/evm-gateway/src/UniversalGatewayPC.sol` — sendUniversalTxOutbound + gasPrice override + maxPCForGas refund logic
- `contracts/evm-gateway/src/libraries/TypesUGPC.sol` — confirmed `UniversalOutboundTxRequest` struct field order with `gasPrice` between `gasLimit` and `maxPCForGas`
- `contracts/evm-gateway/src/UniversalGateway.sol` — TX_TYPE post-fee inference, token-overload msg.value rejection
- `contracts/evm-gateway/src/Vault.sol`, `VaultPC.sol`

**push-chain (Cosmos module — latest checked branches):**
- `x/uexecutor/README.md` — says standalone `MsgMigrateUEA` was removed and migration now goes through normal payload execution.
- `x/uexecutor/keeper/evm.go` — confirmed `CallUEAMigrateUEA` (line 194) still calls obsolete `migrateUEA` ABI fn at line 221, which no longer exists on the post-audit UEA contract. This is a code/docs mismatch on the current branch, not evidence that the branch is stale.
- `x/uexecutor/keeper/msg_migrate_uea.go` — Cosmos handler for MsgMigrateUEA, also still using the legacy MigrationPayload typehash flow
- `x/uexecutor/keeper/msg_server.go`
- `x/uexecutor/types/tx.pb.go` — `MsgMigrateUEA` proto definition
- `x/uexecutor/types/types.pb.go` — `MigrationPayload` proto definition
- `proto/uexecutor/v1/tx.proto`, `proto/uexecutor/v1/types.proto`

### Specific SDK files inspected

**push-chain-sdk (this repo, current `main`):**
- `packages/core/src/lib/orchestrator/internals/signing.ts` — buildDomainSeparator, signUniversalPayload, signMigrationPayload, computeMigrationHash
- `packages/core/src/lib/orchestrator/internals/account-manager.ts` — upgradeAccount flow
- `packages/core/src/lib/orchestrator/internals/gas-calculator.ts` — getOutboundTxGasAndFees tuple typing (line 196)
- `packages/core/src/lib/orchestrator/internals/route-handlers.ts` — buildOutboundRequest call sites + 1-wei workarounds + redundant approves
- `packages/core/src/lib/orchestrator/internals/cascade.ts` — cascade R3 multicall builder + redundant approves
- `packages/core/src/lib/orchestrator/internals/gateway-client.ts` — SVM `sendUniversalTx` accounts
- `packages/core/src/lib/orchestrator/internals/svm-helpers.ts` — buildSvmUniversalTxRequest
- `packages/core/src/lib/orchestrator/internals/svm-bridge.ts`
- `packages/core/src/lib/orchestrator/orchestrator.types.ts` — UniversalOutboundTxRequest interface
- `packages/core/src/lib/orchestrator/payload-builders.ts` — buildSendUniversalTxToUEA
- `packages/core/src/lib/constants/abi/prc20.evm.ts` — UNIVERSAL_CORE_EVM ABI
- `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts` — UGPC ABI + UniversalOutboundTxRequest tuple
- `packages/core/src/lib/constants/abi/universalGateway.evm.ts` — V1 source-chain gateway ABI
- `packages/core/src/lib/constants/abi/universalGatewayV0.json` — SVM gateway IDL (used by BorshEventCoder)
- `packages/core/src/lib/constants/abi/uea.evm.ts`, `uea.svm.ts`, `uea-factory.ts`, `cea.evm.ts`, `wpc.evm.ts`, `factoryV1.ts`
- `packages/core/src/lib/universal-tx-detector/events.ts`, `svm-events.ts`, `detector-svm.ts` — event subscribers
- `packages/core/src/lib/universal/account/account.ts` — getOriginForUEA call sites

---

## Where to start

1. **If you're an SDK engineer picking up tickets:** read [`sdk-changes-required.md`](./sdk-changes-required.md). The Punch List in §4 is the prioritized work queue.
2. **If you need to verify a specific audit item against contract source:** [`sdk-audit-deep-dive.md`](./sdk-audit-deep-dive.md) §13 has the full audit-item-by-item mapping with line numbers.
3. **If a reviewer asks "why doesn't X need an SDK change?":** the deep-dive doc's "Verified Non-Impact" sections answer this with the specific evidence.

---

## Coordination dependencies

These external repos must ship changes before the SDK can fully cut over. Tracked in `sdk-changes-required.md` §5.

| Repo | Status | Blocks SDK? |
|---|---|---|
| `push-chain-core-contracts` | Done — on `audit-main-fixes` | No |
| `push-chain-gateway-contracts` (EVM Gateway) | Done — on `origin/audit-main-fixes` | No |
| `push-chain-gateway-contracts` (SVM Gateway IDL artifact) | Runtime send path checked against source; canonical generated IDL still needed to sync admin instructions, inbound-fee event names, and TSS PDA seed metadata | No for current SDK send/detector paths; yes for full IDL/API parity |
| `push-chain` Cosmos module migration refactor | Current branch checked; implementation still calls obsolete `migrateUEA` while README describes execute-payload migration | Yes for `upgradeAccount()` only — other SDK audit changes can proceed |

## Current execution note

As of 2026-05-11, live e2e against the post-audit contracts is intentionally not run because the contracts are not deployed yet. The SDK branch is kept compile/unit-test ready; run deploy-network smoke tests after the contract deployment lands.
