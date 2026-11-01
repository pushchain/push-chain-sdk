# Push Agentic Wallet — what changed in v6

**Deployed on Donut (chain `42101`) on 2026-10-14** from branch `deploy-agw`, commit `ffd567d`. Addresses:
[`docs/addresses/donut.md`](addresses/donut.md).

v6 ships the fixes from the SDK team's first review of v5. It is a **fresh deployment**: every contract has a new
address. The v5 contracts stay on chain and v5 wallets keep working, but they do not get any of the changes below.

---

## At a glance

| Contract | Changed in v6? | What changed, in one line |
|---|---|---|
| **AGW** (the wallet) | Yes | Approves the gateway by itself before an outbound; can receive its first rules while it is being created |
| **AGWFactory** | Yes | New `createWallet` and `createWalletWithSig`: a wallet and its rules in one transaction |
| **UniversalRulesPolicy (URP)** | Yes | Argument pins on cross-chain calls; a zero limit now means "nothing"; smaller contract |
| **SvmRulebook** | New | The Solana rules, moved out of URP into a linked library; no behaviour change |
| **AgentValidator** | No | Same code, new address |
| **SmartSession** (engine) | No | Same code, new address |

---

## 1. AGW — the wallet

### No more approve step before sending tokens cross-chain

**Before:** to send tokens out through the gateway, the owner or the agent first had to call
`token.approve(gateway, amount)`. Without that, the gateway could not pull the tokens and the outbound failed.

**Now:** the wallet does it automatically. When a call is the gateway's `sendUniversalTxOutbound`, the wallet:

1. approves the gateway for **exactly** the amount in the request;
2. makes the call;
3. sets the allowance back to **0** afterwards.

- **It works the same on every door:** the owner (`execute`), a signed owner intent (`executeWithSig`) and the agent
  (`executeAsAgent`).
- **On the agent door it runs only after URP has accepted the request,** so only a listed token within its limits is
  ever approved.
- **It can never make a call fail.** If the request can't be read, or the token behaves oddly, the wallet skips the
  approval and forwards the call unchanged. The gateway still decides whether the transfer happens.
- **Standing allowances don't last.** After any outbound in a token, the wallet's allowance to the gateway for that
  token is 0, even if the owner set one on purpose.

**For integrators:** remove the approve step. Sending one is harmless but unnecessary.

### A wallet can be created with its rules already granted

`initializeAccount` now takes the initial rules as well as the label. The factory calls it once, at creation. The rules
go through exactly the same checks as a normal `grantRules`. If any rule is refused, the whole creation is undone, so a
wallet never exists with only some of its rules.

### Unchanged

- **`execute`** (the owner door) is byte-for-byte the code that was reviewed.
- The label (`label()`, `setLabel`), the checkpoint counter, revoking rules and the signed-intent doors work as before.

---

## 2. AGWFactory

### `createWallet` and `createWalletWithSig`: one transaction instead of two

**Before:** `deployWallet`, then a separate `grantRules` for each rule.

**Now:**

| Function | Who is the owner | What it does |
|---|---|---|
| `createWallet(label, rules)` | the caller | Deploys the caller's next wallet and grants up to **8** rules |
| `createWalletWithSig(intent, sig, label, rules)` | whoever signed `intent` | The same, submitted by a relayer on the owner's behalf |

- **The address is the same** one `predictWallet` returns. Pre-funding the predicted address still works.
- **All or nothing:** either the wallet exists with every rule, or nothing happened.
- **The rule ids come back** in the same order as the rules.
- **An empty rules list** behaves exactly like `deployWallet` / `deployWalletWithSig`.
- **The signed form binds the rules to the signature.** It requires `intent.sessionHash = keccak256(abi.encode(rules))`
  over the whole array, and `intent.grantNonce = 0`. The label is not signed, as in `deployWalletWithSig`. The
  `OwnerIntent` format is unchanged.
- **Pausing** the factory stops these two as well as the deploy functions.
- **New errors:** `TooManyInitialRules`, `IntentRulesMismatch`, `IntentGrantNonceNotZero`.
- **`createWalletWithSig` selector:** `0x0a8f332b`.

### Unchanged

`deployWallet`, `deployWalletWithSig`, `predictWallet`, `ownerOf`, `isWallet` and the address formula are unchanged.
Owner intents must be signed for the **new factory address**, because the factory is the EIP-712 domain.

---

## 3. UniversalRulesPolicy (URP) — the rules engine

