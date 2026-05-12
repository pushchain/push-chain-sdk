# Push Chain SDK — Changes Required for Contract Audit

**Coordinates with:** Contracts team (push-chain-core-contracts), Gateway team (push-chain-gateway-contracts — covers EVM Gateway + SVM Gateway), Cosmos module team (push-chain)
**Contract branches:** `audit-main` (pre) → `audit-main-fixes` (post)
**Date:** 2026-05-06
**Last checked:** 2026-05-12

---

## TL;DR

The audit fixes on `audit-main-fixes` introduce **10 hard blockers** for the SDK across three audit docs (Core, EVM Gateway, SVM Gateway):

- 7 EVM-side: signing salt, gas-tuple shape, outbound struct layout, UGPC `universalCore` accessor rename, migration flow, funds-parking guard, CEA migration self-target
- 1 cross-cutting: migration unification (replaces standalone `signMigrationPayload`)
- 1 SVM-side: `UniversalTxFinalized` event schema change (Borsh decode breakage in detector)
- 1 latent: SPL deposit canonical-ATA validation (only matters when SPL-from-Solana support lands)

Without these SDK updates, every UEA-signed tx, every Push-Chain-outbound tx, and every SVM-side universal-tx detection will fail against the new contracts.

The biggest surprise: **migration is no longer a separate signing surface** — it's now dispatched inside `executeUniversalTx` via a 4-byte selector. The current `signMigrationPayload` flow is obsolete and needs a full refactor. The latest checked `push-chain` branch is current, but its Go/proto implementation still exposes the legacy `MsgMigrateUEA -> migrateUEA` path while its README describes the new execute-payload design; treat this as a cross-repo implementation mismatch, not a stale-branch issue.

### Implementation status — 2026-05-12

Completed in the SDK branch:

- EIP-712 domain salt for EVM and SVM signing.
- UniversalCore 6-tuple ABI and `gasLimitUsed` propagation.
- UGPC `UniversalOutboundTxRequest.gasPrice` + `maxPCForGas` ABI/type/call-site propagation. `gasPrice` defaults to `0n` (UniversalCore default), and `maxPCForGas` is exposed as optional `ExecuteParams.maxPCForGas` with `0n` legacy default.
- UGPC `UNIVERSAL_CORE()` → `universalCore()` ABI/call-site rename.
- SVM Gateway IDL updates for `UniversalTxFinalized`, `Config`, `OperatorChanged`, `InsufficientGasBudget`, and `TssPda.authority` docs.
- CEA funds-parking invariant in SDK builders, redundant CEA pre-approvals removed, zero-amount SVM/CEA workarounds dropped where no longer needed.
- New typed ABI errors and updated detector event comments.
- Regression coverage for signing, outbound builders/cascade composition, gas sizing, universal-tx detector classification, and SVM `GasAndPayload` payload-only fixture.
- Phase 2 `maxPCForGas` helper API: `quoteMaxPCForGasCap()` and `quoteMaxPCForGasCapFromNativeValue()` derive a contract-safe cap with a default 10% buffer while preserving the runtime default of `0n` unless callers opt in.

Deferred:

- `upgradeAccount()` migration refactor. The SDK can build/sign the new universal-execution migration payload, but the end-to-end submission path is intentionally deferred until `push-chain` confirms whether `MsgMigrateUEA` becomes a wrapper around normal execute-payload behavior or is removed.
- Live e2e against post-audit contracts. Contracts are not deployed yet, so this branch is kept compile/unit-test ready and should be smoke-tested once deployment lands.

Verification in this branch:

- `yarn tsc -p packages/core/tsconfig.lib.json --noEmit` passes.
- `yarn tsc -p packages/core/tsconfig.spec.json --noEmit` passes.
- Focused audit regression suites for signing, builders/cascade, gas sizing, `maxPCForGas` helpers, outbound selector encoding, and universal-tx detector pass.
- `NX_DAEMON=false NX_ISOLATE_PLUGINS=false yarn nx build core` passes. Plain Nx still has an environment/config issue: daemon socket creation is denied in the sandbox, and `nx report` shows root `nx@20.8.0` with `@nx/*@20.1.4` plugins.
- Full `packages/core/src` Jest run passes all local suites except `universal/account/account.spec.ts`, which performs live Push RPC calls and fails in the sandbox with DNS resolution errors.

---

## 1. Hard Blockers (must ship in lockstep with new contracts)

Each item below will cause runtime failures if not addressed.

### 1.1. EIP-712 domain separator gains `bytes32 salt`

**Why it matters:** Every UEA signature the SDK produces today will be rejected by the new contracts.

**Contract change** (`UEA_EVM.sol:89`, `UEA_SVM.sol:94`):

- New typehash: `EIP712Domain(string version,uint256 chainId,address verifyingContract,bytes32 salt)`
- `salt = bytes32(block.chainid)` evaluated on Push Chain — i.e., **Push Chain's chainid** (NOT source chain's)
- For SVM additionally: `chainId` is now hashed with `keccak256(bytes(chainId))` per EIP-712 spec for dynamic types

**SDK files:**

- `packages/core/src/lib/orchestrator/internals/signing.ts`

**SDK action:**

