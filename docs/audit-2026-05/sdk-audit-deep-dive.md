# Push Chain SDK — Audit-Driven Change List

**Source documents**
- `f9df0377-…_Core_Audit_Diff_Check_Doc.pdf` (59 changes across UniversalCore, CEA, CEAFactory, UEAFactory, UEA_EVM, UEA_SVM, UEAProxy, PRC20, WPC, Errors, StringUtils, plus testnetV0 variants)
- `5ba656a1-…_Gateway_Audit_Diff_Doc.pdf` (51 changes across UniversalGateway, UniversalGatewayPC, Vault, VaultPC, Errors, IUniversalCore cross-repo)

**Branches compared:** `audit-main` (pre) → `audit-main-fixes` (post)

**Audience:** SDK maintainers (`packages/core` primarily)

**Severity legend**
- 🔴 **BREAKING** — SDK call/encode/sign/decode fails at runtime against the new contracts; must ship before contracts cut over
- 🟡 **NON-BREAKING** — SDK keeps working; should adopt for new behavior, better error decoding, or gas savings
- 🟢 **NO CHANGE** — audit item touches no SDK surface

---

## 0. Executive Summary

| Severity | Count |
|---|---:|
| 🔴 BREAKING | 5 |
| 🟡 NON-BREAKING (recommended) | 7 |
| 🟢 NO CHANGE (audit items verified inert for SDK) | many |

**Hard blockers — must ship in lockstep with contracts:**
1. EIP-712 domain separator: add `bytes32 salt = block.chainid` (EVM); add salt + hash chainId with keccak256 (SVM) — `signing.ts`
2. `getOutboundTxGasAndFees` ABI return tuple expanded 5 → 6 (added `gasLimitUsed`) — `prc20.evm.ts` + tuple type in `gas-calculator.ts`
3. `UniversalOutboundTxRequest` struct gains `uint256 maxPCForGas` between `gasLimit` and `payload` — `universalGatewayPC.evm.ts` + `orchestrator.types.ts`
4. CEA `_handleSingleCall` funds-parking: requires BOTH `payload.length == 0` AND `recipient == address(0)` — audit any payload-only multicall the SDK builds
5. CEA `_handleMigration`: requires `recipient == address(this)` — `upgradeAccount` flow must target self

---

## 1. UEA EIP-712 Signing (HIGH IMPACT — affects both `executeUniversalTx` and `upgradeAccount`)

**Audit refs:** Core #38 (UEA_EVM domainSeparator), Core #40 (UEA_SVM domainSeparator), Core #39/#41 (executeUniversalTx nonce check)

**SDK files:**
- `packages/core/src/lib/orchestrator/internals/signing.ts:21-51` — `buildDomainSeparator` (used by SVM hash construction AND visible to EVM via viem `signTypedData`)
- `packages/core/src/lib/orchestrator/internals/signing.ts:168-218` — `signUniversalPayload` (EVM `signTypedData` domain object)
- `packages/core/src/lib/orchestrator/internals/signing.ts:220-280` — `signMigrationPayload` (same, but for upgradeAccount)
- Tests: `signing-payload.spec.ts`, `push-chain.signing.spec.ts`

