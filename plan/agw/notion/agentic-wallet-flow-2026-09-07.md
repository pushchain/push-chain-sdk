# agentic_wallet_flow ( updated )

# Bob Lends 100 USDC — End-to-End Flow on Push Chain (Architecture v3)

**Bob’s intent:** *“Find the best-yielding stablecoin lending vault and deploy 100 USDC into it.”*

---

## Cast

| Handle | What it is | Where |
| --- | --- | --- |
| `0xbob` | Bob’s EOA — holds USDC | Ethereum |
| `0xbobuea` | Bob’s Universal Executor Account — his identity | Push Chain |
| `0xbobagw` | Bob’s **agent wallet** — holds the budgeted funds, owned by `0xbobuea`. **One of several Bob may own** | Push Chain |
| `0xbobagwcea` | `0xbobagw`’s Chain Executor Account — the execution hand | Ethereum |
| `0xagentkey` | The agent’s signing key (ECDSA **or** Ed25519) — **a key, not an account** | off-chain |
| `AGWFactory` | Deploys agent wallets at predictable addresses; the registry of record | Push Chain |
| `SmartSession` | The adopted permission engine — the wallet’s only installed module | Push Chain |
| `UCEP` | Universal CrossChain Execution Policy — **the only contract that inspects what the agent really does on the far chain** | Push Chain |
| `PushSessionValidator` | Stateless signature checker (secp256k1 / Ed25519). **Never installed** — named inside each permission | Push Chain |
| `UniversalGatewayPC` | The frozen outbound gateway — the only thing an agent action may call | Push Chain |

All of Bob’s addresses are **deterministic and computable before anything is deployed.**

**Not in v3, and deliberately absent from this flow:** any executor module (module type 2 is refused by the wallet), any hook or fallback module, any job/escrow/evaluator layer, any fee split. Those are separate product concerns with no contract in the v3 set.

---

## STAGE 1 — Intent capture *(off-chain, zero transactions)*

- Bob types his intent. The tooling resolves `0xbobuea`, and — critically — **asks Bob a v3-specific question**:
    
    > *“Put this in a **new** agent wallet, or add it as another mandate on an **existing** one?”*
    > 
    
    A new wallet is a new blast-radius boundary and a new account on every external chain. An extra mandate on an existing wallet shares the pool and the accounts. **This choice is Bob’s, and it exists only in v3** (Rule 1).
    
- Bob chooses a new wallet. The tooling derives `0xbobagw` from `(owner, index)` via `AGWFactory.predictWallet`, then derives `0xbobagwcea` from it — **before either exists**.
- The tooling composes the mandate. Every line below becomes an on-chain policy parameter inside UCEP:
    
    
    | Capital | 100 USDC into a wallet only Bob can withdraw from |
    | --- | --- |
    | Agent may call | `supply()` on Aave v3 / Morpho Blue / Spark — Ethereum only |
    | Ceiling | 100 USDC lifetime, 100 USDC per action |
    | Gas ceiling | a bounded amount of PC per action |
    | Expires | 60 minutes — **an explicit, non-zero value**; UCEP rejects a zero or past expiry at grant |
    | Beneficiary | forced to `0xbobagwcea` — derived, never typed |
    | Revoke | instantly, one signature, unblockable |
- **Argument offsets are generated from each protocol’s ABI by tooling, never hand-typed** — a wrong offset silently disarms the beneficiary check.
- The tooling calls `PushSessionValidator.validateConfig` on the key config, and shows Bob the resolved `0xbobagwcea` and whether it is deployed yet.
- Bob reviews and approves. **This is the last human decision point.**

---

## STAGE 2 — One signature on Ethereum

**💰 FUND MOVEMENT #1 — USDC leaves Bob’s wallet**

- Bob signs a single EIP-712 payload in his own wallet.
- `UniversalGateway.sendUniversalTx()` on Ethereum locks **100 USDC** into the Vault, takes a small extra amount auto-swapped to $PC for gas, and carries the Push Chain payload.

```
0xbob ──100 USDC──▶ UniversalGateway (Ethereum)      [LOCKED]
```

- **Bob needs no $PC, never visits Push Chain, and signs exactly once.**

---

## STAGE 3 — Inbound: identity, wallet, mandate — one atomic multicall

