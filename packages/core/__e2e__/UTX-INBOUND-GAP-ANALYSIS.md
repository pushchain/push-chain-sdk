# UTX Inbound Test Gap Analysis

**Date**: 2026-03-31
**Reference**: [push-chain-examples/send-universal-transaction-all-cases](https://github.com/pushchain/push-chain-examples/tree/main/core-sdk-functions/send-universal-transaction-all-cases)

---

## 1. UTX Parameter Definitions

| Param | SDK Field | Description |
|-------|-----------|-------------|
| **Value** | `value: bigint` | Native Push Chain token (PC) in wei |
| **Funds** | `funds: { amount, token }` where `mechanism === 'erc20'` | ERC-20 token bridged via gateway (e.g., USDT) |
| **Native Funds** | `funds: { amount, token }` where `mechanism === 'native'` | Native chain token bridged via gateway (ETH, BNB, SOL) |
| **Data** | `data: '0x...'` | Single contract calldata payload |
| **Multicall** | `data: MultiCall[]` (array of `{to, value, data}`) | Batch execution array |
| **To Self** | `to: pushClient.universal.account` | Recipient is sender's own UEA |
| **To Others** | `to: DIFFERENT_ADDRESS` | External EOA recipient |
| **To Contract** | `to: COUNTER_ADDRESS_PAYABLE` | Smart contract recipient |

---

## 2. Inbound Routes

| Route | Direction | Test File |
|-------|-----------|-----------|
| **Route 1 EVM** | UEA -> Push Chain (from EVM) | `evm/inbound/uea-to-push.spec.ts` |
| **Route 1 SVM** | UEA -> Push Chain (from Solana) | `svm/inbound/uea-to-push.spec.ts` |
| **Route 3 EVM (CEA->UEA)** | CEA -> Push Chain UEA | `evm/outbound/cea-to-uea.spec.ts` |
| **Route 3 EVM (CEA->EOA)** | CEA -> Push Chain EOA | `evm/outbound/cea-to-eoa.spec.ts` |
| **Route 3 EVM (CEA->Contract)** | CEA -> Push Chain Contract | `evm/outbound/cea-to-smart-contracts.spec.ts` |
| **Route 3 SVM** | CEA -> Push Chain (from Solana) | `svm/outbound/svm-outbound.spec.ts` (sections 10-11) |

---

## 3. Master Coverage Matrix

### Legend

| Symbol | Meaning |
|--------|---------|
| COVERED | Test exists and covers this scenario |
| GAP | No test exists -- needs to be written |
| PARTIAL | Covered via different route/mechanism but not the specific path |
| SKIPPED | Intentionally invalid ("Can't execute data on your own UEA") |
| UNSUPPORTED | Bridging not applicable on Push Chain |
| N/A | Not applicable for this route |

---

### 3.1 Route 1 EVM Inbound (`evm/inbound/uea-to-push.spec.ts`)

| UTX | Scenario | Existing UEA | New UEA (Fresh) | Existing Test | Gap Details |
|-----|----------|:------------:|:---------------:|---------------|-------------|
| UTX-01 | Value to self | **GAP** | **GAP** | -- | Transfer tests send to `TEST_TARGET_ADDRESS` (0x35B8...), never to own UEA. Fresh wallet "Native to Self" includes native funds bridge, not pure value. |
| UTX-02 | Value to others | COVERED | COVERED | S1: Transfer to TEST_TARGET_ADDRESS, S1: Transfer to undeployed UEA | Fresh: S7 "native value to other" |
| UTX-03 | Funds to self | COVERED | COVERED | S2: Bridge USDT to self | Fresh: S6 "USDT to self". pcTx: S9/S10 |
| UTX-04 | Funds to others | COVERED | COVERED | S2: Bridge USDT to different address | Fresh: S6 "USDT to other". pcTx: S9/S10 |
| UTX-05 | Data to contract | **GAP** | **GAP** | -- | No data-only test. All data tests combine with value+funds (S4) |
| UTX-06 | Data to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-07 | Value + Data to contract | **GAP** | **GAP** | -- | S4 has V+F+D but no V+D without funds |
| UTX-08 | Value + Data to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-09 | Value + Funds to self | **GAP** | **GAP** | -- | No value+funds (without data) test |
| UTX-10 | Value + Funds to others | **GAP** | **GAP** | -- | No value+funds (without data) test |
| UTX-11 | Funds + Data to contract | PARTIAL | **GAP** | S5: Bridge USDT + single call | Uses multicall wrapper targeting ZERO_ADDRESS, not raw `data` to contract |
| UTX-12 | Funds + Data to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-13 | V+F+D to contract | COVERED | COVERED | S4: V+F+D to counter contract | Fresh: S8 "V+F+D to counter" |
| UTX-14 | V+F+D to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-15 | Native funds to self | COVERED | COVERED | S3: Bridge native to self | Fresh: S7 "native to self". pcTx: S9/S10 |
| UTX-16 | Native funds to others | COVERED | COVERED | S3: Bridge native to different | Fresh: S7 "native to other". pcTx: S9/S10 |
| UTX-17 | Native funds + data | COVERED | **GAP** | S5: Bridge native + single call | Only existing UEA tested |
| UTX-18 | Native funds + data to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-19 | Value + native funds | **GAP** | **GAP** | -- | No value + native funds (without data) test |
| UTX-20 | Value + funds + native funds | **UNSUPPORTED** | **UNSUPPORTED** | -- | Contract only supports one token type as funds per tx. Native ETH alongside ERC-20 acts as gas, not bridged funds. See Section 8. |
| UTX-21 | Multicall (no funds) | **GAP** | **GAP** | -- | All multicall tests in S5 include funds bridging |
| UTX-22 | Funds + multicall | COVERED | **GAP** | S5: USDT + multicall array | Only existing UEA tested |
| UTX-23 | Native funds + payload | COVERED | **GAP** | S5: Native + single call | Only existing UEA tested |

---

### 3.2 Route 1 SVM Inbound (`svm/inbound/uea-to-push.spec.ts`)

| UTX | Scenario | Existing UEA | New UEA (Fresh) | Existing Test | Gap Details |
|-----|----------|:------------:|:---------------:|---------------|-------------|
| UTX-01 | Value to self | **GAP** | **GAP** | -- | Transfer goes to TEST_TARGET_ADDRESS |
| UTX-02 | Value to others | COVERED | **GAP** | S1: Transfer to Push Chain address | No fresh wallet variant |
| UTX-03 | Funds (SPL) to self | **GAP** | **GAP** | -- | No SPL token bridge test in SVM inbound |
| UTX-04 | Funds (SPL) to others | **GAP** | **GAP** | -- | No SPL token bridge test in SVM inbound |
| UTX-05 | Data to contract | **GAP** | **GAP** | -- | No data test at all |
| UTX-06 | Data to self | SKIPPED | SKIPPED | -- | Can't execute data on own UEA |
| UTX-07 | Value + Data to contract | **GAP** | **GAP** | -- | Not tested |
| UTX-08 | Value + Data to self | SKIPPED | SKIPPED | -- | |
| UTX-09 | Value + Funds to self | **GAP** | **GAP** | -- | Not tested |
| UTX-10 | Value + Funds to others | **GAP** | **GAP** | -- | Not tested |
| UTX-11 | Funds + Data to contract | **GAP** | **GAP** | -- | Not tested |
| UTX-12 | Funds + Data to self | SKIPPED | SKIPPED | -- | |
| UTX-13 | V+F+D to contract | **GAP** | **GAP** | -- | Not tested |
| UTX-14 | V+F+D to self | SKIPPED | SKIPPED | -- | |
| UTX-15 | Native (SOL) to self | COVERED | **GAP** | S3: Bridge SOL to self | No fresh wallet variant |
| UTX-16 | Native (SOL) to others | COVERED | **GAP** | S3: Bridge SOL to different | No fresh wallet variant |
| UTX-17 | Native funds + data | **GAP** | **GAP** | -- | Not tested |
| UTX-18 | Native funds + data to self | SKIPPED | SKIPPED | -- | |
| UTX-19 | Value + native funds | **GAP** | **GAP** | -- | Not tested |
| UTX-20 | Value + funds + native funds | **UNSUPPORTED** | **UNSUPPORTED** | -- | See Section 8. Single `funds` field; native acts as gas only. |
| UTX-21 | Multicall (no funds) | **GAP** | **GAP** | -- | Not tested |
| UTX-22 | Funds + multicall | **GAP** | **GAP** | -- | Not tested |
| UTX-23 | Native funds + payload | **GAP** | **GAP** | -- | Not tested |

---

### 3.3 Route 3 EVM Inbound - CEA -> UEA (`evm/outbound/cea-to-uea.spec.ts`)

| UTX | Scenario | Status | Existing Test | Gap Details |
|-----|----------|:------:|---------------|-------------|
| UTX-01 | Value to self | PARTIAL | S6 sends native value to ueaAddress | Comes as "native funds" not pure value |
| UTX-02 | Value to others | **GAP** | -- | No value-only to external address via Route 3 |
| UTX-03 | Funds to self | COVERED | S1: Bridge ERC20 USDT back to Push Chain | |
| UTX-04 | Funds to others | **GAP** | -- | S1 only bridges to self (ueaAddress) |
| UTX-05 | Data to contract | COVERED | S2: Payload - increment counter | |
| UTX-06 | Data to self | SKIPPED | -- | |
| UTX-07 | Value + Data to contract | COVERED | S7: Native Funds + Payload to counter | Value embedded as native token bridge |
| UTX-08 | Value + Data to self | SKIPPED | -- | |
| UTX-09 | Value + Funds to self | **GAP** | -- | No value+funds without data |
| UTX-10 | Value + Funds to others | **GAP** | -- | |
| UTX-11 | Funds + Data to contract | COVERED | S4: Funds + Payload to counter | |
| UTX-12 | Funds + Data to self | SKIPPED | -- | |
| UTX-13 | V+F+D to contract | **GAP** | -- | No triple-combo test in Route 3 |
| UTX-14 | V+F+D to self | SKIPPED | -- | |
| UTX-15 | Native funds to self | COVERED | S6: Native token from CEA to Push Chain | |
| UTX-16 | Native funds to others | **GAP** | -- | S6 only bridges to self |
| UTX-17 | Native funds + data | COVERED | S7: Native Funds + Payload | |
| UTX-18 | Native funds + data to self | SKIPPED | -- | |
| UTX-19 | Value + native funds | **GAP** | -- | Not tested |
| UTX-20 | Value + funds + native funds | **UNSUPPORTED** | -- | See Section 8. |
| UTX-21 | Multicall (no funds) | COVERED | S3: Multicall - counter + approve, no funds | |
| UTX-22 | Funds + multicall | COVERED | S5: Funds + Multicall | |
| UTX-23 | Native funds + payload | COVERED | S7: Native + Payload, S8: Native + Multicall | |

---

### 3.4 Route 3 EVM Inbound - CEA -> EOA (`evm/outbound/cea-to-eoa.spec.ts`)

| UTX | Scenario | Status | Existing Test |
|-----|----------|:------:|---------------|
| UTX-03 | Funds to self | COVERED | S1: Bridge ERC-20 USDT back |
| UTX-15 | Native funds to self | COVERED | S2: Bridge native token back |
| All others | -- | N/A | EOA only supports fund bridging |

---

### 3.5 Route 3 EVM Inbound - CEA -> Smart Contract (`evm/outbound/cea-to-smart-contracts.spec.ts`)

| UTX | Scenario | Status | Existing Test |
|-----|----------|:------:|---------------|
| UTX-03 | Funds | COVERED | S1: ERC-20 pUSDT outbound + inbound STAKE |
| UTX-05 | Data/Payload | COVERED | S2: Increment counter + inbound STAKE |
| UTX-07 | Multicall | COVERED | S3: Double increment + inbound STAKE |
| UTX-11 | Funds + Payload | COVERED | S4: pUSDT + increment + inbound STAKE |
| UTX-13 | Funds + Multicall | COVERED | S5: pUSDT + transfer + increment + inbound STAKE |
| UTX-15 | Native Funds | COVERED | S6: Native pNative outbound + inbound STAKE |
| UTX-17 | Native + Payload | COVERED | S7: pNative + increment counter |
| UTX-23 | Round-trip | COVERED | S8: Outbound with round-trip payload |

---

### 3.6 Route 3 SVM Inbound (`svm/outbound/svm-outbound.spec.ts`)

| UTX | Scenario | Status | Existing Test | Gap Details |
|-----|----------|:------:|---------------|-------------|
| UTX-03 | Funds (SPL) | COVERED | S11: CEA-to-UEA SPL (USDT) | |
| UTX-05 | Data/Payload | **GAP** | -- | No payload-only SVM inbound |
| UTX-15 | Native (SOL) | COVERED | S10: CEA-to-UEA SOL | |
| UTX-17 | Native + Payload | PARTIAL | S11a: SOL + extraPayload | |
| UTX-21 | Multicall | **GAP** | -- | Not tested |
| UTX-22 | Funds + multicall | **GAP** | -- | Not tested |
| UTX-23 | Native + payload | PARTIAL | S11a: SOL + extraPayload | |
| All others | -- | **GAP** | -- | Most combos not tested for SVM Route 3 |

---

### 3.7 Push Chain Native (no cross-chain)

| UTX | Scenario | Push Chain Status | Notes |
|-----|----------|:-----------------:|-------|
| UTX-01 | Value to self | FALSE (testable) | |
| UTX-02 | Value to others | FALSE (testable) | |
| UTX-03 | Funds to self | UNSUPPORTED | No bridging on Push Chain |
| UTX-04 | Funds to others | UNSUPPORTED | No bridging on Push Chain |
| UTX-05 | Data to contract | FALSE (testable) | |
| UTX-06 | Data to self | **SKIPPED** | Can't execute data on own UEA |
| UTX-07 | Value + Data to contract | FALSE (testable) | |
| UTX-08 | Value + Data to self | **SKIPPED** | Can't execute data on own UEA |
| UTX-09 | Value + Funds to self | UNSUPPORTED | |
| UTX-10 | Value + Funds to others | UNSUPPORTED | |
| UTX-11 | Funds + Data to contract | UNSUPPORTED | |
| UTX-12 | Funds + Data to self | UNSUPPORTED | |
| UTX-13 | V+F+D to contract | UNSUPPORTED | |
| UTX-14 | V+F+D to self | UNSUPPORTED | |
| UTX-15 | Native funds to self | UNSUPPORTED | |
| UTX-16 | Native funds to others | UNSUPPORTED | |
| UTX-17 | Native funds + data | UNSUPPORTED | |
| UTX-18 | Native funds + data to self | UNSUPPORTED | |
| UTX-19 | Value + native funds | UNSUPPORTED | |
| UTX-20 | Value + funds + native funds | UNSUPPORTED | |
| UTX-21 | Multicall (no funds) | FALSE (testable) | Works on Push Chain -- proven by Route 3 S3 in cea-to-uea |
| UTX-22 | Funds + multicall | UNSUPPORTED | |
| UTX-23 | Native funds + payload | UNSUPPORTED | |

---

## 4. Matrix Classification Corrections

These scenarios are marked FALSE in the user matrix but should be corrected:

| UTX | Scenario | Current | Should Be | Reason |
|-----|----------|---------|-----------|--------|
| UTX-06 | Data to self | FALSE | **SKIPPED** | Can't execute data on own UEA |
| UTX-08 | Value + Data to self | FALSE | **SKIPPED** | Can't execute data on own UEA |
| UTX-12 | Funds + Data to self | FALSE | **SKIPPED** | Can't execute data on own UEA |
| UTX-14 | V+F+D to self | FALSE | **SKIPPED** | Can't execute data on own UEA |
| UTX-18 | Native funds + Data to self | FALSE | **SKIPPED** | Can't execute data on own UEA |
| UTX-20 | Value + Funds + Native Funds | FALSE | **UNSUPPORTED** | Contract only allows one token type as funds per tx; native ETH acts as gas, not bridged funds (see Section 8) |
| UTX-21 | Multicall | UNSUPPORTED | **FALSE (testable)** | Multicall works on Push Chain (Route 3 S3 proves this) |

---

## 5. Gap Summary -- Tests to Write

### Priority 1: Route 1 EVM Inbound (Existing UEA)

These are fundamental inbound scenarios missing from `evm/inbound/uea-to-push.spec.ts`:

| # | UTX | Test to Add | `sendTransaction` Params |
|---|-----|-------------|--------------------------|
| 1 | UTX-01 | Value to self | `{ to: pushClient.universal.account, value: BigInt(1e3) }` |
| 2 | UTX-05 | Data to contract | `{ to: COUNTER_ADDRESS_PAYABLE, data: encodeFunctionData({ abi: COUNTER_ABI_PAYABLE, functionName: 'increment' }) }` |
| 3 | UTX-07 | Value + Data to contract | `{ to: COUNTER_ADDRESS_PAYABLE, value: BigInt(1e3), data: encodeFunctionData({ abi: COUNTER_ABI_PAYABLE, functionName: 'increment' }) }` |
| 4 | UTX-09 | Value + Funds to self | `{ to: pushClient.universal.account, value: BigInt(1e3), funds: { amount: BigInt(100), token: usdt } }` |
| 5 | UTX-10 | Value + Funds to others | `{ to: DIFFERENT_ADDRESS, value: BigInt(1e3), funds: { amount: BigInt(100), token: usdt } }` |
| 6 | UTX-11 | Funds + Data to contract (raw data, not multicall) | `{ to: COUNTER_ADDRESS_PAYABLE, funds: { amount: BigInt(100), token: usdt }, data: incrementData }` |
| 7 | UTX-19 | Value + Native Funds | `{ to: pushClient.universal.account, value: BigInt(1e3), funds: { amount: parseUnits('0.00001', 18), token: nativeToken } }` |
| ~~8~~ | ~~UTX-20~~ | ~~Value + Funds + Native Funds~~ | **UNSUPPORTED** -- contract only allows one token type as funds; native ETH acts as gas, not bridged funds. See Section 8. |
| 9 | UTX-21 | Multicall (no funds) | `{ to: COUNTER_ADDRESS_PAYABLE, data: [{ to: COUNTER_ADDRESS_PAYABLE, value: 0n, data: incrementData }, { to: COUNTER_ADDRESS_PAYABLE, value: 0n, data: incrementData }] }` |

### Priority 2: Route 1 EVM Inbound (New UEA / Fresh Wallet)

Fresh wallet variants missing for scenarios that have existing UEA coverage:

| # | UTX | Test to Add |
|---|-----|-------------|
| 1 | UTX-17 | Native funds + data (fresh wallet) |
| 2 | UTX-22 | Funds + multicall (fresh wallet) |
| 3 | UTX-23 | Native funds + payload (fresh wallet) |
| 4 | UTX-01 | Value to self (fresh wallet) |
| 5 | UTX-05 | Data to contract (fresh wallet) |
| 6 | UTX-07 | Value + Data to contract (fresh wallet) |

### Priority 3: Route 3 EVM Inbound (CEA -> UEA)

Missing from `evm/outbound/cea-to-uea.spec.ts`:

| # | UTX | Test to Add | Notes |
|---|-----|-------------|-------|
| 1 | UTX-02 | Value to others (Route 3) | Currently only sends to self |
| 2 | UTX-04 | Funds to others | S1 only bridges to self (ueaAddress) |
| 3 | UTX-13 | V+F+D to contract | Triple-combo not tested in Route 3 |
| 4 | UTX-16 | Native funds to others | S6 only bridges to self |

### Priority 4: SVM Inbound (Route 1)

Most scenarios missing from `svm/inbound/uea-to-push.spec.ts`:

| # | UTX | Test to Add |
|---|-----|-------------|
| 1 | UTX-01 | Value to self |
| 2 | UTX-03 | Funds (SPL) to self |
| 3 | UTX-04 | Funds (SPL) to others |
| 4 | UTX-05 | Data to contract |
| 5 | UTX-07 | Value + Data to contract |
| 6 | UTX-09 | Value + Funds to self |
| 7 | UTX-10 | Value + Funds to others |
| 8 | UTX-11 | Funds + Data to contract |
| 9 | UTX-13 | V+F+D to contract |
| 10 | UTX-17 | Native funds + data |
| 11 | UTX-19 | Value + native funds |
| 12 | UTX-21 | Multicall (no funds) |
| 13 | UTX-22 | Funds + multicall |
| 14 | UTX-23 | Native funds + payload |

### Priority 5: SVM Route 3 Inbound

Missing from `svm/outbound/svm-outbound.spec.ts`:

| # | UTX | Test to Add |
|---|-----|-------------|
| 1 | UTX-05 | Payload-only inbound |
| 2 | UTX-21 | Multicall-only inbound |
| 3 | UTX-11 | Funds + payload |
| 4 | UTX-22 | Funds + multicall |
| 5 | UTX-17 | Native + multicall |

---

## 6. Route 1 vs Route 3 Parity Table

| Capability | Route 1 EVM | Route 3 EVM (CEA->UEA) | Action |
|------------|:-----------:|:----------------------:|--------|
| Value-only transfer | S1 | S6 (as native funds) | -- |
| ERC-20 funds only | S2 | S1 | -- |
| Native funds only | S3 | S6 | -- |
| Data-only (payload) | **MISSING** | S2 | Add to Route 1 |
| Multicall-only | **MISSING** | S3 | Add to Route 1 |
| Funds + Data (raw) | **MISSING** | S4 | Add to Route 1 |
| Funds + Multicall | S5 | S5 | -- |
| Native + Data | S5 | S7 | -- |
| Native + Multicall | S5 | S8 | -- |
| V+F+D | S4 | **MISSING** | Add to Route 3 |
| Fresh wallet variants | S6-8 | **MISSING** | Add to Route 3 |
| pcTx regression | S9-10 | **MISSING** | Consider |
| Hybrid flows | -- | Yes | -- |
| Cascade tests | -- | Yes | -- |

---

## 7. SVM vs EVM Parity Table

| Capability | EVM Route 1 | SVM Route 1 | EVM Route 3 | SVM Route 3 |
|------------|:-----------:|:-----------:|:-----------:|:-----------:|
| Value transfer | S1 (2 tests) | S1 (1 test) | S6 | S10 |
| ERC-20/SPL funds self | S2 | **MISSING** | S1 | S11 |
| ERC-20/SPL funds other | S2 | **MISSING** | **MISSING** | **MISSING** |
| Native funds self | S3 | S3 (SOL) | S6 | S10 |
| Native funds other | S3 | S3 (SOL) | **MISSING** | **MISSING** |
| Data/Payload | **MISSING** | **MISSING** | S2 | **MISSING** |
| Multicall | **MISSING** | **MISSING** | S3 | **MISSING** |
| V+F+D | S4 | **MISSING** | **MISSING** | **MISSING** |
| Funds + Data | **MISSING** | **MISSING** | S4 | **MISSING** |
| Funds + Multicall | S5 | **MISSING** | S5 | **MISSING** |
| Native + Data | S5 | **MISSING** | S7 | S11a (partial) |
| Native + Multicall | S5 | **MISSING** | S8 | **MISSING** |
| Fresh wallet | S6-8 | **MISSING** | -- | -- |
| pcTx regression | S9-10 | **MISSING** | -- | -- |
| Error handling | S11 | S2 (minimal) | Yes | Yes |
| Progress hooks | S12-14 | S4 | Yes | Yes |
| Hybrid flows | -- | -- | Yes | S11b |
| Cascade tests | -- | -- | Yes | -- |

---

## 8. Resolved: UTX-20 (Value + Funds + Native Funds)

### Finding: UNSUPPORTED at contract level

After analyzing `push-chain-gateway-contracts`, `push-chain-core-contracts`, and `push-chain` relay code:

**The gateway `UniversalTxRequest` struct has a single `token` + `amount` field.** You can only bridge ONE token type as funds per transaction.

When both ERC-20 and native ETH are sent in a single user transaction (Case 2.3 in `UniversalGateway.sol`), they serve **different purposes**:

| What's sent | Where it goes | Purpose |
|-------------|---------------|---------|
| `req.token` (ERC-20) + `req.amount` | **Vault** | Bridged as PRC-20 funds to recipient on Push Chain |
| `msg.value` (native ETH) | **TSS** | Used as **gas** for payload execution, NOT as bridged funds |

The gateway emits **two separate events** for Case 2.3:
1. `GAS` event -- native ETH to TSS (instant route)
2. `FUNDS_AND_PAYLOAD` event -- ERC-20 to Vault (standard route)

At the relay level, each `Inbound` protobuf message carries exactly one `amount` + `asset_addr` pair. There is no `nativeFunds` field anywhere in the relay codebase.

**Conclusion**: UTX-20 (Value + ERC-20 Funds + Native Funds all as user funds to recipient) is **UNSUPPORTED**. The native ETH alongside ERC-20 always acts as gas, not as bridged funds.

**Key contract references**:
- `push-chain-gateway-contracts/contracts/evm-gateway/src/UniversalGateway.sol` -- `_fetchTxType()` (line 904), Case 2.3 (lines 464-530)
- `push-chain-gateway-contracts/contracts/evm-gateway/src/libraries/TypesUG.sol` -- `UniversalTxRequest` struct
- `push-chain/proto/uexecutor/v1/types.proto` -- `Inbound` message (single `amount` + `asset_addr`)
- `push-chain/x/uexecutor/keeper/handler.go` -- `depositPRC20()` (single token deposit)

---

## 9. Remaining Notes

1. **UTX numbering vs examples repo**: The user matrix numbering diverges from the examples repo after UTX-04. The examples repo has 22 routes numbered differently (e.g., Route 7 = "Value + Funds to self" but UTX-07 = "Value + Data to contract"). This document follows the **user matrix numbering**.

2. **"To contract" vs "to others" distinction**: The user matrix distinguishes "to contract" and "to self" for data scenarios. The examples repo uses "to self" vs "to others". For testing purposes, "to contract" is a specific "to others" case where the recipient has executable code.

3. **Push Chain multicall (UTX-21)**: Marked UNSUPPORTED in user matrix, but Route 3 S3 in `cea-to-uea.spec.ts` proves multicall works on Push Chain without funds. Should be reclassified as testable.

---

## 9. Suggested Test Section Numbers

If adding to `evm/inbound/uea-to-push.spec.ts`, suggested section numbering to avoid conflicts with existing S1-S14:

```
15. Value to Self (UTX-01)
16. Data to Contract (UTX-05)
17. Value + Data to Contract (UTX-07)
18. Value + Funds — no Data (UTX-09, UTX-10)
19. Funds + Data — no Value (UTX-11)
20. Value + Native Funds (UTX-19)
21. Multicall — no Funds (UTX-21)
22. Fresh Wallet — Data Only (UTX-05 fresh)
23. Fresh Wallet — Value + Data (UTX-07 fresh)
24. Fresh Wallet — Multicall (UTX-21 fresh)

Note: UTX-20 (Value + Funds + Native Funds) is UNSUPPORTED — no test needed.
```