```ts
// signing.ts:21 — buildDomainSeparator
function buildDomainSeparator(
  vm: VM,
  chainId: string,           // source chain's chainid (unchanged)
  version: string,
  verifyingContract: `0x${string}`,
  pushChainId: string,       // NEW — Push Chain's numeric chainid (e.g., "42101")
): `0x${string}` {
  const domainTypeHash = keccak256(
    toBytes(
      vm === VM.EVM
        ? 'EIP712Domain(string version,uint256 chainId,address verifyingContract,bytes32 salt)'
        : 'EIP712Domain_SVM(string version,string chainId,address verifyingContract,bytes32 salt)'
    )
  );

  return keccak256(
    encodeAbiParameters(
      [
        { name: 'typeHash',           type: 'bytes32' },
        { name: 'version',            type: 'bytes32' },
        { name: 'chainId',            type: vm === VM.EVM ? 'uint256' : 'bytes32' },
        { name: 'verifyingContract',  type: 'address' },
        { name: 'salt',               type: 'bytes32' },
      ],
      [
        domainTypeHash,
        keccak256(toBytes(version)),
        vm === VM.EVM
          ? BigInt(chainId)
          : keccak256(toBytes(chainId)),
        verifyingContract,
        padHex(toHex(BigInt(pushChainId)), { size: 32 }),
      ]
    )
  );
}
```

For the EVM viem `signTypedData` path (`signing.ts:182`), add `salt` to the domain:

```ts
return ctx.universalSigner.signTypedData({
  domain: {
    version: version || '0.1.0',
    chainId: Number(chainId),
    verifyingContract,
    salt: padHex(toHex(BigInt(pushChainId)), { size: 32 }),  // NEW
  },
  // ...
});
```

**Source for `pushChainId`:** `CHAIN_INFO[ctx.pushNetwork === 'mainnet' ? CHAIN.PUSH_MAINNET : CHAIN.PUSH_TESTNET_DONUT].chainId`. Currently `"42101"` for testnet.

---

### 1.2. `getOutboundTxGasAndFees` returns 6-tuple (added `gasLimitUsed`)

**Why it matters:** viem will throw a tuple-decode error against the new contract until the ABI is updated.

**Contract change** (`IUniversalCore.sol:148-160`):

```solidity
returns (
    address gasToken,
    uint256 gasFee,
    uint256 protocolFee,
    uint256 gasPrice,
    string  chainNamespace,
    uint256 gasLimitUsed     // NEW — 6th return value
);
```

**SDK files:**

- `packages/core/src/lib/constants/abi/prc20.evm.ts:14-20`
- `packages/core/src/lib/orchestrator/internals/gas-calculator.ts:196`

**SDK action:**

```ts
// prc20.evm.ts — add 6th output
{
  type: 'function',
  name: 'getOutboundTxGasAndFees',
  inputs: [
    { name: '_prc20',                type: 'address' },
    { name: 'gasLimitWithBaseLimit', type: 'uint256' },
  ],
  outputs: [
    { name: 'gasToken',       type: 'address' },
    { name: 'gasFee',         type: 'uint256' },
    { name: 'protocolFee',    type: 'uint256' },
    { name: 'gasPrice',       type: 'uint256' },
    { name: 'chainNamespace', type: 'string'  },
    { name: 'gasLimitUsed',   type: 'uint256' },  // NEW
  ],
  stateMutability: 'view',
}
```

```ts
// gas-calculator.ts:196 — widen tuple
const result = await ctx.pushClient.readContract<
  [`0x${string}`, bigint, bigint, bigint, string, bigint]   // was 5-tuple
>({
  address: universalCoreAddress,
  abi: UNIVERSAL_CORE_EVM,
  functionName: 'getOutboundTxGasAndFees',
  args: [prc20Token, gasLimit],
});
const [gasToken, gasFee, protocolFee, gasPrice, , gasLimitUsed] = result;
```

Also remove the dead `BASE_GAS_LIMIT` ABI entry at `prc20.evm.ts:25-30` (function deleted from contract).

---

### 1.3. `UniversalOutboundTxRequest` struct gains `gasPrice` and `maxPCForGas` fields

**Why it matters:** struct field order matters in ABI encoding, and the tuple arity changes the `sendUniversalTxOutbound` selector. The old 7-field request produces selector `0x2a494d31`; the current 8-field request on `audit-main-fixes` produces selector `0x77b86bec`. If the SDK omits `gasPrice`, the call hits the wrong selector and reverts before decoding.

**Contract change** (`TypesUGPC.sol`):

```solidity
struct UniversalOutboundTxRequest {
    bytes   recipient;
    address token;
    uint256 amount;
    uint256 gasLimit;
    uint256 gasPrice;        // NEW — between gasLimit and maxPCForGas
    uint256 maxPCForGas;     // NEW — between gasPrice and payload
    bytes   payload;
    address revertRecipient;
}
```

**Semantics:**

- `gasPrice == 0` → use UniversalCore's per-chain default gas price
- `gasPrice > 0` → override destination-chain gas price; must be at least the UniversalCore base gas price or UGPC reverts `GasPriceBelowBase`
- `maxPCForGas == 0` → no cap (legacy behavior; safe default)
- `maxPCForGas > 0` → caps PC used for gas swap; refunds excess to caller
- `maxPCForGas > (msg.value − protocolFee)` → reverts `InvalidAmount`

**SDK files:**

- `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts:42-48`
- `packages/core/src/lib/orchestrator/orchestrator.types.ts:548-565`
- All call sites that build the struct (`route-handlers.ts` `buildOutboundRequest`, `cascade.ts`)

**SDK action:**

```ts
// universalGatewayPC.evm.ts — insert gasPrice and maxPCForGas in the tuple
components: [
  { internalType: 'bytes',   name: 'recipient',       type: 'bytes'   },
  { internalType: 'address', name: 'token',           type: 'address' },
  { internalType: 'uint256', name: 'amount',          type: 'uint256' },
  { internalType: 'uint256', name: 'gasLimit',        type: 'uint256' },
  { internalType: 'uint256', name: 'gasPrice',        type: 'uint256' },  // NEW
  { internalType: 'uint256', name: 'maxPCForGas',     type: 'uint256' },  // NEW
  { internalType: 'bytes',   name: 'payload',         type: 'bytes'   },
  { internalType: 'address', name: 'revertRecipient', type: 'address' },
],
```