- Universal Validators observe the Ethereum event → ballot reaches quorum → `x/uexecutor` dispatches:
    - `UEAFactory.deployUEA()` → **`0xbobuea` created** (first time only)
    - gas auto-swapped to $PC, UEA credited
    - **100 pUSDC minted to `0xbobuea`**
    - `0xbobuea.executeUniversalTx(payload, sig)` → signature verified → multicall runs

**💰 FUND MOVEMENT #2 — 100 USDC arrives as 100 pUSDC**

### The multicall, step by step

| # | Call | Effect |
| --- | --- | --- |
| 1 | `AGWFactory.deployWallet("lending")` | **`0xbobagw` deployed** at the predicted address; owner = `0xbobuea`, baked into bytecode. **Inside the same call the factory invokes `initializeAccount()`, which installs SmartSession** — atomic, no uninitialised state |
| 2 | `0xbobagw.grantMandate(session)` | 🔑 **MANDATE GRANTED** — see below |
| 3 | `pUSDC.transfer(0xbobagw, 100e6)` | 💰 funds → the agent wallet |
| 4 | `PC.transfer(0xbobagw, …)` | ⛽ the wallet needs its own PC — it pays for the outbound gas swap |

**There is no `installModule(2, OutboundExecutor)` step.** v3 supports **module type 1 only**. The wallet calls the gateway itself; nothing else is installed, ever.

### 🔑 The mandate grant (step 2) in detail

`grantMandate` does exactly two things: it **overwrites the salt** with the wallet’s own monotonic `grantNonce`, and it **enforces the canonical session shape**. Anything else reverts `MalformedSessionShape`.

```
sessionValidator         = PushSessionValidator
sessionValidatorInitData = abi.encode(scheme, 0xagentkey)   ← ECDSA or Ed25519
salt                     = bytes32(grantNonce++)             ← WALLET-SUPPLIED, never the caller's

userOpPolicies:          [ ]        ← ALWAYS EMPTY (that class has a floor of zero)
erc7739Policies:         [ ]        ← ALWAYS EMPTY
permitERC4337Paymaster:  false      ← ALWAYS FALSE

actions: [ EXACTLY ONE ]
  actionTarget           = UniversalGatewayPC
  actionTargetSelector   = sendUniversalTxOutbound.selector
  actionPolicies: [ UCEP AND ONLY UCEP ]
      validUntil        = now + 60 min      ← THE EXPIRY LIVES INSIDE UCEP
      asset             = PRC20_USDC        ← pins the destination chain transitively
      expectedCEA       = 0xbobagwcea       ← DERIVED at grant, committed forever
      maxAmountPerCall  = 100e6
      maxAmountTotal    = 100e6
      maxPCPerCall      = <bounded>
      allowedCalls      = { Aave v3, Morpho Blue, Spark } × { supply } + beneficiary offsets
```

**Why UCEP is the *only* action policy.** The engine requires at least one action policy per action. With UCEP as the only one, **removing UCEP leaves zero policies and every request dies**. Add a second policy — a separate time-window policy, say — and that property is gone: stripping UCEP would leave one policy standing and the request would pass. **This is why the expiry lives inside UCEP and not in a policy of its own.**

**The mandate identity.** `permissionId = keccak256(sessionValidator, initData, salt)`. Because the wallet supplies the salt, granting byte-identical terms twice yields two independent mandates. Because the signer config is in the hash, **the agent key cannot be swapped inside a mandate — a different key is a different mandate** (Rule 4).

**What the agent key can do:** exactly one function, on exactly one Push contract, for one asset, up to two ceilings, into three possible pools, until the expiry, with the beneficiary forced to Bob’s own CEA.

**What it cannot do:** move funds anywhere else · call any other contract · redirect the position · exceed either cap · act after expiry · install or remove modules · call the wallet, UCEP, the gateway, **or `0xbobagwcea` itself** · touch `0xbobuea` · grant or extend anything.

### State after Stage 3

```
0xbobuea    : 0 pUSDC            ← identity only, clean
0xbobagw    : 100 pUSDC + PC     ← owned by 0xbobuea; one mandate live
UCEP.spent  : 0
```

**Bob signed once. He has an identity, an agent wallet, a bounded mandate, and zero exposure beyond 100 USDC.**

---

## STAGE 4 — The agent works *(off-chain, no funds move)*