### Argument pins on cross-chain calls

A cross-chain rule's allow-list says which contract and function the agent may call on the destination chain. **Each
entry can now also pin the call's arguments.**

```solidity
enum PinOp { EQ, MAX }
struct ArgPin { uint16 offset; PinOp op; bytes32 value; }
struct AllowedCall {
    address target; bytes4 selector; uint16 beneficiaryOffset; bool hasBeneficiary; uint256 maxValue;
    ArgPin[] pins;   // new
}
```

- **`EQ`:** the argument must equal `value`, for example "the spender must be Aave's pool".
- **`MAX`:** the argument must not exceed `value`, for example "approve at most 1,000 USDC per call". It limits one
  call, not a total.
- **`offset`** counts from the start of the calldata, selector included, so `4` is the first argument. Only
  fixed-size arguments can be pinned.
- **Limits:** up to 8 pins per entry, and up to 32 across the whole allow-list.

**Matching changed as well.** v5 checked only the first entry for a given contract and function. v6 lets the call
through if **any** entry for that contract and function passes in full: beneficiary, value cap and every pin. That's
what lets one rule allow "approve to Aave **or** to Uniswap". If no entry passes, the error reported is the **first**
matching entry's.

**For integrators:** an entry with no pins sitting beside a pinned entry for the same function makes the pins
pointless. The SDK should refuse that shape.

### Native rules get `MAX` pins too

Push-side rules use the same `ArgPin` type. In v5 a native pin could only mean "equals" (`{offset, expected}`); now
it is `{offset, op, value}` and supports `MAX`.

### A zero limit now means "nothing", never "unlimited"

In v5, a few fields used `0` to mean "no limit". In v6, zero never means unlimited.

| Field | v5 | v6 |
|---|---|---|
| Native `maxCalls` | `0` = unlimited | `0` is **refused** (`ZeroMaxCalls`). Unlimited is `type(uint32).max` (`UNLIMITED_CALLS`). |
| Solana program `maxAccounts` | `0` = any number of accounts | `1`–`64` = exactly that many; `255` = any (`ANY_ACCOUNT_COUNT`); `0` and `65`–`254` refused (`SvmMaxAccountsOutOfRange`) |
| Token and value caps | `type(uint256).max` = unlimited, `0` = nothing | unchanged |

**For integrators:** any rule built with `maxCalls: 0` or `maxAccounts: 0` must be updated, or it will be refused when
granted.

### Smaller contract

The Solana rules moved into **`SvmRulebook`** (below), which brought URP from 24,326 bytes, just under the
24,576-byte limit, down to 18,538. That leaves room for future changes.

### Unchanged

- The rule envelope `abi.encode(uint16 version, string chainNamespace, bytes body)`, `version = 1`.
- Multi-asset caps, gas caps, expiry, and the rule that the chain string decides the rulebook.
- `version()` still returns `"3.1.0"`.

---

## 4. SvmRulebook — new

The Solana rulebook (checks S1–S18) as a separate **library linked into URP**. It runs inside URP, through
`DELEGATECALL`, so to callers nothing changed: same errors, same events (emitted from URP's address), same storage.

- **It holds no funds and no state of its own,** and it calls nothing else.
- **Its address is built into URP's code at deployment.** It can't be swapped later.
- **It isn't verified on the explorer.** Donut's Blockscout doesn't index contracts created through the CREATE2
  helper, so it won't verify this one. URP's own verification names the library's address, which confirms which
  code URP runs.

---

## 5. AgentValidator and SmartSession

**No code changes.** They were redeployed only because v6 is a fresh suite: URP points at the engine, and the wallet
points at all three.

---

## What integrators need to do

| | Action |
|---|---|
| Addresses | Switch to the v6 factory and URP (see the address book). Sign owner intents for the **new factory**. |
| Outbound | Remove the `approve(gateway, amount)` step. |
| Creating wallets | Optionally use `createWallet` / `createWalletWithSig` to create and grant in one step. |
| Cross-chain rule encoding | `AllowedCall` has a new last field, `ArgPin[] pins` (an empty array is fine). |
| Native rule encoding | `ArgPin` is now `{offset, op, value}`; `maxCalls` must be non-zero (`type(uint32).max` for unlimited). |
| Solana rule encoding | `maxAccounts` must be `1`–`64`, or `255` for any. |

ABI tuples for the new encodings are in [`docs/addresses/donut.md`](addresses/donut.md#how-to-grant-a-rule-current-encoding).