```ts
// orchestrator.types.ts:548 — UniversalOutboundTxRequest interface
export interface UniversalOutboundTxRequest {
  target:           `0x${string}`;
  token:            `0x${string}`;
  amount:           bigint;
  gasLimit:         bigint;
  gasPrice:         bigint;  // NEW — 0 = UniversalCore per-chain default
  maxPCForGas:      bigint;  // NEW — 0 = no cap on PC used for gas swap
  payload:          `0x${string}`;
  revertRecipient:  `0x${string}`;
}
```

Let `gasPrice` default to `0n` in every site that constructs this struct, and keep `maxPCForGas` defaulting to `0n` unless callers opt in (preserves legacy behavior). For API compatibility, `buildOutboundRequest` keeps `maxPCForGas` as its existing 7th argument and adds `gasPrice` as an optional 8th argument. Optional follow-up: expose `gasPrice` as an advanced override only if callers have a real use case; keep `maxPCForGas` user-controllable via `UniversalExecuteParams`.

Also add `GasPriceBelowBase()` to the UGPC ABI error list so override failures decode as typed errors.

---

### 1.4. Migration is unified into `executeUniversalTx` (MAJOR REFACTOR)

**Why it matters:** The post-audit `IUEA` interface has only ONE execution entrypoint. The standalone `migrateUEA` ABI function is **gone**. The SDK's current `signMigrationPayload` typehash `MigrationPayload(address migration, uint256 nonce, uint256 deadline)` does not exist on the new contract.

**Contract change** (`IUEA.sol`, `UEA_EVM.sol:137-238`, commit `3ced59a "unifying migration+execution"`):

```solidity
interface IUEA {
    /// @dev Three execution modes: SINGLE, MULTICALL, or MIGRATION.
    function executeUniversalTx(UniversalPayload calldata payload, bytes calldata signature) external;
}
```

Migration is dispatched via selector inside `_handleExecution`:

```solidity
if (_isMulticall(payload.data))      _handleMulticall(payload);
else if (_isMigration(payload.data)) _handleMigration(payload);  // ← NEW
else                                 _handleSingleCall(payload);
```

`MIGRATION_SELECTOR = bytes4(keccak256("UEA_MIGRATION"))`.

**`_handleMigration` requires:**

- `payload.to == address(this)` (UEA self-target)
- `payload.value == 0`
- The factory-configured migration contract must be set; UEA `delegatecall`s `migrateUEAEVM()` / `migrateUEASVM()` on it.

**SDK files:**

- `packages/core/src/lib/orchestrator/internals/account-manager.ts:108-189` (`upgradeAccount`)
- `packages/core/src/lib/orchestrator/internals/signing.ts:117-280` (`computeMigrationHash`, `signMigrationPayload`)
- `packages/core/src/lib/orchestrator/__tests__/signing-payload.spec.ts:280-314` (tests for the now-dead path)

**SDK action — refactor `upgradeAccount`:**

```ts
// constants/migration.ts — NEW
import { keccak256, toBytes } from 'viem';

/** bytes4(keccak256("UEA_MIGRATION")) */
export const MIGRATION_SELECTOR =
  keccak256(toBytes('UEA_MIGRATION')).slice(0, 10) as `0x${string}`;
```

```ts
// account-manager.ts — refactored upgradeAccount
import { MIGRATION_SELECTOR } from '../../constants/migration';

export async function upgradeAccount(
  ctx: OrchestratorContext,
  options?: { progressHook?: (p: ProgressEvent) => void }
): Promise<void> {
  // ... (existing pre-flight checks, accountStatus, etc.) ...

  const ueaAddress = computeUEAOffchain(ctx);
  const { nonce } = await getUeaStatusAndNonce(ctx);
  const ueaVersion = status.uea.version || '0.1.0';

  // Build a standard UniversalPayload with MIGRATION_SELECTOR data
  const universalPayload: UniversalPayload = {
    to:                    ueaAddress,         // UEA self-target
    value:                 '0',
    data:                  MIGRATION_SELECTOR, // 4 bytes only
    gasLimit:              '0',
    maxFeePerGas:          '0',
    maxPriorityFeePerGas:  '0',
    nonce:                 nonce.toString(),
    deadline:              '9999999999',
    vType:                 0,
  };

  // Sign with the standard signer (uses the new salt-included domain)
  const signatureBytes = await signUniversalPayload(
    ctx, universalPayload, ueaAddress, ueaVersion
  );

  // Submit via the standard execute path (NOT MsgMigrateUEA)
  // ... build MsgExecuteUniversalTx, broadcast ...
}
```

**Delete or repurpose:**

- `signing.ts:117-162` `computeMigrationHash` — DELETE (typehash no longer exists on contract)
- `signing.ts:220-280` `signMigrationPayload` — DELETE (replaced by direct `signUniversalPayload` call)
- `signing-payload.spec.ts:280-314` — DELETE the migration-payload test cases, replace with one that asserts `upgradeAccount` builds a UniversalPayload with `data === MIGRATION_SELECTOR`.

**Push-chain status check (2026-05-11):** The local `push-chain` checkout is current on `cherry/release-pipeline-onto-audit-fixes` tracking `origin/audit-fixes` at `7d748bdf`. The implementation still has `MsgMigrateUEA`, `CallUEAMigrateUEA`, and an ABI call to `"migrateUEA"`; the same legacy symbols are also present on `origin/cherry/release-pipeline-onto-audit-fixes`. Its README says the standalone path was removed, so code and docs disagree. The SDK can implement the new signing/building logic now, but `upgradeAccount()` cannot be considered end-to-end shippable until the Go module confirms the execute-payload path or provides a compatible wrapper.