- The agent’s runtime researches yields off-chain → **Morpho Blue USDC vault, 5.2% APY**.
- It composes the request as **four nested layers**, innermost first:

```
Layer 4  the far-chain call     supply(USDC, 100e6, 0xbobagwcea, 0)
Layer 3  the instruction list   Multicall[] — 1 to 10 entries, mandatory envelope
Layer 2  the gateway request    token, amount, EMPTY recipient, revertRecipient = 0xbobagw,
                                non-zero maxPCForGas, payload = layer 3
Layer 1  the wallet operation   mode, executionCalldata, lane + position, requestExpiry
```

- It signs the **ten-field operation hash**. **It composes instructions; it does not move money.**

---

## STAGE 5 — Execution via the agent door

**🔑 THE AGENT KEY IS USED — the only time it is used in the entire lifecycle**

- The agent **cannot** call `UniversalGatewayPC` itself. If it did, `msg.sender` would be the agent, the Vault would derive the *agent’s* CEA, and the agent would hold Bob’s position. Structurally blocked.
- Instead it calls **Bob’s wallet** — or hands the signed request to any relayer.

> **The caller does not matter — the signature does.**`executeWithSession` has no caller check. **Anyone can submit.** Authorisation lives inside the function: the transaction is inert without a signature over the op hash from the key Bob named. In practice the agent service relays its own requests and pays the Push gas from its own PC balance — a separate balance from the wallet’s.
> 

```
0xagentkey signs opHash (10 bound fields)
  └─▶ 0xbobagw.executeWithSession(validator, mode, execCalldata, sig, nonceKey, nonceSeq, requestExpiry)
        │
        │  ── THE WALLET DOES THE ENTRYPOINT'S JOBS ITSELF (Push Chain has none) ──
        ├─ 1. requestExpiry passed?            revert   (0 = no expiry; no ceiling either)
        ├─ 2. validator installed?             ✓
        ├─ 3. consume nonce lane BEFORE validation — nothing can run twice
        ├─ 4. recompute the ten-field opHash from what arrived
        ├─ 5. build PackedUserOperation in memory (ABI shape only)
        │       sender = address(this) · paymasterAndData = "" · gas fields zeroed
        │
        └─▶ SmartSession.validateUserOp
              ├─ permission enabled?
              ├─ UCEP.checkAction  ── the 16-gate gauntlet, in order ──
              │     1 configured · 2 NOT EXPIRED · 3 gateway only · 4 send selector
              │     5 token == USDC · 6 per-call cap · 7 lifetime cap · 8 PC value cap
              │     9 maxPCForGas != 0 · 10 revertRecipient == wallet · 11 recipient EMPTY
              │     12 multicall envelope · 13 1..10 entries
              │     per entry: 14 not wallet/UCEP/gateway/CEA  ← beats the allow-list
              │                15 (target, selector) allow-listed + beneficiary == 0xbobagwcea
              │                16 per-entry value cap
              │     EFFECTS LAST: spent += amount · emit OutboundMetered
              │
              └─ PushSessionValidator.validateSignatureWithData   ← LAST, after every policy
                    ECDSA: ecrecover      Ed25519: raw staticcall to the USV precompile
        │
        ├─ 6. the wallet enforces the verdict itself (authorizer, validAfter/validUntil)
        └─▶ 7. dispatch THE EXACT VALIDATED BYTES ──▶ UniversalGatewayPC.sendUniversalTxOutbound
                                                            ▲
                                                  msg.sender == 0xbobagw
                                                  ← decides which CEA executes
```

- **Any single gate failing reverts the whole transaction** — nonce, counters, everything. A failed action costs the relayer gas and changes nothing else. The agent’s runtime is never trusted; UCEP is the trust boundary.
- **Ordering note that looks wrong and is not:** the signature is verified **after** the policies. Policies therefore run on calldata that has not yet been authenticated — so every policy, forever, must be safe against arbitrary calldata from any caller. UCEP is safe by construction: no external calls, effects last, revert on every failure.

### 💰 FUND MOVEMENT #3 — 100 pUSDC burns on Push Chain

```
0xbobagw [100 pUSDC] ──BURN──▶ ∅        emit UniversalTxOutbound(sender = 0xbobagw, …)
UCEP.spent: 0 → 100e6                   emit OutboundMetered(...)   ← the correlation record
```

---