| Change | Severity | Required SDK action |
|---|---|---|
| EVM `EIP712Domain` adds `bytes32 salt = bytes32(block.chainid)`. New typehash `0xb90aaffa…`. Domain string is now `EIP712Domain(string version,uint256 chainId,address verifyingContract,bytes32 salt)` | 🔴 BREAKING | (a) `buildDomainSeparator`: add 5th encoded param `{ name: 'salt', type: 'bytes32' }` populated with `bytes32(BigInt(chainId))` (or `block.chainid` of the verifying chain — note: this is the **verifying chain's** chainid, i.e. Push Chain's, not the signer's). (b) EVM `signTypedData` (signing.ts:182-203): add `salt` field to `domain`. viem will auto-include if present in the EIP712Domain types — pass `salt: padHex(toHex(BigInt(pushChainId)), { size: 32 })`. **Decision needed:** is `salt` Push Chain's chainid (the chain where UEA lives), not the source chain? Per audit doc: "prevents cross-deployment replay across Push Chain forks" — confirms it's Push Chain's chainid. |
| SVM `EIP712Domain_SVM`: (a) `chainId` is now hashed with `keccak256` per EIP-712 spec for dynamic strings (was passed raw); (b) adds `bytes32 salt` field. New typehash `0x038a4fd0…`. | 🔴 BREAKING | In `buildDomainSeparator`, when `vm === SVM`: change the chainId encoding from raw `string` to `bytes32` of `keccak256(toBytes(chainId))`, and add salt as 5th element. The encoded ABI types become `[bytes32, bytes32, bytes32, address, bytes32]`. |
| `executeUniversalTx` reverts `NonceMismatch(uint256 expected, uint256 provided)` if `payload.nonce != contract.nonce` (was silently mishashed before) | 🟡 NON-BREAKING | SDK already increments nonce correctly via `getUEANonce` + `nonce + 1` patterns. Add `NonceMismatch` to the UEAErrors set so a bad nonce surfaces as a typed error instead of opaque `0x…` revert. |

> **Cross-cutting note:** Both `signUniversalPayload` AND `signMigrationPayload` call `buildDomainSeparator`. A single fix in `buildDomainSeparator` covers both flows. The `upgradeAccount` flow (account-manager.ts:108) sends an EVM `signTypedData` which won't auto-include `salt` unless the SDK declares the EIP712Domain types or passes `salt` in domain object — viem 2.x treats domain `salt` correctly when present.

---

## 2. UniversalCore ABI / Outbound Gas Quoting (HIGH IMPACT)

**Audit refs:** Core #5 (getOutboundTxGasAndFees), Core #14/#13 (gas data freshness), Core #7 (zero gas price), Gateway IUniversalCore interface

**SDK files:**
- `packages/core/src/lib/constants/abi/prc20.evm.ts:5-30` — UNIVERSAL_CORE_EVM ABI
- `packages/core/src/lib/orchestrator/internals/gas-calculator.ts:183-210` — `queryOutboundGasFee`

| Change | Severity | Required SDK action |
|---|---|---|
| `getOutboundTxGasAndFees` returns 6-tuple (added `uint256 gasLimitUsed` as 6th output) | 🔴 BREAKING (ABI) | (a) Update `outputs` array in `prc20.evm.ts:14-20` to add `{ name: 'gasLimitUsed', type: 'uint256', internalType: 'uint256' }`. (b) Update tuple type in `gas-calculator.ts:196` from `[address, bigint, bigint, bigint, string]` → `[address, bigint, bigint, bigint, string, bigint]`. **viem will throw a decode error against the new contract until the ABI is updated.** SDK can ignore the 6th value initially, but the type widening must happen for compile/decode. |
| Reverts `ZeroBaseGasLimit()` if base limit not configured for chain | 🟡 NON-BREAKING | Add to error decoder; surface to caller as a typed quoting failure. |
| New `_validateGasDataFreshness` — reverts `StaleGasData(uint256 observedAt, uint256 nowTs, uint256 maxAge)` when chain price is older than configured `maxStalenessByChainNamespace` | 🟡 NON-BREAKING (functional) | Add `StaleGasData(uint256, uint256, uint256)` to error decoder. Surface a clear "stale relay data" message to caller — actionable: "wait for relayer to push fresh chain meta". |
| `setChainMeta` rejects `price == 0` (`ZeroGasPrice` error) | 🟢 Admin-only setter — no SDK impact. |
| `BASE_GAS_LIMIT()` removed from `IUniversalCore` interface | 🟡 NON-BREAKING | The ABI entry at `prc20.evm.ts:25-30` is dead code. SDK does not call this function from `src/`. Remove the entry; update doc comment at `orchestrator.types.ts:559` from "0 = default BASE_GAS_LIMIT" to "0 = per-chain default (resolved by UniversalCore)". |
| New `isSupportedToken(address) → bool` on `IUniversalCore` | 🟡 NON-BREAKING (optional) | Optional pre-flight check before `sendUniversalTxOutbound`. UGPC validates server-side anyway (audit Gateway UGPC #3), so SDK can rely on contract revert and skip the extra read. |
| UVCore admin setters renamed `set*` → `update*` (12 functions: `setProtocolFeeByToken`, `setGasPCPool`, `setGasTokenPRC20`, `setAutoSwapSupported`, `setWPC`, `setUniversalGatewayPC`, `setUniswapV3Addresses`, `setDefaultFeeTier`, `setDefaultDeadlineMins`, `setBaseGasLimitByChain`, `setRescueFundsGasLimitByChain`). `setChainMeta` NOT renamed. | 🟢 Admin-only — none in current SDK ABI surface. |

---

## 3. UniversalGatewayPC — Outbound Tx Struct (HIGH IMPACT)

**Audit refs:** Gateway UGPC #4 (maxPCForGas slippage), UGPC #11 (TypesUGPC struct), UGPC #6/#10 (updateUniversalCore + event), UGPC #8 (state var renames), UGPC #2 (burnPRC20 return check), UGPC #3 (isSupportedToken validation)

**SDK files:**
- `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts:38-58` — sendUniversalTxOutbound ABI tuple
- `packages/core/src/lib/orchestrator/orchestrator.types.ts:548-565` — `UniversalOutboundTxRequest` interface

| Change | Severity | Required SDK action |
|---|---|---|
| `UniversalOutboundTxRequest` struct gains NEW field `uint256 maxPCForGas` between `gasLimit` and `payload` | 🔴 BREAKING (calldata layout) | (a) Add `{ internalType: 'uint256', name: 'maxPCForGas', type: 'uint256' }` to ABI tuple at `universalGatewayPC.evm.ts:45` between `gasLimit` and `payload`. (b) Add `maxPCForGas: bigint;` field to TS interface at `orchestrator.types.ts:548-565` in the same position. (c) Default to `0n` (= no cap, preserves old behavior) in every call site that builds this struct: `route-handlers.ts` (multiple sites including `buildOutboundRequest` callers), `cascade.ts`. **If SDK omits it, abi.encoded calldata misaligns — `payload`/`revertRecipient` decode as garbage and the call reverts or worse, mis-routes funds.** |
| New `updateUniversalCore(address)` admin setter + `UniversalCoreUpdated` event | 🟢 Admin-only. |
| `UNIVERSAL_CORE()` accessor renamed to `universalCore()`; `VAULT_PC()` → `vaultPC()` | 🔴 BREAKING for SDK live reads | ABI at `universalGatewayPC.evm.ts:60-65` declares `name: 'UNIVERSAL_CORE'`, and live `readContract` callers exist in `gas-calculator.ts`, `pc-usd-oracle.ts`, and `cascade.ts`. Rename the ABI entry and all call sites to `universalCore`. |
| `_burnPRC20` reverts `TokenTransferFailed(token, amount)` on PRC20 `transferFrom` returning false | 🟡 NON-BREAKING | Add to error decoder. Existing flows already use compliant tokens. |
| `sendUniversalTxOutbound` reverts `NotSupported` for unsupported tokens via `isSupportedToken` check | 🟡 NON-BREAKING | Better failure mode — surface as a typed error. |

---

## 4. UniversalGateway (Source-Chain Inbound) — Renames + token-overload guard

**Audit refs:** Gateway UG #2 (fee-on-transfer at deposit), UG #3 (fee-on-transfer in swap), UG #4 (epoch event), UG #5/#6 (TSS/Vault setter renames), UG #7 (USD cap raw-wei accumulation), UG #8 (TX_TYPE post-fee), UG #9 (token-overload msg.value rejection), UG #10 (deadline pre-check removal), UG #11/#12 (setProtocolFee → setInboundFee), UG #23 (state var camelCase), UG #27 (interface event additions/removals)

**SDK files:**
- `packages/core/src/lib/orchestrator/internals/gateway-client.ts:92-108` — token-overload caller (`sendGatewayTokenTxWithFallback`)
- `packages/core/src/lib/orchestrator/internals/execute-funds-payload.ts:268` — only caller (verified: passes no `value` arg → `msg.value` defaults to 0)
- `packages/core/src/lib/universal-tx-detector/events.ts` — event fragments

| Change | Severity | Required SDK action |
|---|---|---|
| Token-overload `sendUniversalTx(UniversalTokenTxRequest)` reverts if `msg.value != 0` | 🟢 ALREADY CORRECT | Verified: `execute-funds-payload.ts:268` calls `sendGatewayTokenTxWithFallback(ctx, evmClient, gateway, reqToken, signer)` — no `value` arg, so viem sends `value=0`. No change needed. **Add a regression test** asserting this (Review Tasks: assigned to Shoaib). |
| `_routeUniversalTx`: `TX_TYPE` now inferred AFTER fee deduction (was before). Edge case: `msg.value == INBOUND_FEE` exactly. | 🟡 NON-BREAKING | Update test fixtures asserting `TX_TYPE` for the boundary case (Review Tasks: assigned to Shoaib). |
| `EpochDurationUpdated` event signature gains `uint64 epochIndexAtChange` (3rd param) | 🟢 Not subscribed by SDK detector. |
| `UniversalTxExecuted` event REMOVED entirely from `IUniversalGateway`. Still emitted by **CEA** (`_handleSingleCall`). | 🟡 NON-BREAKING | The SDK's `EVENT_UNIVERSAL_TX_EXECUTED` (events.ts:67) decodes a CEA-emitted event, not a UG-emitted one. Update the source comment at events.ts:5-10 to point to `ICEA.sol` instead of `IUniversalGateway.sol`. The event ABI itself is unchanged. |
| New events: `UniswapV3ConfigUpdated`, `TokensMigrated`, `UniversalCoreUpdated`. Removed: `TSSUpdated`. | 🟢 Not consumed by SDK. |
| Renames: `setTSS` → `updateTSS`, `setVault` → `updateVault`, `setRouters` → `updateUniswapV3Config`, `setCEAFactory` → `updateCEAFactory`, `setProtocolFee` → `setInboundFee` | 🟢 Admin-only. |
| State var camelCase: `TSS_ADDRESS()` → `tssAddress()`, `VAULT()` → `vault()`, `BLOCK_USD_CAP()` → `blockUsdCap()`, `MIN_CAP_UNIVERSAL_TX_USD()` → `minCapUniversalTxUsd()`, `MAX_CAP_UNIVERSAL_TX_USD()` → `maxCapUniversalTxUsd()`, `WETH()` → `weth()`, `CEA_FACTORY()` → `ceaFactory()`, `INBOUND_FEE()` → `inboundFee()` | 🟢 No SDK reads of these. (Note: if any docs/examples or external integrators use them, they'd break.) |

---

## 5. CEA — sendUniversalTxToUEA Semantics + Multicall (HIGH IMPACT)

**Audit refs:** Core #19/#20 (CEA storage layout), Core #21 (onlyVault live lookup), Core #22 (sendUniversalTxToUEA dual semantics + approval lifecycle), Core #23 (multicall revert bubbling), Core #24 (single-call funds-parking guard), Core #25 (migration self-target), Core #26 (param rename), Core #28 (deployCEA simplified)

**SDK files:**
- `packages/core/src/lib/constants/abi/cea.evm.ts` — CEA ABI
- `packages/core/src/lib/orchestrator/internals/cascade.ts:1003-1081` — cascade R3 multicall builder
- `packages/core/src/lib/orchestrator/internals/route-handlers.ts:1130-1237` — single R3 hop builder
- `packages/core/src/lib/orchestrator/internals/route-handlers.ts:1995-2060` — nested R3 hop builder
- `packages/core/src/lib/orchestrator/payload-builders.ts` — `buildSendUniversalTxToUEA`

| Change | Severity | Required SDK action |
|---|---|---|
| `sendUniversalTxToUEA`: `amount == 0` revert REMOVED → zero-amount payload-only sends now allowed (three-way branch). ERC-20 path now does `approve(gateway, amount)` BEFORE + `approve(gateway, 0)` AFTER gateway call internally. Gateway address now read from factory at runtime. | 🟡 NON-BREAKING | (a) **Remove the redundant `[approve(0), approve(amount)]` pre-calls** the SDK currently inserts into the CEA multicall in 3 sites: `cascade.ts:1045-1065`, `route-handlers.ts:1166-1190`, `route-handlers.ts:2013-2033`. The contract now handles the approve lifecycle internally. Saves ~46K gas per ERC-20 outbound. (b) Update tests in `payload-builders.spec.ts` and cascade fixtures that assert multicall length/contents. (c) Optionally drop the legacy 1-wei workarounds at `route-handlers.ts:1584, 1845, 1972` if those paths now go through the new sendUniversalTxToUEA semantics (verify each path; per memory, UGPC's amount=0 was already permitted, so these may already be vestigial). |
| `_handleMulticall` bubbles up underlying revert via `assembly { revert(add(32, returnData), mload(returnData)) }` instead of opaque `ExecutionFailed()` | 🟡 NON-BREAKING (better DX) | viem's `decodeErrorResult` will now surface inner reasons. Update tests that pinned to `ExecutionFailed` (Review Tasks: assigned to Shoaib). |
| `_handleSingleCall` funds-parking: now requires BOTH `payload.length == 0` AND `recipient == address(0)`. Previously only `payload.length == 0` was checked. | 🔴 BREAKING (semantic) | Audit any SDK builder that emits `payload.length == 0` with a non-zero recipient — that path previously skipped execution silently; now it attempts `recipient.call{value: msg.value}("")` and reverts if recipient rejects. **Verified:** grep for `payload-only`/`parking` patterns shows no current SDK builds this. Action: explicit comment in `payload-builders.ts` to set `recipient = address(0)` when intentionally parking funds. Add test asserting funds-parking branch hit. |
| `_handleMigration` requires `recipient == address(this)` (CEA self-target) | 🔴 BREAKING IF SDK BUILDS MIGRATION CALLS | Per memory `project_uea_migration_upgrade.md`, migration is part of `upgradeAccount()`. Any SDK builder constructing the migration multicall must set `recipient = ceaAddress` (the CEA itself). Verify in `account-manager.ts:108-189` and any new migration flows. |
| `executeUniversalTx` param rename `txId` → `subTxId` | 🟡 NON-BREAKING (positional) | ABI is positional, encoding still works. Update CEA ABI entry's `inputs[0].name` if exposed for documentation hygiene. Already aligned in detector ABI (events.ts:72 uses `subTxId`). |
| CEA storage layout: `VAULT` and `UNIVERSAL_GATEWAY` no longer stored — read live from factory via new view getters | 🟡 NON-BREAKING | View functions `VAULT()` / `UNIVERSAL_GATEWAY()` still exist with same selectors. SDK reads (if any) keep working. |
| `deployCEA`: `initializeCEA` signature went from 4 params → 2 params | 🟢 SDK does not deploy CEAs directly. |
| `onlyVault` modifier now performs `factory.VAULT()` lookup instead of stored slot | 🟢 Transparent — same authorization semantics. |

---

## 6. UEAFactory

**Audit refs:** Core #32 (getOriginForUEA configurable pushChainId), Core #33 (registerUEA one-time), Core #34 (updateUEAImplementation NEW), Core #35 (updatePushChainId NEW), Core #36 (renames + role reassignment), Core #37 (PauserRole removal)

**SDK files:**
- `packages/core/src/lib/constants/abi/uea-factory.ts` — minimal ABI (only `UEA_VERSION`, `UEA_MIGRATION_CONTRACT`)
- `packages/core/src/lib/constants/abi/factoryV1.ts:40` — `getOriginForUEA` ABI
- `packages/core/src/lib/universal/account/account.ts:373, 491, 789, 857` — `getOriginForUEA` callers
- `packages/core/src/lib/orchestrator/internals/account-manager.ts:42` — `UEA_VERSION` reader

| Change | Severity | Required SDK action |
|---|---|---|
| `getOriginForUEA`: hardcoded `chainId: "42101"` replaced with configurable `pushChainId` storage var | 🟡 NON-BREAKING | Function signature unchanged; SDK calls keep working. The returned `UniversalAccountId.chainId` value will differ on mainnet vs testnet — make sure SDK never independently hardcodes "42101" when round-tripping. **Verified:** only test files reference "42101" as comments (`context-helpers-tracker.spec.ts:353, 555`). No production code hardcodes it. |
| `registerUEA` reverts `UEAAlreadyRegistered()` if VM hash already mapped (one-time only) | 🟡 NON-BREAKING (admin only) | If SDK ever exposes admin tooling, surface the new error. |
| New `updateUEAImplementation(bytes32, address)` for explicit overwrite path | 🟢 Admin-only. |
| New `updatePushChainId(string)` setter | 🟢 Admin-only. |
| Renames: `setUEAProxyImplementation` → `updateUEAProxyImplementation`, `setUEAMigrationContract` → `updateUEAMigrationContract`. Roles changed `DEFAULT_ADMIN_ROLE` → `UEA_ADMIN_ROLE`. | 🟢 Not in SDK ABI surface. |
| Removed `setPauserRole`, `PauserRoleGranted` event | 🟢 Not in SDK. |

---

## 7. Vault / VaultPC

**Audit refs:** Vault #2 (TSS_ADDRESS removed), Vault #3 (migrateTokens NEW), Vault #4 (receive payable), Vault #5/#6 (renames), VaultPC #2 (FeesWithdrawn signature change), VaultPC #3 (role change)

| Change | Severity | Required SDK action |
|---|---|---|
| `TSS_ADDRESS` state var removed; TSS managed via role grants only | 🟢 SDK does not read this. |
| New `migrateTokens(address newVault, address[] tokens)` + `TokensMigrated` event + `receive() payable` | 🟢 Admin/ops only. |
| `setGateway` → `updateGateway`; `setCEAFactory` → `updateCEAFactory` | 🟢 Not in SDK. |
| `FeesWithdrawn` event signature: now `(caller indexed, to indexed, token indexed, amount)` — added `address indexed to` as 2nd param, shifted others | 🟡 NON-BREAKING | SDK does not subscribe to `FeesWithdrawn`. If analytics consumers do, they must update topic count and decoding. |

---

## 8. PRC20 / WPC Token Layer

**Audit refs:** Core #43 (transferFrom CEI), Core #44 (deposit CorePaused), Core #45 (NameUpdated/SymbolUpdated events), Core #46 (WPC totalSupply), Core #47 (WPC deposit/withdraw + .call replaces .transfer), Core #48 (transferFrom custom errors)

| Change | Severity | Required SDK action |
|---|---|---|
| PRC20 `transferFrom`: allowance check now happens BEFORE transfer (CEI pattern) | 🟢 Functionally equivalent for valid txs. |
| PRC20 `deposit` reverts `CorePaused()` when UniversalCore paused; `Deposit` event now emitted with actual `msg.sender` (was hardcoded `UNIVERSAL_EXECUTOR_MODULE`) | 🟡 NON-BREAKING | If SDK decodes `Deposit` event's first indexed field, the topic value differs in some flows (still an `address`). Likely no-op since SDK relies on `subTxId`/`universalTxId` correlation, not depositor identity. |
| New PRC20 events: `NameUpdated(string oldName, string newName)`, `SymbolUpdated(string oldSymbol, string newSymbol)` | 🟢 Not consumed. |
| WPC `totalSupply` now backed by `_totalSupply` counter (no longer `address(this).balance`); `deposit`/`withdraw` track it; `withdraw` uses `.call{value}` (no 2300-gas limit) | 🟡 NON-BREAKING | If any SDK UI reads WPC `totalSupply`, value will be lower (excludes force-sent ETH). No SDK reads found. |
| `transferFrom` empty `require` strings replaced with `WPCErrors.InsufficientBalance`, `WPCErrors.InsufficientAllowance` | 🟡 NON-BREAKING | Add `WPCErrors` to error decoder for cleaner failure messages. |

---

## 9. Errors Library — New Errors to Decode

**Audit refs:** Core #49, Gateway "Errors.sol (Library)" #1

Add to ABI errors (or add a dedicated decoder set) for typed surfacing instead of raw 0x… reverts:

**From Core (UniversalCore / UEA / PRC20):**
- `CorePaused()`
- `ZeroBaseGasLimit()`
- `StaleGasData(uint256 observedAt, uint256 nowTs, uint256 maxAge)`
- `PRC20OperationFailed()`
- `NonceMismatch(uint256 expected, uint256 provided)`
- `UEAAlreadyRegistered()`
- `WPCErrors.InsufficientBalance()`, `WPCErrors.InsufficientAllowance()`, `WPCErrors.TransferFailed()`
- `StringUtilsErrors.EmptyString()`, `StringUtilsErrors.NonDigitCharacter()`

**Removed (drop from any decoder if present):**
- `InvalidSlippageTolerance()`

**From Gateway:**
- `GatewayNotPaused()` (Vault.migrateTokens)
- `EmptyTokenList()` (Vault.migrateTokens)
- `TokenTransferFailed(address token, uint256 amount)` (UGPC._burnPRC20)

Severity: 🟡 NON-BREAKING (developer-experience improvement)

---

## 10. Testnet V0 Variants (for reference — likely not consumed by SDK)

**Audit refs:** Core #51-#59 (UniversalCoreV0, UEAFactoryV0, PRC20V0)

| Change | SDK impact |
|---|---|
| Deprecated state vars marked `__deprecated_*` (slippageTolerance, uniswapV3Quoter, isSupportedToken) | 🟢 |
| `setChainMeta` removed `observedAt` param — uses `block.timestamp` directly | 🟢 SDK does not call this. |
| Function renames same as v1 (`set*` → `update*`) | 🟢 |
| Fee tier constants added (`FEE_TIER_LOWEST=100`, `FEE_TIER_LOW=500`, `FEE_TIER_MEDIUM=3000`, `FEE_TIER_HIGH=10000`, `MAX_SLIPPAGE_BPS=5000`) | 🟢 If SDK or relayer hardcodes pool fees, align with these constants. |
| UEAFactoryV0: `getOriginForUEA` configurable `pushChainId` (same as v1); new `updatePushChainId`; `PauserRoleGranted` event moved to local contract for ABI compat | 🟢 |
| New PRC20V0 implementation | 🟢 SDK ABI is for v1. |

---

## 11. Punch List (Concrete File:Line Fixes, Priority Order)

| # | Priority | File | Change | Est. effort |
|---|---|---|---|---|
| 1 | 🔴 P0 | `packages/core/src/lib/orchestrator/internals/signing.ts:21-51` | Add `bytes32 salt` to EVM domain (5th encoded param). For SVM: hash `chainId` with `keccak256(toBytes(chainId))` and add `salt` as 5th param. Update ABI types array accordingly. | 30 min + tests |
| 2 | 🔴 P0 | `packages/core/src/lib/orchestrator/internals/signing.ts:182-203` | EVM `signTypedData` domain: add `salt: padHex(toHex(BigInt(pushChainId)), { size: 32 })`. Decide source of pushChainId — likely Push Chain mainnet/testnet chainId, NOT the source chain. | 15 min |
| 3 | 🔴 P0 | `packages/core/src/lib/constants/abi/prc20.evm.ts:14-20` | Add 6th output `gasLimitUsed: uint256` to `getOutboundTxGasAndFees`. Remove dead `BASE_GAS_LIMIT` ABI entry (lines 25-30). | 5 min |
| 4 | 🔴 P0 | `packages/core/src/lib/orchestrator/internals/gas-calculator.ts:196` | Widen tuple type `[address, bigint, bigint, bigint, string]` → `[address, bigint, bigint, bigint, string, bigint]`. Optionally read `gasLimitUsed` from index 5. | 5 min |
| 5 | 🔴 P0 | `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts:42-48` | Insert `{ internalType: 'uint256', name: 'maxPCForGas', type: 'uint256' }` between `gasLimit` and `payload` in struct components. | 2 min |
| 6 | 🔴 P0 | `packages/core/src/lib/orchestrator/orchestrator.types.ts:548-565` | Add `maxPCForGas: bigint;` field to `UniversalOutboundTxRequest` interface between `gasLimit` and `payload`. Update jsdoc. | 2 min |
| 7 | 🔴 P0 | All callers of `buildOutboundRequest` (multiple sites in `route-handlers.ts`, `cascade.ts`) | Pass `maxPCForGas: 0n` (no cap) by default. Optionally expose as user param. | 30 min |
| 8 | 🔴 P0 | `packages/core/src/lib/orchestrator/internals/account-manager.ts:108-189` (upgradeAccount) | Verify migration call sets `recipient = ueaAddress` (CEA-self-target). Add unit test. | 30 min |
| 9 | 🟡 P1 | `packages/core/src/lib/orchestrator/internals/cascade.ts:1045-1065` | **Remove** redundant `[approve(0), approve(amount)]` pre-calls before `sendUniversalTxToUEA` — contract handles internally now. | 10 min |
| 10 | 🟡 P1 | `packages/core/src/lib/orchestrator/internals/route-handlers.ts:1166-1190` | Same: remove `[approve(0), approve(amount)]` pre-calls. | 10 min |
| 11 | 🟡 P1 | `packages/core/src/lib/orchestrator/internals/route-handlers.ts:2013-2033` | Same: remove `[approve(0), approve(amount)]` pre-calls. | 10 min |
| 12 | 🟡 P1 | All ABIs (`prc20.evm.ts`, `uea.evm.ts`, `cea.evm.ts`, `universalGatewayPC.evm.ts`) | Add new error definitions: `CorePaused`, `ZeroBaseGasLimit`, `StaleGasData`, `PRC20OperationFailed`, `NonceMismatch`, `UEAAlreadyRegistered`, `TokenTransferFailed`. | 30 min |
| 13 | 🔴 P0 | `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts:61`; callers in `gas-calculator.ts`, `pc-usd-oracle.ts`, `cascade.ts` | Rename ABI and `readContract` calls from `UNIVERSAL_CORE` → `universalCore`. | 15 min |
| 14 | 🟡 P1 | `packages/core/src/lib/universal-tx-detector/events.ts:5-10` | Update comment block: `UniversalTxExecuted → ICEA.sol` (was `IUniversalGateway.sol`). | 1 min |
| 15 | 🟡 P2 | `packages/core/src/lib/orchestrator/internals/route-handlers.ts:1584, 1845, 1972` | Drop the `burnAmount = BigInt(1)` workarounds for paths that now flow through `sendUniversalTxToUEA` (Core #22 allows amount=0). Verify per-call-site whether path is Push→Source via UGPC (already permitted) or via CEA→UG (newly permitted). | 30 min + tests |
| 16 | 🟡 P2 | `packages/core/src/lib/orchestrator/orchestrator.types.ts:559` | Update doc comment: "0 = default BASE_GAS_LIMIT" → "0 = per-chain default (resolved by UniversalCore)". | 1 min |

---

## 12. Test Impact (Review Tasks Assigned to Shoaib in Audit Doc)

From the audit doc's Review Tasks tables, these tests need updating:

| Audit area | Test work |
|---|---|
| CEA `sendUniversalTxToUEA` | Add tests for new semantics: zero-amount payload-only sends, ERC-20 approval lifecycle (now internal). Files: `payload-builders.spec.ts`, `route-handlers` tests, e2e at `__e2e__/docs-examples/06-send-universal-transaction/`. |
| CEA `_handleMulticall` | Update tests to assert bubbled revert reasons instead of `ExecutionFailed`. |
| CEA `_handleSingleCall` | Add test asserting funds-parking requires both `payload.length == 0` AND `recipient == address(0)`. |
| CEA `_handleMigration` | Update upgradeAccount tests to assert `recipient == ueaAddress`. Files: `account-manager` tests. |
| UEAFactory `getOriginForUEA` | Confirm SDK doesn't break when `pushChainId` is configurable (different value mainnet vs testnet). Add test using mocked non-"42101" return. |
| UEA `domainSeparator` (EVM + SVM) | Verify signatures verify against new `bytes32 salt` domain. Files: `signing-payload.spec.ts`, `push-chain.signing.spec.ts`. |
| UGPC `sendUniversalTxOutbound` | Verify new `maxPCForGas` field doesn't break encoding when set to 0. Add test for non-zero cap with refund path. |
| UGPC `_fetchOutboundTxGasAndFees` | Verify gas+fee quoting returns 6-tuple correctly; SDK ignores 6th value safely. |
| UG `sendUniversalTx (token overload)` | Regression test: assert no `msg.value` is sent in token-overload path (already correct in `execute-funds-payload.ts:268`). |

---

## 13. Out of Scope / No SDK Impact

These audit changes do not require SDK code changes. Listing for completeness so we can confirm we evaluated each:

- Core #1, #11, #18, #27, #29, #30, #31, #36, #37 — Access control redesign + role separation across all contracts (admin-only)
- Core #2-4, #15 — `depositPRC20Token`, `swapAndBurnGas`, `_autoSwap` reentrancy/SafeERC20 hardening (UE-module only, not callable from SDK)
- Core #6 — `getRescueFundsGasLimit` staleness validation (used by SDK at gas-calculator.ts:407 — keeps working, just adds a new revert path)
- Core #8 — `updateGasTokenPRC20` zeros gas price (admin-only)
- Core #9 — `updateDefaultFeeTier` accepts 1bps fee tier (admin-only)
- Core #10 — `updateUniswapV3Addresses` removes `quoter` (admin-only)
- Core #12 — `rescueNativePC` NEW (admin-only)
- Core #13, #14 — `updateMaxStalenessByChain` + `_validateGasDataFreshness` (admin-only setter; SDK only sees error path covered above)
- Core #16, #54 — Removed `setSupportedToken`, `setSlippageTolerance` (unused)
- Core #17, #53 — Function renames `set*` → `update*` (admin only — none in SDK ABI)
- Core #18 — New events `SetAutoSwapSupported`, `SetWPC`, `SetUniversalGatewayPC`, `SetUniswapV3Addresses`, `SetDefaultFeeTier`, `SetMaxStalenessByChain`, `RescueNativePC` (admin-only events; not subscribed)
- Core #19, #20 — CEA storage layout (transparent — SDK reads via view fns)
- Core #21 — `onlyVault` modifier live lookup (transparent)
- Core #28 — `deployCEA` simplified (factory-only)
- Core #29-30, #36-37 — UEAFactory + CEAFactory function renames + role changes (admin-only)
- Core #42 — `UEAProxy.initializeUEA` zero-address check on `_logic` (initializer; SDK doesn't call)
- Core #43, #45-46, #48 — Internal PRC20/WPC hardening (transparent)
- Core #44 — `deposit` `CorePaused` revert (relevant only if SDK reads `Deposit` event; minor decoding consideration)
- Core #50 — `stringToExactUInt256` custom errors (StringUtils — SDK doesn't call directly)
- Gateway UG #2/#3 — Fee-on-transfer rejection at deposit/swap (rejects exotic tokens; SDK doesn't use them)
- Gateway UG #7 — `_checkBlockUSDCap` raw-wei accumulation (transparent)
- Gateway UG #8 — `_routeUniversalTx` post-fee TX_TYPE inference (edge-case test update only)
- Gateway UG #15 — `initialize` rejects half-configured Uniswap (initializer)
- Gateway UG #16 — `_validateRevertParams` rejects stray msg.value (rescue path; SDK rescue caller already passes correct values)
- Gateway UG #17, #18 — Visibility-prefix renames (`_checkUSDCaps` → `checkUSDCaps`, `swapToNative` → `_swapToNative`) — internal/visibility cleanup
- Gateway UG #19, #20, #21 — Code cleanup (dead else-if, comment changes, dead WETH branch)
- Gateway UG #22 — `TSS_ROLE` removed from UG (admin-only)
- Gateway UG #25 — `paused()` exposed in interface (used by Vault.migrateTokens; not by SDK)
- Gateway UG #26 — NatSpec correction
- Gateway UGPC #5 — `_fetchOutboundTxGasAndFees` delegates gasLimit resolution to UniversalCore (transparent — covered by tuple change)
- Gateway UGPC #7 — `setVaultPC` → `updateVaultPC` rename (admin)
- Gateway UGPC #9 — Unpause role change (admin)
- Vault #2-#8 — All Vault changes are admin/ops or transparent
- VaultPC #1-#5 — All VaultPC changes are admin/ops

---

## 14. Open Questions — RESOLVED via direct contract inspection

All 5 prior open questions verified against `origin/audit-main-fixes` of `push-chain-core-contracts` and `push-chain-gateway-contracts`.

### 14.1 — EIP-712 salt source ✅ CONFIRMED

**Source:** `core-contracts:src/uea/UEA_EVM.sol:89-97` and `src/uea/UEA_SVM.sol:94-104`.

```solidity
// UEA_EVM
function domainSeparator() public view returns (bytes32) {
    uint256 chainId = StringUtils.stringToExactUInt256(_universalAccountId.chainId);
    return keccak256(
        abi.encode(
            DOMAIN_SEPARATOR_TYPEHASH,
            keccak256(bytes(VERSION)),
            chainId,                       // ← SOURCE chain numeric ID (e.g. 1 for Ethereum mainnet)
            address(this),
            bytes32(block.chainid)         // ← SALT = Push Chain's chainid (where UEA proxy lives)
        )
    );
}
```

**Confirmed semantics from contract NatSpec (UEA_EVM.sol:53-62):**
- `chainId` = the **source** chain's numeric ID, derived from `UniversalAccountId.chainId`. Binds the signature to the origin chain identity. (Unchanged from before.)
- `salt` = `bytes32(block.chainid)` of **Push Chain at execution time**. Binds the signature to the specific Push Chain deployment and prevents cross-deployment replay across forks.

**SDK action (signing.ts):**
- The existing EVM `chainId` value (sourced from `CHAIN_INFO[ctx.universalSigner.account.chain].chainId`) — keep as-is. ✅ correct.
- The new `salt` field — populate with **Push Chain's numeric chainid**, NOT source. Source it from `CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId` (= "42101") for testnet, or via `ctx.pushNetwork` lookup. As `bytes32`: `padHex(toHex(BigInt(pushChainId)), { size: 32 })`.

**For SVM (`UEA_SVM.sol:94-104`):**
```solidity
return keccak256(
    abi.encode(
        DOMAIN_SEPARATOR_TYPEHASH_SVM,
        keccak256(bytes(VERSION)),
        keccak256(bytes(_universalAccountId.chainId)),   // ← chainId hashed (was raw before)
        address(this),
        bytes32(block.chainid)                            // ← same salt as EVM
    )
);
```

### 14.2 — `maxPCForGas` user-facing API ✅ INFORMED

**Source:** `gateway-contracts:contracts/evm-gateway/src/UniversalGatewayPC.sol:138-148` and `libraries/TypesUGPC.sol`.

**Confirmed struct field order (TypesUGPC.sol):**
```solidity
struct UniversalOutboundTxRequest {
    bytes   recipient;
    address token;
    uint256 amount;
    uint256 gasLimit;
    uint256 maxPCForGas;             // ← NEW field, between gasLimit and payload
    bytes   payload;
    address revertRecipient;
}
```

**Confirmed contract logic:**
```solidity
uint256 pcForSwap = msg.value - protocolFee;
if (req.maxPCForGas != 0) {
    if (req.maxPCForGas > pcForSwap) revert Errors.InvalidAmount();
    uint256 excess = pcForSwap - req.maxPCForGas;
    pcForSwap = req.maxPCForGas;
    if (excess > 0) {
        (bool refundOk,) = msg.sender.call{ value: excess }("");
        if (!refundOk) revert Errors.WithdrawFailed();
    }
}
_swapAndCollectFees(gasToken, pcForSwap, gasFee);
```

**Semantics:**
- `maxPCForGas == 0` → no cap (legacy behavior). All `msg.value − protocolFee` swapped for gas token.
- `maxPCForGas > 0` → cap the PC used for gas swap; refund excess back to caller (`msg.sender`).
- `maxPCForGas > pcForSwap` → reverts `InvalidAmount`.
- Use case: protects user against gas-token-vs-PC price slippage; without it, a price drop could spend the entire forwarded msg.value on the swap.

**SDK recommendation:**
- **Phase 1 (audit-cutover):** Default `maxPCForGas: 0n` in all SDK callers (preserves current behavior, prevents struct-layout breakage).
- **Phase 2 (current SDK branch):** Keep the runtime default at `0n`, expose `maxPCForGas?: bigint`, and provide opt-in helper APIs `quoteMaxPCForGasCap()` / `quoteMaxPCForGasCapFromNativeValue()` with a default 10% buffer. Revisit automatic defaults only after post-deploy e2e/telemetry confirms the cap does not create unexpected `InvalidAmount` or under-funded gas behavior.

### 14.3 — `gasLimitUsed` 6-tuple ordering ✅ CONFIRMED

**Source:** `core-contracts:src/Interfaces/IUniversalCore.sol:148-160` and `src/UniversalCore.sol:280-290`.

**Confirmed return order from `IUniversalCore.getOutboundTxGasAndFees`:**
```solidity
returns (
    address gasToken,        // index 0
    uint256 gasFee,          // index 1
    uint256 protocolFee,     // index 2
    uint256 gasPrice,        // index 3
    string  chainNamespace,  // index 4
    uint256 gasLimitUsed     // index 5  ← NEW (6th return value, last position)
);
```

> Note: UGPC's INTERNAL `_fetchOutboundTxGasAndFees` re-shuffles into a different 6-tuple `(gasToken, gasFee, gasLimitUsed, protocolFee, gasPrice, chainNamespace)` for its event emit. **This is contract-internal — irrelevant to the SDK.** The SDK calls `IUniversalCore` directly and gets the order above.

**SDK action (gas-calculator.ts:196):**
- Update tuple type to `[address, bigint, bigint, bigint, string, bigint]` matching `(gasToken, gasFee, protocolFee, gasPrice, chainNamespace, gasLimitUsed)`.
- `gasLimitUsed` is at index 5. SDK can ignore initially; surface it later for telemetry showing which gas-limit value the contract actually used (helps debug "I passed 0, got X back" cases).

### 14.4 — Funds-parking convention ✅ CONFIRMED

**Source:** `core-contracts:src/cea/CEA.sol:225-256`.

**Confirmed `_handleSingleCall` logic post-audit:**
```solidity
function _handleSingleCall(...) internal {
    // Funds-parking branch: BOTH conditions required
    if (payload.length == 0 && recipient == address(0)) {
        emit UniversalTxExecuted(subTxId, universalTxId, originCaller, address(this), payload);
        return;
    }
    
    if (recipient == address(0)) revert CEAErrors.InvalidRecipient();
    if (recipient == address(this)) revert CEAErrors.InvalidRecipient();
    
    (bool success, bytes memory returnData) = recipient.call{value: msg.value}(payload);
    // ... bubble revert reason ...
}
```

**Confirmed branches:**
- `payload.length == 0 && recipient == address(0)` → funds parked, event emitted, no execution. (THIS is the only intentional parking path.)
- `payload.length > 0 && recipient == address(0)` → reverts `InvalidRecipient`. (Catches bugs where SDK forgot to set recipient.)
- `payload.length == 0 && recipient != address(0) && recipient != address(this)` → calls `recipient.call{value: msg.value}("")`. May succeed for EOA receiver, fail for contracts that don't accept value. **This is the previously-silent path that's now active** — SDK must NOT emit this combination accidentally.
- `recipient == address(this)` → always reverts `InvalidRecipient` (CEA self-execution forbidden in this branch; use multicall self-call for that).

**SDK action:**
- Verified: SDK never builds `payload.length == 0` with non-zero recipient today. ✅ already safe.
- **Add explicit guard** in `payload-builders.ts` `buildSendUniversalTxToUEA` (or wherever the SDK assembles CEA single-call payloads): document that `recipient = address(0)` is mandatory for any zero-payload send.
- **Add a regression test** asserting any builder that produces empty payload also produces zero recipient.

### 14.5 — Migration / upgradeAccount — ⚠️ MAJOR FINDING

**Source:** `core-contracts:src/Interfaces/IUEA.sol`, `src/uea/UEA_EVM.sol:137-238`, commit `3ced59a "unifying migration+execution"`.

**Critical discovery — migration is UNIFIED into the standard executeUniversalTx flow.** The post-audit `IUEA` interface has only ONE execution entrypoint:

```solidity
interface IUEA {
    /// @dev Three execution modes: SINGLE, MULTICALL, or MIGRATION.
    function executeUniversalTx(UniversalPayload calldata payload, bytes calldata signature) external;
    // ...
}
```

There is **NO standalone `migrateUEA` function** on the post-audit UEA contract. Migration is dispatched inside `executeUniversalTx` via:

```solidity
function _handleExecution(UniversalPayload memory payload) internal {
    // ...
    if (_isMulticall(payload.data)) {
        (success, returnData) = _handleMulticall(payload);
    } else if (_isMigration(payload.data)) {            // ← selector dispatch
        (success, returnData) = _handleMigration(payload);
    } else {
        (success, returnData) = _handleSingleCall(payload);
    }
}

function _isMigration(bytes memory data) private pure returns (bool) {
    if (data.length < 4) return false;
    bytes4 selector;
    assembly { selector := mload(add(data, 32)) }
    return selector == MIGRATION_SELECTOR;  // bytes4(keccak256("UEA_MIGRATION"))
}

function _handleMigration(UniversalPayload memory payload) internal returns (bool, bytes memory) {
    if (payload.to != address(this)) revert UEAErrors.InvalidCall();   // must self-target
    if (payload.value != 0) revert UEAErrors.InvalidCall();
    address migrationContract = ueaFactory.UEA_MIGRATION_CONTRACT();
    if (migrationContract == address(0)) revert UEAErrors.InvalidCall();
    bytes memory migrateCallData = abi.encodeWithSignature("migrateUEAEVM()");
    return migrationContract.delegatecall(migrateCallData);
}
```

**Implications for the SDK's `upgradeAccount` flow (account-manager.ts:108-189):**

1. **`signMigrationPayload` and `MigrationPayload(address migration,uint256 nonce,uint256 deadline)` typehash are OBSOLETE.** The contract no longer verifies a separate `MigrationPayload` type — it only verifies `UniversalPayload` signatures.

2. **New required SDK flow for upgradeAccount:**
   - Build a `UniversalPayload`:
     - `to = ueaAddress` (UEA self-target)
     - `value = 0`
     - `data = MIGRATION_SELECTOR` (4 bytes = `bytes4(keccak256("UEA_MIGRATION"))` = `0x...`. Compute once: `keccak256(toBytes("UEA_MIGRATION")).slice(0, 10)`)
     - `gasLimit`, `maxFeePerGas`, `maxPriorityFeePerGas`, `nonce` (UEA nonce), `deadline`, `vType` populated normally
   - Sign via `signUniversalPayload` (with the new salt-included domain)
   - Submit via the standard execute path (likely `MsgExecuteUniversalTx`, NOT `MsgMigrateUEA`)

3. **Push-chain Cosmos module is OUT OF SYNC with the post-audit UEA contract.** Verified on 2026-05-11 after fetching origin: the local `push-chain` checkout is current on `cherry/release-pipeline-onto-audit-fixes` tracking `origin/audit-fixes` at `7d748bdf`, but `x/uexecutor/keeper/evm.go:194 CallUEAMigrateUEA` still invokes `migrateUEA` ABI function (line 221) on the UEA contract. That function does not exist on the post-audit UEA. The branch README says standalone `MsgMigrateUEA` was removed and migration now goes through normal payload execution, so this is a code/docs mismatch on the current branch rather than a stale-branch issue. The Cosmos module needs behavior confirmation before SDK `upgradeAccount()` ships end-to-end.

4. **MsgMigrateUEA proto type may be retired** — confirm with the Cosmos module team whether the message becomes a no-op wrapper around MsgExecuteUniversalTx, gets deleted entirely, or stays for backward-compat.

**SDK action priority:** This is now a 🔴 BLOCKER for the upgradeAccount flow. Add to punch list:
- Refactor `signMigrationPayload` → either delete and route through `signUniversalPayload`, or keep as a wrapper that builds the migration UniversalPayload.
- Refactor `account-manager.ts:upgradeAccount` to build/sign UniversalPayload with `MIGRATION_SELECTOR` data, and submit via execute path.
- Update tests `signing-payload.spec.ts:280-314` (currently test the dead `computeMigrationHash`).
- Block the upgradeAccount feature behind a feature flag until push-chain module is also upgraded.

**Bonus finding:** `MIGRATION_SELECTOR` constant value — compute via `bytes4(keccak256("UEA_MIGRATION"))`. From contract: `Types.sol:60-62`. SDK should hardcode this 4-byte value (or compute via `keccak256(toBytes('UEA_MIGRATION')).slice(0, 10)`) and use it as the entire `data` field for migration UniversalPayloads.

---

## 15. Updated Punch List — Migration Refactor

Adding these as P0 to the punch list (Section 11):

| # | Priority | File | Change | Est. effort |
|---|---|---|---|---|
| 17 | 🔴 P0 | `signing.ts:182-203, 244-264` | EVM `signTypedData` domain: add `salt: padHex(toHex(BigInt(PUSH_CHAIN_ID)), { size: 32 })`. Source PUSH_CHAIN_ID from `CHAIN_INFO[ctx.pushNetwork].chainId` — Push Chain's chainid, NOT source chain's. | 20 min |
| 18 | 🔴 P0 | `account-manager.ts:108-189` (`upgradeAccount`) | Refactor to build a UniversalPayload with `data = MIGRATION_SELECTOR` (4 bytes), `to = ueaAddress`, `value = 0`. Sign with `signUniversalPayload`. Submit via `MsgExecuteUniversalTx` — coordinate with Cosmos module team. **Contract no longer accepts the old MigrationPayload typehash.** | 4 hours + tests |
| 19 | 🔴 P0 | `signing.ts:117-162, 220-280` | Either DELETE `computeMigrationHash` and `signMigrationPayload`, or refactor as a thin wrapper that builds a UniversalPayload with MIGRATION_SELECTOR data and delegates to `signUniversalPayload`. | 1 hour |
| 20 | 🔴 P0 | Define `MIGRATION_SELECTOR` constant | `export const MIGRATION_SELECTOR = '0x' + keccak256(toBytes('UEA_MIGRATION')).slice(2, 10) as \`0x${string}\``. Place in `constants/`. | 5 min |
| 21 | 🔴 P0 | `signing-payload.spec.ts:280-314` | Update or remove tests for `computeMigrationHash` to match new flow. | 1 hour |
| 22 | 🟡 P1 | `gas-calculator.ts:196` | Optionally read `gasLimitUsed` (index 5) and surface to caller for telemetry. | 15 min |
| 23 | 🟡 P1 | `payload-builders.ts` (where SDK builds CEA single-call payloads) | Add explicit assertion that `recipient = address(0)` whenever `payload.length === 0`. Add unit test. | 30 min |
| 24 | 🟢 Done | `UniversalExecuteParams` types, `orchestrator/max-pc-for-gas.ts` | `maxPCForGas?: bigint` is exposed with `0n` default; helper APIs derive a 10% buffered cap from native PC gas quotes for callers that opt in. | Done |

---

## 16. Cross-Repo Coordination Required

| Repo | Required change | Owner |
|---|---|---|
| `push-chain-core-contracts` | Already on `audit-main-fixes`. SDK pulls from this. | Contracts team |
| `push-chain-gateway-contracts` | Already on `origin/audit-main-fixes`. NOTE: user's local checkout is BEHIND origin by 10 commits — `git pull origin audit-main-fixes` to sync. | Gateway team |
| `push-chain` (Cosmos module — latest checked branches) | Verified on 2026-05-11: local `cherry/release-pipeline-onto-audit-fixes` tracks `origin/audit-fixes` at `7d748bdf` and is current, but `x/uexecutor/keeper/evm.go:194 CallUEAMigrateUEA` still calls obsolete `migrateUEA` ABI fn (line 221). README says the standalone message path was removed, so code/docs disagree. **Decide:** keep `MsgMigrateUEA` proto as a wrapper around execute-payload or delete it entirely. | Push-chain Go team |
| `push-chain-sdk` (this repo) | All items in the punch list above. | SDK team (Shoaib) |

---

*End of document. Branch comparison: `audit-main` → `audit-main-fixes`. Generated 2026-05-06. Open questions resolved by direct contract inspection on 2026-05-06.*