**Coordination:** This refactor depends on the push-chain Cosmos module behavior being finalized too — see Section 5.

---

### 1.5. CEA `_handleSingleCall` funds-parking guard tightened

**Why it matters:** Previously, `payload.length == 0` was the only condition for funds-parking. Now `recipient == address(0)` is also required. If SDK ever emits payload-only-with-non-zero-recipient, the contract will attempt `recipient.call{value}("")` which can fail or worse.

**Contract change** (`CEA.sol:225-256`):

```solidity
function _handleSingleCall(...) internal {
    if (payload.length == 0 && recipient == address(0)) {
        // funds parked; emit event and return
    }
    if (recipient == address(0))      revert CEAErrors.InvalidRecipient();
    if (recipient == address(this))   revert CEAErrors.InvalidRecipient();
    
    (bool success, bytes memory returnData) = recipient.call{value: msg.value}(payload);
    // bubble revert reason ...
}
```

**SDK files:**

- `packages/core/src/lib/orchestrator/payload-builders.ts`

**SDK action:**

- Verified: SDK never builds `payload.length == 0` with non-zero recipient today. Already safe.
- Add explicit invariant in `payload-builders.ts` (assertion or comment) when constructing payloads: `payload.length === 0 ⇒ recipient === ZERO_ADDRESS`.
- Add a regression test asserting the invariant.

---

### 1.6. CEA `_handleMigration` requires `recipient == address(this)`

**Why it matters:** If SDK ever builds a CEA-side migration call with the wrong recipient, the new contract reverts.

**Contract change** (`CEA.sol:261`): migration multicall items must self-target.

**SDK files:**

- Any CEA migration multicall builder (likely in upgradeAccount flow, ties to Section 1.4)

**SDK action:** When constructing CEA-side migration multicalls, set `recipient = ceaAddress`. Verify in `upgradeAccount` refactor.

---

### 1.7. SVM Gateway `UniversalTxFinalized` event schema change (Borsh decode breakage)

**Why it matters:** The SDK's SVM detector uses Anchor's `BorshEventCoder` against the V0 IDL. Borsh deserialization is strict — when the on-chain event emits more bytes than the IDL declares, decoding throws. After the audit, every Solana finalize event will fail to decode in the detector, breaking SVM-source universal-tx detection.

**Contract change** (SVM Gateway audit, state.rs / lib.rs / instructions/execute.rs):

```rust
// BEFORE (matches current SDK IDL)
pub struct UniversalTxFinalized {
    pub sub_tx_id:        [u8; 32],
    pub universal_tx_id:  [u8; 32],
    pub gas_fee:          u64,
    pub push_account:     [u8; 20],
    pub target:           Pubkey,
    pub token:            Pubkey,
    pub amount:           u64,
    pub payload:          Vec<u8>,
}

// AFTER (post-audit)
pub struct UniversalTxFinalized {
    pub sub_tx_id:        [u8; 32],
    pub universal_tx_id:  [u8; 32],
    pub gas_fee:          u64,    // semantics: signed gas budget (was: full reimbursement)
    pub gas_used:         u64,    // NEW — actual relayer reimbursement (lamports)
    pub gas_to_refund:    u64,    // NEW — unused gas returned to user on Push Chain
    pub ata_created:      bool,   // NEW — whether CEA ATA was created in this finalize
    pub push_account:     [u8; 20],
    pub target:           Pubkey,
    pub token:            Pubkey,
    pub amount:           u64,
    pub payload:          Vec<u8>,
}
```

The audit also adds a brand-new event `OperatorChanged { old_operator: Pubkey, new_operator: Pubkey }` and a new error code `InsufficientGasBudget`.

**SDK files:**

- `packages/core/src/lib/constants/abi/universalGatewayV0.json` — IDL consumed by `BorshEventCoder` in `detector-svm.ts:122` and by `gateway-client.ts` for SOL `sendUniversalTx`
- `packages/core/src/lib/universal-tx-detector/svm-events.ts:22` — discriminator → event-name map (no change required for `UniversalTxFinalized` since the discriminator is unchanged, but worth adding `OperatorChanged` if observability is desired)

**SDK action:**

1. Update `universalGatewayV0.json` (or create a new `universalGatewayV1.json` and migrate all references) so the `UniversalTxFinalized` event type adds the three new fields **in the exact position shown above** (between `gas_fee` and `push_account`):

   ```json
   {
     "name": "UniversalTxFinalized",
     "type": {
       "kind": "struct",
       "fields": [
         { "name": "sub_tx_id",       "type": { "array": ["u8", 32] } },
         { "name": "universal_tx_id", "type": { "array": ["u8", 32] } },
         { "name": "gas_fee",         "type": "u64" },
         { "name": "gas_used",        "type": "u64" },
         { "name": "gas_to_refund",   "type": "u64" },
         { "name": "ata_created",     "type": "bool" },
         { "name": "push_account",    "type": { "array": ["u8", 20] } },
         { "name": "target",          "type": "pubkey" },
         { "name": "token",           "type": "pubkey" },
         { "name": "amount",          "type": "u64" },
         { "name": "payload",         "type": "bytes" }
       ]
     }
   }
   ```

2. SDK code consuming the event (currently only the `payload → data` alias in `svm-events.ts:59`) requires no change — the new fields are simply ignored downstream. But the IDL update is mandatory for Borsh to consume all on-chain bytes.

3. Optional but recommended:
   - Add new event `OperatorChanged` to the IDL `events` array (with its discriminator) so future operator-rotation observability works.
   - Add new error `InsufficientGasBudget` (code 6029 likely — confirm with audit-main-fixes IDL) to error decoder.