## STAGE 6 — Cross-chain settlement

- `PostTxProcessing` creates a pending outbound; Universal Validators produce a **DKLS23 threshold signature**; TSS calls `Vault.finalizeUniversalTx(pushAccount = 0xbobagw, …)` on Ethereum.

### 💰 FUND MOVEMENT #4 — 100 USDC released to the wallet’s CEA

- Vault: `getCEAForPushAccount(0xbobagw)` → not deployed → **deploys `0xbobagwcea`** (first contact)
- Vault: `USDC.safeTransfer(0xbobagwcea, 100e6)`
- Vault: `CEA.executeUniversalTx(..., originCaller = 0xbobagw, payload)` → checks `originCaller == pushAccount` ✓ → runs the instruction list:

| # | Call | Result |
| --- | --- | --- |
| 1 | `USDC.approve(MORPHO_BLUE, 100e6)` | allowance set |
| 2 | `MORPHO_BLUE.supply(USDC, 100e6, 0xbobagwcea, 0)` | **deposit executed** |

### 🎯 What Morpho sees

```
msg.sender = 0xbobagwcea · onBehalfOf = 0xbobagwcea · shares → 0xbobagwcea
```

**The agent appears nowhere.** It never held a cent, never appeared as depositor, and cannot withdraw.

### If the far side fails

- Funds return to `0xbobagw` — because UCEP pinned `revertRecipient` to the wallet, gate 10.
- Push’s Universal Executor Module then calls `UCEP.creditRevert(...)`, which reduces `spent` — **module-only, once per outbound id, saturating**.
- **STATUS: designed and shipped, NOT YET FUNCTIONAL** — the Push-core callback has not landed. Until it does, a failed far leg leaves `spent` inflated and the remedy is revoke-and-regrant. **Gas is never credited back; it was genuinely consumed.**

---

## STAGE 7 — After the action

### The control chain — transitive, and single-parent at every hop

```
0xbobuea  ──owns──▶  0xbobagw  ──is pushAccount of──▶  0xbobagwcea
 (identity)          (agent wallet)                    (Ethereum hand)
```

- **The UEA cannot command the CEA directly.** To withdraw from Morpho, `0xbobuea` calls `0xbobagw.execute(...)`, which originates an outbound, which the TSS routes to `0xbobagwcea`. Always two hops.
- **The agent key cannot withdraw** — `withdraw()` is not in the allow-list, so the owner path is the only exit by construction.
- **The CEA has no independent security.** It is a projection of the agent wallet, not a second line of defence.

| Actor | Can do | Cannot do |
| --- | --- | --- |
| **`0xbobuea`** (Bob) | anything, unconditionally — withdraw anywhere, revoke, replace a mandate, install/uninstall a validator | — |
| **`0xagentkey`** | exactly what the mandate permits, until expiry | everything else |
| **Push governance** | — | reach `0xbobagwcea`; the only path in is a TSS outbound originating from `0xbobagw` |

### The owner’s three operations, in full

- **Withdraw** — `execute([...])`. **There is no `withdraw()` function**; the owner path *is* withdrawal, with no destination restriction and no policy in the path. It must succeed in every degraded state — zero mandates, engine uninstalled, hostile validator installed.
- **Revoke** — `stopMandate(pid)` (existence-checked, so a typo reverts loudly instead of silently “succeeding”) or `stopAll()`. Immediate on Push, unblockable, no callbacks on the path. **One honest limit:** an instruction already dispatched across the bridge still completes.
- **Change a mandate** — **it cannot be edited.** A change is one owner transaction batching: `UCEP.assertSpent(expected)` → `stopMandate(old)` → `grantMandate(new)`. If the agent spent in the composition window, the assertion reverts the whole change. **Counters restart at zero on the new mandate**, and any request the agent signed against the old id is dead, because the op hash binds the permission id.

### STAGE 7b — the second action, and why it may carry zero USDC

- Bob’s agent later wants to move the position from Morpho into Aave. **No new USDC is bridged** — the capital is already at `0xbobagwcea`.
- So the outbound carries `amount == 0` with a payload of allow-listed instructions. **v3 permits this**; `spent` does not move, because the lifetime cap counts what is **bridged**, not what is **redeployed**.
- The exposure is bounded elsewhere: the per-call PC ceiling, the requirement that every instruction be allow-listed, and the wallet’s own small PC balance.