> Note: PDA seeds, program address, and instruction discriminators are unchanged. The IDL update affects type schemas only.

---

### 1.8. SVM Gateway SPL deposit canonical-ATA validation (latent — only when SPL-from-SOL ships)

**Why it matters:** Today the SDK only supports native SOL outbound from Solana (`gateway-client.ts:198-219` passes `userTokenAccount: vaultPda` and `gatewayTokenAccount: vaultPda` as placeholders for the optional SPL accounts). Post-audit, when SPL token bridging is enabled, the contract **strictly requires the canonical vault ATA** as the gateway token account and rejects any other vault-owned token account.

**Contract change** (SVM Gateway audit, instructions/deposit.rs `deposit_spl_to_vault`):

```rust
let expected_gateway_ata = spl_associated_token_account::get_associated_token_address(
    &ctx.accounts.vault.key(),
    &token,
);
require!(
    gateway_token_account.key() == expected_gateway_ata,
    GatewayError::InvalidAccount
);
```

The same canonicalization is enforced on `finalize_universal_tx`, `revert_universal_tx`, and `rescue_funds` — but those are TSS-side code paths the SDK doesn't construct.

**SDK files:**

- `packages/core/src/lib/orchestrator/internals/gateway-client.ts:198-219` — currently constructs SVM `sendUniversalTx` accounts

**SDK action:**

- **Today (no change required)**: SDK only sends native SOL; `token == Pubkey::default()` skips the SPL branch. Verified safe.
- **When SPL-from-SOL is added**: derive `gatewayTokenAccount` via `getAssociatedTokenAddress(mint, vaultPda, true)` from `@solana/spl-token`, and `userTokenAccount` from `getAssociatedTokenAddress(mint, userPk)`. Stop passing `vaultPda` as a placeholder for these optional accounts on SPL routes.

This is a **latent** change — flag it in the SPL-from-Solana epic, but no immediate work required.

---

### 1.9. UGPC accessor renamed `UNIVERSAL_CORE()` → `universalCore()`

**Why it matters:** The SDK performs live `readContract` calls against the UGPC accessor to resolve `UniversalCore`. Against the post-audit contract, calls to the old `UNIVERSAL_CORE` function name will fail.

**SDK files:**

- `packages/core/src/lib/constants/abi/universalGatewayPC.evm.ts:61`
- `packages/core/src/lib/orchestrator/internals/gas-calculator.ts`
- `packages/core/src/lib/orchestrator/internals/pc-usd-oracle.ts`
- `packages/core/src/lib/orchestrator/internals/cascade.ts`

**SDK action:** Rename ABI entry and all `readContract` call sites from `UNIVERSAL_CORE` to `universalCore`.

---

## 2. Recommended Non-Breaking Changes

Ship these alongside the blockers for cleaner code and better DX. None of these break runtime — but they pay down debt, improve telemetry, or save gas.

### 2.1. Remove redundant `approve` calls in CEA multicalls

**Why:** The CEA's `sendUniversalTxToUEA` now does `approve(gateway, amount)` before + `approve(gateway, 0)` after the gateway call internally (Core audit #22). The SDK's pre-call approves are redundant and waste ~46K gas per ERC-20 outbound.

**SDK files & lines:**

- `cascade.ts:1045-1065` — cascade-merge R3 path
- `route-handlers.ts:1166-1190` — single R3 hop
- `route-handlers.ts:2013-2033` — nested R3 hop builder

**Action:** Delete the `[approve(gateway, 0), approve(gateway, amount)]` items from the constructed `ceaMulticalls` array. Update tests in `payload-builders.spec.ts` and cascade fixtures that assert multicall length/contents.

### 2.2. Add typed errors for new contract reverts

**Why:** Surfaces typed errors instead of opaque `0x…` reverts.

**Add to ABI errors[] (or central decoder):**

```
Core / UEA / PRC20:
  CorePaused()
  ZeroBaseGasLimit()
  StaleGasData(uint256 observedAt, uint256 nowTs, uint256 maxAge)
  PRC20OperationFailed()
  NonceMismatch(uint256 expected, uint256 provided)
  UEAAlreadyRegistered()
  WPCErrors.InsufficientBalance(), .InsufficientAllowance(), .TransferFailed()
  StringUtilsErrors.EmptyString(), .NonDigitCharacter()

Gateway:
  GatewayNotPaused()                           // Vault.migrateTokens
  EmptyTokenList()                             // Vault.migrateTokens
  TokenTransferFailed(address token, uint256)  // UGPC._burnPRC20
```

### 2.3. Drop `1 wei` workarounds (where applicable)

**Why:** Core audit #22 also removes the `amount == 0` revert in CEA's `sendUniversalTxToUEA`, complementing the prior UGPC fix.

**SDK files & lines:**

- `route-handlers.ts:1584` — `executeCeaToPushSvm`
- `route-handlers.ts:1845` — R3 hop
- `route-handlers.ts:1972` — nested R3 hop

**Action:** Per-site, verify which contract path the burnAmount=1 was guarding against. For paths that route through the new sendUniversalTxToUEA, drop the workaround.

### 2.4. Update event source comments

**Why:** Documentation hygiene.

**SDK file:** `packages/core/src/lib/universal-tx-detector/events.ts:5-10`