---

## Fund movement — the whole ledger

| # | Stage | Movement | Amount |
| --- | --- | --- | --- |
| 1 | 2 | `0xbob` → UniversalGateway (Ethereum) | 100 USDC locked |
| 2 | 3 | mint on Push Chain → `0xbobuea` | 100 pUSDC |
| 3 | 3 | `0xbobuea` → `0xbobagw` | 100 pUSDC + PC for gas |
| 4 | 5 | `0xbobagw` burn | −100 pUSDC |
| 5 | 6 | Ethereum Vault → `0xbobagwcea` | 100 USDC |
| 6 | 6 | `0xbobagwcea` → Morpho Blue | 100 USDC → vault shares |

**The agent never appears as a holder in any row.**

---

## Diagram

```
                                   ┌─────────────────────────────────────────┐
  STAGE 1  intent                  │  Bob: "best stablecoin yield, 100 USDC" │
  (off-chain)                      └──────────────────┬──────────────────────┘
                                                      │ NEW wallet or EXISTING? ← v3 choice
                                                      │ derive addresses · compose mandate
                                                      ▼
                                            ┌───────────────────┐
                                            │ Bob approves      │  ← last human decision
                                            │ ONE SIGNATURE     │
                                            └─────────┬─────────┘
═══════ ETHEREUM ═══════════════════════════════════════│═══════════════════════════════
  STAGE 2                                               ▼
   0xbob ──────100 USDC──────▶ UniversalGateway ────[LOCKED in Vault]
                                        │ emit UniversalTx
═══════ PUSH CHAIN ═════════════════════│═══════════════════════════════════════════════
  STAGE 3                               ▼
              Universal Validators ──vote──▶ quorum ──▶ x/uexecutor
                                                              │
                        ┌─────────────────────────────────────┘
                        ▼
              deploy 0xbobuea  +  mint 100 pUSDC  +  credit gas
                        │
                        │  ONE ATOMIC MULTICALL
                        ├──1─▶ AGWFactory.deployWallet  → 0xbobagw (owner baked in)
                        │        └─ factory calls initializeAccount() → SmartSession installed
                        │           NO executor module · NO hook · NO fallback
                        ├──2─▶ 🔑 grantMandate  — salt from grantNonce, shape enforced
                        │        UCEP: expiry · asset · caps · allow-list · expectedCEA
                        ├──3─▶ 💰 100 pUSDC ──▶ 0xbobagw
                        └──4─▶ ⛽ PC ──▶ 0xbobagw   (pays its own outbound gas swap)

  STAGE 4        agent researches off-chain · composes 4 nested layers · signs opHash
                                │
  STAGE 5                       ▼
     anyone relays ──▶ 0xbobagw.executeWithSession(...)
                                │
                    ┌───────────┴────────────────────────┐
                    │ WALLET: expiry · validator · nonce │
                    │         · opHash · build userOp    │
                    ├────────────────────────────────────┤
                    │ UCEP: 16 gates, fail closed        │
                    │  gateway only · asset · caps       │
                    │  recipient EMPTY · refund → wallet │
                    │  ≤10 entries · NOT the CEA         │
                    │  allow-list · beneficiary == CEA   │
                    ├────────────────────────────────────┤
                    │ SIGNATURE CHECKED LAST             │
                    └───────────┬────────────────────────┘
                                ▼
                    UniversalGatewayPC.sendUniversalTxOutbound
                    💰 BURN 100 pUSDC   (msg.sender = 0xbobagw)
                                │
                    Universal Validators ──▶ DKLS23 TSS signature
═══════ ETHEREUM ═══════════════│═══════════════════════════════════════════════════════
  STAGE 6                       ▼
                    Vault.finalizeUniversalTx(pushAccount = 0xbobagw)
                                ├─▶ deploy 0xbobagwcea      (first contact)
                                ├─▶ 💰 100 USDC ──▶ 0xbobagwcea
                                └─▶ CEA multicall: approve + supply
                                                    │
                                    ┌───────────────▼────────────────┐
                                    │  MORPHO BLUE                   │
                                    │  msg.sender = 0xbobagwcea      │
                                    │  shares  → 0xbobagwcea         │
                                    │  the agent appears NOWHERE     │
                                    └────────────────────────────────┘
```

---