**Action:** `UniversalTxExecuted` is no longer in `IUniversalGateway.sol` (removed by Gateway audit #27). It's still emitted by **CEA** — update the source comment to point to `ICEA.sol`.

### 2.5. Update doc comment for outbound struct

**SDK file:** `packages/core/src/lib/orchestrator/orchestrator.types.ts:559`

**Action:** Change `"0 = default BASE_GAS_LIMIT"` → `"0 = per-chain default (resolved by UniversalCore)"`. The contract no longer exposes `BASE_GAS_LIMIT()`.

### 2.6. SVM TxType classification for payload-only self-calls

**Why:** SVM Gateway audit unifies CEA `send_universal_tx_to_uea` semantics — payload-only self-calls (`withdraw_amount == 0` with non-empty payload) now emit `TxType::GasAndPayload` instead of misleading `TxType::Funds` / `TxType::FundsAndPayload`. The classifier in `universal-tx-detector` reads `txType` from the `UniversalTx` event.

**SDK files:**

- `packages/core/src/lib/universal-tx-detector/classify.ts` — `txType` enum-variant interpretation
- `packages/core/src/lib/universal-tx-detector/svm-events.ts` — already maps `tx_type → txType`

**Action/status:** Implemented. The classifier is variant-agnostic, and the scenario catalogue now includes an SVM CEA payload-only self-call fixture with `txType == GasAndPayload` (variant index 1).

### 2.7. SVM `Config` struct extension (read-only)

**Why:** SVM Gateway audit extends `Config` (repurposes `tss_address` as `operator`, adds `pending_admin`, `pending_pauser`, `pyth_max_age_seconds`). The slot was unused on-chain, so deserializing the new layout against the old IDL would fail.

**SDK files:**

- `packages/core/src/lib/constants/abi/universalGatewayV0.json` — `Config` type definition

**Action:** Update the `Config` type in the IDL to match the post-audit layout:

```json
{
  "name": "Config",
  "type": {
    "kind": "struct",
    "fields": [
      { "name": "admin",                       "type": "pubkey" },
      { "name": "operator",                    "type": "pubkey" },
      { "name": "pauser",                      "type": "pubkey" },
      { "name": "min_cap_universal_tx_usd",    "type": "u128" },
      { "name": "max_cap_universal_tx_usd",    "type": "u128" },
      { "name": "paused",                      "type": "bool" },
      { "name": "bump",                        "type": "u8" },
      { "name": "vault_bump",                  "type": "u8" },
      { "name": "pyth_price_feed",             "type": "pubkey" },
      { "name": "pyth_confidence_threshold",   "type": "u64" },
      { "name": "pending_admin",               "type": "pubkey" },
      { "name": "pending_pauser",              "type": "pubkey" },
      { "name": "pyth_max_age_seconds",        "type": "u64" }
    ]
  }
}
```

SDK does not currently read `Config` directly, but this keeps the IDL coherent and prevents future surprises. (Note: the field renamed from `tss_address` to `operator` reuses the same byte-position in the account layout — pre-upgrade configs need no migration.)

### 2.8. SVM `TssPda.authority` is now legacy

**Why:** SVM Gateway audit clarifies that the `authority: Pubkey` field on the TssPda is zero-initialized post-upgrade and no longer drives authorization (replaced by `config.operator` for `update_tss`). The field stays in the layout for compatibility.

**SDK files:**

- `packages/core/src/lib/constants/abi/universalGatewayV0.json` — `TssPda` doc string

**Action:** Update the IDL doc comment on `TssPda.authority` from `"set at init_tss but no longer used for authorization"` to `"zero-initialized; legacy field — no longer reflects active authorization"`. Pure documentation, no behavioral change for SDK readers.

---

## 3. Verified Non-Impact (audit items that touch no SDK code)

We checked but no SDK changes are needed for:

- All access-control redesigns (admin-only)
- `_handleMulticall` revert bubbling (viem auto-decodes; just update tests pinned to `ExecutionFailed`)
- `getOriginForUEA` `pushChainId` configurability (function signature unchanged; SDK reads value at runtime)
- All UVCore/UEAFactory/UGPC admin setter renames (`set`* → `update*`) — none in SDK ABIs
- All UG state variable camelCase renames — SDK doesn't read them
- Vault.migrateTokens, FeesWithdrawn signature change, TSS_ADDRESS removal — admin/ops only
- WPC totalSupply semantic change — SDK doesn't read it
- PRC20 transferFrom CEI ordering, deposit CorePaused — internal hardening
- New events `UniswapV3ConfigUpdated`, `TokensMigrated`, `UniversalCoreUpdated` — not subscribed
- Token-overload `sendUniversalTx` rejecting non-zero `msg.value` — verified SDK already passes 0

**SVM Gateway-specific (verified non-impact):**

- `initialize` signature change `tss → operator` — admin-only, SDK never calls
- `set_authorities` removed → `propose_authorities` + `accept_admin` + `accept_pauser` two-step flow — admin-only
- New admin instructions `set_operator`, `set_pyth_max_age_seconds` — admin-only
- `pause` / `unpause` account-context split (unpause now operator-signed) — admin-only
- `update_tss` authority moved admin → operator — admin-only
- `init_tss` no longer writes legacy `authority` field — admin-only
- `set_token_rate_limit` adds `trusted_mint_authority` / `trusted_freeze_authority` args — admin-only
- inbound-fee setter/fee-cap changes — admin-only
- `revert_universal_tx` now binds `revert_msg_hash` into TSS message — TSS-side only, SDK doesn't sign these
- `RescueFunds` / `RevertUniversalTx` SPL vault account constraints tightened to canonical ATA — TSS-side only
- `send_tx_with_funds_route` / `send_tx_with_gas_route` internal validation tightening — payload-shape rules now derived from route, no SDK-visible difference for valid requests
- `send_universal_tx_to_uea` payload-only allowance (CEA-side change) — internal CEA helper, not invoked by SDK directly
- New event `OperatorChanged` — not consumed by SDK detector classifier (unknown discriminator gets skipped by `discriminatorHex` lookup)
- Canonical generated SVM IDL is still pending from Gateway. Current SDK send/detector runtime paths were checked, but the checked-in JSON still has stale admin/inbound-fee/TSS PDA metadata (`protocol_fee` names, `tsspda_v2` seed, admin instruction shapes). Do not hand-edit discriminators; replace with the canonical generated artifact when available.

(Full mapping in companion doc `docs/audit-2026-05/sdk-audit-deep-dive.md` Section 13.)

---

## 4. Punch List


| #   | Severity | File                                                                   | Change                                                                                                                                                              |
| --- | -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 🔴 P0    | `signing.ts:21-51`                                                     | Add `salt` (5th param, bytes32) to `buildDomainSeparator`. SVM: hash `chainId` with keccak256.                                                                      |
| 2   | 🔴 P0    | `signing.ts:182-203`                                                   | EVM `signTypedData`: add `salt` to domain object                                                                                                                    |
| 3   | 🔴 P0    | `prc20.evm.ts:14-20`                                                   | Add 6th output `gasLimitUsed` to `getOutboundTxGasAndFees`. Delete dead `BASE_GAS_LIMIT` entry at lines 25-30.                                                      |
| 4   | 🔴 P0    | `gas-calculator.ts:196`                                                | Widen tuple type to 6 elements                                                                                                                                      |
| 5   | 🔴 P0    | `universalGatewayPC.evm.ts:42-49`                                      | Insert `gasPrice: uint256` and `maxPCForGas: uint256` between `gasLimit` and `payload`                                                                               |
| 6   | 🔴 P0    | `orchestrator.types.ts:548-566`                                        | Add `gasPrice: bigint` and `maxPCForGas: bigint` fields to `UniversalOutboundTxRequest`                                                                              |
| 7   | 🔴 P0    | `route-handlers.ts`, `cascade.ts` (all `buildOutboundRequest` callers) | Preserve existing `maxPCForGas` argument; let optional `gasPrice` default to `0n`                                                                                     |
| 8   | 🔴 P0    | `constants/migration.ts` (NEW)                                         | Define `MIGRATION_SELECTOR = bytes4(keccak256("UEA_MIGRATION"))`                                                                                                    |
| 9   | 🔴 P0    | `account-manager.ts:108-189`                                           | Refactor `upgradeAccount` to build a UniversalPayload with `data = MIGRATION_SELECTOR`, `to = ueaAddress`, sign via `signUniversalPayload`, submit via execute path |
| 10  | 🔴 P0    | `signing.ts:117-162, 220-280`                                          | Delete `computeMigrationHash` and `signMigrationPayload` (or repurpose as thin wrapper)                                                                             |
| 11  | 🔴 P0    | `signing-payload.spec.ts:280-314`                                      | Delete migration-typehash tests; add `upgradeAccount` builds UniversalPayload with MIGRATION_SELECTOR                                                               |
| 12  | 🔴 P0    | CEA migration multicall builder (in upgradeAccount path)               | Set `recipient = ceaAddress` for CEA-side migrations (folded into #9)                                                                                               |
| 13  | 🟡 P1    | `cascade.ts:1045-1065`                                                 | Remove redundant `[approve(0), approve(amount)]` pre-calls before `sendUniversalTxToUEA`                                                                            |
| 14  | 🟡 P1    | `route-handlers.ts:1166-1190`                                          | Same removal                                                                                                                                                        |
| 15  | 🟡 P1    | `route-handlers.ts:2013-2033`                                          | Same removal                                                                                                                                                        |
| 16  | 🟢 Done  | `prc20.evm.ts`                                                         | Added UniversalCore/Common custom errors for typed decoding, including quote-path `ZeroGasPrice()` and `ZeroAddress()`.                                             |
| 17  | 🔴 P0    | `universalGatewayPC.evm.ts:61`; callers in `gas-calculator.ts`, `pc-usd-oracle.ts`, `cascade.ts` | Rename ABI entry and `readContract` calls from `UNIVERSAL_CORE` → `universalCore`                                                                                   |
| 18  | 🟡 P1    | `events.ts:5-10`                                                       | Update source comment: `UniversalTxExecuted → ICEA.sol`                                                                                                             |
| 19  | 🟡 P1    | `payload-builders.ts`                                                  | Add invariant + test: `payload.length === 0 ⇒ recipient === ZERO_ADDRESS`                                                                                           |
| 20  | 🟡 P2    | `route-handlers.ts:1584, 1845, 1972`                                   | Drop `burnAmount = BigInt(1)` workarounds for paths now flowing through unified sendUniversalTxToUEA                                                                |
| 21  | 🟡 P2    | `orchestrator.types.ts:559`                                            | Update doc comment: drop "BASE_GAS_LIMIT" reference                                                                                                                 |
| 22  | 🟢 Done  | `UniversalExecuteParams` types, `orchestrator/max-pc-for-gas.ts`       | `maxPCForGas?: bigint` exposed with `0n` runtime default; opt-in helper API derives a 10% buffered cap from native PC gas quotes.                                     |
| 23  | 🟡 P2    | `gas-calculator.ts`                                                    | Surface `gasLimitUsed` in telemetry                                                                                                                                 |
| 24  | 🔴 P0    | `constants/abi/universalGatewayV0.json`                                | Add `gas_used: u64`, `gas_to_refund: u64`, `ata_created: bool` to `UniversalTxFinalized` event type (between `gas_fee` and `push_account`). Without this BorshEventCoder throws on every SVM finalize. |
| 25  | 🟡 P1    | `constants/abi/universalGatewayV0.json`                                | Update `Config` type: rename `tss_address` → `operator`; append `pending_admin: pubkey`, `pending_pauser: pubkey`, `pyth_max_age_seconds: u64`                       |
| 26  | 🟡 P1    | `constants/abi/universalGatewayV0.json`                                | Add new event `OperatorChanged { old_operator: pubkey, new_operator: pubkey }` and new error `InsufficientGasBudget`                                                |
| 27  | 🟡 P1    | `constants/abi/universalGatewayV0.json`                                | Update `TssPda.authority` doc string to "zero-initialized; legacy field"                                                                                            |
| 28  | 🟡 P2    | `universal-tx-detector` scenario fixtures                              | Done: SVM CEA payload-only self-call fixture now asserts `TxType::GasAndPayload` (variant index 1) instead of `Funds`/`FundsAndPayload`                              |
| 29  | 🟢 latent | `gateway-client.ts:198-219`                                            | When SPL-from-Solana support is added: derive canonical vault ATA via `getAssociatedTokenAddress(mint, vaultPda, true)` instead of passing `vaultPda` placeholder. Not blocking — SDK currently only sends native SOL. |

---

## 5. Cross-Repo Coordination Required


| Repo                           | Required change                                                                                                                                                                                                                                                                                                              | Blocks SDK?                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `push-chain-core-contracts`    | On `audit-main-fixes`. Ready.                                                                                                                                                                                                                                                                                                | No — already done.                                             |
| `push-chain-gateway-contracts` (EVM Gateway) | On `audit-main-fixes` at `d696777` / `origin/audit-main-fixes`, including `abd0ee0` (`upgc gasPrice fix`). `UniversalOutboundTxRequest` now has `gasPrice` between `gasLimit` and `maxPCForGas`.                                                                                                      | No — SDK ABI/types/call sites updated.                         |
| `push-chain-gateway-contracts` (SVM Gateway) | Same repo, post-audit source checked. Runtime SDK send/detector paths are compatible, but the SDK-local IDL still needs replacement with the canonical generated artifact to capture admin instruction, inbound-fee event, and TSS PDA seed metadata exactly. | No for current SDK send/detector paths; yes for full IDL/API parity. |
| `push-chain` (Cosmos module — latest checked branch) | Verified on 2026-05-11: local `cherry/release-pipeline-onto-audit-fixes` tracks `origin/audit-fixes` at `7d748bdf` and is current, but `x/uexecutor/keeper/evm.go:194 CallUEAMigrateUEA` still calls obsolete `migrateUEA` ABI fn at line 221. The README says this standalone path was removed, so code/docs disagree. Must confirm whether `MsgMigrateUEA` becomes a wrapper around `MsgExecutePayload` or is deleted entirely. | **YES for `upgradeAccount()` only** — other SDK signing/ABI/IDL changes can proceed. |


---

## 6. Test Plan


| Area                                    | Test work                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EIP-712 (EVM + SVM)                     | Verify signatures verify against new `bytes32 salt` domain. Files: `signing-payload.spec.ts`, `push-chain.signing.spec.ts`. Add new fixtures using post-audit typehash. |
| `getOutboundTxGasAndFees`               | Confirm 6-tuple decode works; SDK ignores 6th value safely.                                                                                                             |
| `UniversalOutboundTxRequest`            | Verify new `gasPrice` + `maxPCForGas` fields encode the 8-field selector `0x77b86bec` with defaults set to `0n`. Add test for non-zero cap with refund path.              |
| `sendUniversalTxToUEA`                  | New tests: zero-amount payload-only sends now succeed; ERC-20 lifecycle (no SDK pre-approves needed).                                                                   |
| `_handleMulticall` revert bubbling      | Update tests pinned to `ExecutionFailed`; assert bubbled revert reasons.                                                                                                |
| `_handleSingleCall` funds-parking guard | Add test: payload-only with non-zero recipient is rejected SDK-side (or by contract).                                                                                   |
| `upgradeAccount` (NEW)                  | E2E test: builds UniversalPayload with MIGRATION_SELECTOR data, signs with new domain, submits via execute path. Coordinate with Cosmos module test environment.        |
| Token-overload `sendUniversalTx`        | Regression: assert no `msg.value` in `execute-funds-payload.ts:268` token-gas path.                                                                                     |
| SVM `UniversalTxFinalized` decode       | Update IDL fixtures with extended event payload (3 new fields). Verify `BorshEventCoder` decodes successfully end-to-end and that detector still extracts `payload → data` alias correctly. |
| SVM CEA payload-only self-calls         | Detector classifier fixture: assert that an event with `txType == GasAndPayload` (variant index 1) coming from a CEA self-call is correctly classified as a payload-only outbound (not a funds movement). |
| SVM SPL deposit (future)                | Track for SPL-from-Solana epic: integration test using canonical vault ATA derivation; assert non-canonical token accounts get rejected. |


---

## 7. Open Decision

**`maxPCForGas` user-facing API.** Should the SDK auto-compute a default cap (e.g., `gasFee × 1.10`) using the existing gas-sizer's quote, or always default to `0n` (no cap)?

- **Current SDK branch decision:** keep the runtime default at `0n` and provide opt-in helpers (`quoteMaxPCForGasCap`, `quoteMaxPCForGasCapFromNativeValue`). Revisit an automatic default only after post-deploy telemetry/e2e confirms no unexpected `InvalidAmount` or under-funded gas behavior.
- **Auto-cap:** safer for users (slippage protection out-of-the-box), but adds complexity and may produce surprising "InvalidAmount" reverts in volatile gas markets.
- **No cap (0n):** preserves exact legacy behavior, requires no user education, leaves protection opt-in.

**Recommendation:** Ship with `0n` default in Phase 1 (audit cutover). Revisit auto-cap in Phase 2 once we have telemetry on real-world gas-fee variance.

---

## 8. Reference

Companion deep-dive document with full audit-item-by-item analysis (no-impact items, struct-field-order proofs, contract source quotes) is at `docs/audit-2026-05/sdk-audit-deep-dive.md`.
