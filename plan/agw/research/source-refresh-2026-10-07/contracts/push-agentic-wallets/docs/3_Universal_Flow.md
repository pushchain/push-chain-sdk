# Bob Lends 100 USDC — End-to-End Flow on Push Chain (Architecture v3)

**Assumes:** the v3 contract set is live — `AGWFactory` + `AGW` + `SmartSession` (adopted) + `URP` + `AgentValidator`.

**Bob's intent:** *"Find the best-yielding stablecoin lending vault and deploy 100 USDC into it."*

> **This is one of the two agentic workflows v3 supports — the UNIVERSAL one.** Bob's agent acts on a *far* chain, through Push Chain's gateway, under a `UNIVERSAL` rules set. The other workflow — the agent acting on *Push Chain itself*, under a `NATIVE` rules set, with no gateway and no far side — is walked in `4_Native_Flow.md`. The wallet, the engine, URP and the validator are the same contracts in both; what differs is the kind of rules set Bob grants, which of URP's rulebooks runs, and where the money ends up. Both kinds may live on one wallet at once.
>
> **Bob's far chain here is an EVM chain.** A universal rules set for Solana walks the same seven stages through the same contracts; what changes is inside URP. The `solana:` namespace selects URP's Solana rulebook instead of the EVM one, the payload is a single program instruction instead of an instruction list, and account and data pins take the place of beneficiary offsets. `2_UniversalRulesPolicy.md` §1.2c and §1.4c walk it gate by gate.

> **⚠ THIS DOCUMENT IS v3. It supersedes every earlier flow description.**
> If anything you read elsewhere in this repo contradicts this file, this file wins. In particular: **there is no OutboundExecutor module, no wallet-level "provider" slot, no guardian, no pause on any wallet, and no in-place editing of a granted permission.** *(The factory alone has a pause, and it only blocks new wallet creation.)* The companion document `1_AGW.md` carries the full reasoning.

---

## Cast

| Handle | What it is | Where |
| --- | --- | --- |
| `0xbob` | Bob's EOA — holds USDC | Ethereum |
| `0xbobuea` | Bob's Universal Executor Account — his identity | Push Chain |
| `0xbobagw` | Bob's **agent wallet** — holds the budgeted funds, owned by `0xbobuea`. **One of several Bob may own** | Push Chain |
| `0xbobagwcea` | `0xbobagw`'s Chain Executor Account — the execution hand | Ethereum |
| `0xagent` | The agent's **Push address** — its own EOA, or the UEA of an external key (EVM, Solana, …). It calls the agent door itself | Push Chain |
| `AGWFactory` | Deploys agent wallets at predictable addresses; the registry of record | Push Chain |
| `SmartSession` | The adopted permission engine — the wallet's only installed module | Push Chain |
| `URP` | Universal Rules Policy — **the only contract that inspects what the agent really does on the far chain.** Its universal EVM rulebook runs here; its Solana rulebook is in `2_UniversalRulesPolicy.md` §1.4c, its native rulebook is the other document's subject | Push Chain |
| `AgentValidator` | Stateless sender validator — confirms the sender is the agent. **Never installed** — named inside each permission | Push Chain |
| `UniversalGatewayPC` | The frozen outbound gateway — the only thing a **universal** agent action may call, and the one thing a native action never may | Push Chain |

All of Bob's addresses are **deterministic and computable before anything is deployed.**

**Not in v3, and deliberately absent from this flow:** any executor module (module type 2 is refused by the wallet), any hook or fallback module, any job/escrow/evaluator layer, any fee split. Those are separate product concerns with no contract in the v3 set.

---

## STAGE 1 — Intent capture *(off-chain, zero transactions)*

- Bob types his intent. The tooling resolves `0xbobuea`, and — critically — **asks Bob a v3-specific question**:

  > *"Put this in a **new** agent wallet, or add it as another rules set on an **existing** one?"*

  A new wallet is a new blast-radius boundary and a new account on every external chain. An extra rules set on an existing wallet shares the pool and the accounts. **This choice is Bob's, and it exists only in v3** (Rule 1).

- The tooling also settles the rules set's **kind** from the intent, and it is not a question Bob is asked: the vaults are on Ethereum, so this is a `UNIVERSAL` rules set — gateway, bridge, destination account. Had the vault been on Push Chain, it would be `NATIVE`, and the rest of this document would read as the other one does.

- Bob chooses a new wallet. The tooling derives `0xbobagw` from `(owner, index)` via `AGWFactory.predictWallet`, then derives `0xbobagwcea` from it — **before either exists**.
- The tooling composes the rules set. Every line below becomes an on-chain policy parameter inside URP:

  | | |
  | --- | --- |
  | Capital | 100 USDC into a wallet only Bob can withdraw from |
  | Agent may call | `supply()` on Aave v3 / Morpho Blue / Spark — Ethereum only |
  | Ceiling | 100 USDC lifetime, 100 USDC per action |
  | Gas ceiling | a bounded amount of PC per action |
  | Expires | 60 minutes — **an explicit, non-zero value**; URP rejects a zero or past expiry at grant |
  | Beneficiary | forced to `0xbobagwcea` — derived, never typed |
  | Revoke | instantly, one signature, unblockable |

- **Argument offsets are generated from each protocol's ABI by tooling, never hand-typed** — a wrong offset silently disarms the beneficiary check.
- The tooling calls `AgentValidator.validateConfig` on the agent config, and shows Bob the resolved `0xbobagwcea` and whether it is deployed yet.
- Bob reviews and approves. **This is the last human decision point.**

---

## STAGE 2 — One signature on Ethereum

**💰 FUND MOVEMENT #1 — USDC leaves Bob's wallet**

- Bob signs a single EIP-712 payload in his own wallet.
- `UniversalGateway.sendUniversalTx()` on Ethereum locks **100 USDC** into the Vault, takes a small extra amount auto-swapped to $PC for gas, and carries the Push Chain payload.

```
0xbob ──100 USDC──▶ UniversalGateway (Ethereum)      [LOCKED]
```

- **Bob needs no $PC, never visits Push Chain, and signs exactly once.**

---

## STAGE 3 — Inbound: identity, wallet, rules set — one atomic multicall

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
| 2 | `0xbobagw.grantRules(session)` | 🔑 **RULES GRANTED** — see below |
| 3 | `pUSDC.transfer(0xbobagw, 100e6)` | 💰 funds → the agent wallet |
| 4 | `PC.transfer(0xbobagw, …)` | ⛽ the wallet needs its own PC — it pays for the outbound gas swap |

**There is no `installModule(2, OutboundExecutor)` step.** v3 supports **module type 1 only**. The wallet calls the gateway itself; nothing else is installed, ever.

### 🔑 The rules set grant (step 2) in detail

`grantRules` takes **one argument**. Nobody tells it what kind of rules set this is: it reads the **chain** the policy envelope declares, and derives the kind from that. Sepolia is not Push, so this is a `UNIVERSAL` rules set — one that leaves the chain through the gateway. URP then reads the namespace: `eip155:` means an EVM destination and URP's EVM rulebook (`solana:` would select its Solana rulebook). The wallet makes no such distinction; to it, both are the same one-action gateway rules set.

It then does exactly three things: it **overwrites the salt** with the wallet's own monotonic `grantNonce`, it **enforces the canonical session shape** for the derived kind, and it **asserts that kind against the action** — under `UNIVERSAL`, exactly one action, and it must be the gateway's outbound send. A wrong policy, an extra action or a stray user-op policy reverts `MalformedSessionShape`; a target that is wrong *for the kind* — anything but the gateway here — reverts `RulesTypeMismatch(UNIVERSAL, 0, target)`, naming what was tried.

**Why the chain and not a flag.** Bob is choosing a chain, a contract, some functions and a budget. The kind of rules set that implies is a *consequence*, not a fifth decision — so the system computes it rather than asking. It used to be declared twice, once to the wallet and once inside the policy data, with nothing comparing the two at grant; a mismatch produced a rules set that looked granted, described itself wrongly in its own event, and died at first use.

```
sessionValidator         = AgentValidator
sessionValidatorInitData = abi.encode(0xagent)              ← the agent's Push address
salt                     = bytes32(grantNonce++)             ← WALLET-SUPPLIED, never the caller's

userOpPolicies:          [ ]        ← ALWAYS EMPTY (that class has a floor of zero)
erc7739Policies:         [ ]        ← ALWAYS EMPTY
permitERC4337Paymaster:  false      ← ALWAYS FALSE

actions: [ EXACTLY ONE — the UNIVERSAL shape ]
  actionTarget           = UniversalGatewayPC
  actionTargetSelector   = sendUniversalTxOutbound.selector
  actionPolicies: [ URP AND ONLY URP ]
    initData = (version = 1, chainNamespace = "eip155:11155111", body = ↓)   ← THE CHAIN. Not Push ⇒ UNIVERSAL; eip155: ⇒ EVM rulebook.
      validUntil        = now + 60 min      ← THE EXPIRY LIVES INSIDE URP
      expectedCEA       = 0xbobagwcea       ← DERIVED at grant, committed forever
      assets            = [ { token: PRC20_USDC, maxPerCall: 100e6, maxTotal: 100e6 } ]
                                            ← 1..8 tokens; EACH checked AT GRANT against the declared chain
      maxGasPerCall     = <bounded>         ← PC per outbound: protocol fee + gas swap
      allowedCalls      = { Aave v3, Morpho Blue, Spark } × { supply } + beneficiary offsets
```

**The chain is not just a label — it is checked against the money.** When URP writes this config it asks the asset itself which chain it came from (`PRC20_USDC.SOURCE_CHAIN_NAMESPACE()`, the very view the gateway reads on every outbound to decide where to route) and **refuses the grant** if that disagrees with the declared chain (`ChainMismatch`), or if the asset cannot answer at all (`InvalidAsset`). So Bob cannot accidentally authorise "Sepolia" while funding the rules set with a token bound somewhere else. And because gate 5 pins the token on every request, that one check at grant makes the chain true for the rules set's whole life — with no extra work at execution time.

**Why URP is the *only* action policy.** The engine requires at least one action policy per action. With URP as the only one, **removing URP leaves zero policies and every request dies**. Add a second policy — a separate time-window policy, say — and that property is gone: stripping URP would leave one policy standing and the request would pass. **This is why the expiry lives inside URP and not in a policy of its own.**

**The rules set identity.** `permissionId = keccak256(sessionValidator, initData, salt)`. Because the wallet supplies the salt, granting byte-identical terms twice yields two independent rules sets. Because the agent config is in the hash, **the agent cannot be swapped inside a rules set — a different agent is a different rules set** (Rule 4).

**What the agent can do:** exactly one function, on exactly one Push contract, for one asset, up to two ceilings, into three possible pools, until the expiry, with the beneficiary forced to Bob's own CEA.

**What it cannot do:** move funds anywhere else · call any other contract · redirect the position · exceed either cap · act after expiry · install or remove modules · call the wallet, URP, the gateway, **or `0xbobagwcea` itself** · touch `0xbobuea` · grant or extend anything · **call anything on Push Chain directly** — that is what a `NATIVE` rules set is for, and this one is not that.

### State after Stage 3

```
0xbobuea    : 0 pUSDC            ← identity only, clean
0xbobagw    : 100 pUSDC + PC     ← owned by 0xbobuea; one rules set live
URP.assets[0].spent : 0
```

**Bob signed once. He has an identity, an agent wallet, a bounded rules set, and zero exposure beyond 100 USDC.**

---

## STAGE 4 — The agent works *(off-chain, no funds move)*

- The agent's runtime researches yields off-chain → **Morpho Blue USDC vault, 5.2% APY**.
- It composes the request as **four nested layers**, innermost first:

```
Layer 4  the far-chain call     supply(USDC, 100e6, 0xbobagwcea, 0)
Layer 3  the instruction list   Multicall[] — 1 to 10 entries, mandatory envelope
Layer 2  the gateway request    token, amount, EMPTY recipient, revertRecipient = 0xbobagw,
                                non-zero maxPCForGas, payload = layer 3
Layer 1  the execution payload  one single call: target = the gateway, value = PC for far-side gas
```

- **It composes instructions; it does not move money.** It signs nothing for the wallet: its authority is being the sender.

---

## STAGE 5 — Execution via the agent door

**🔑 THE AGENT ACTS — the only time it acts in the entire lifecycle**

- The agent **cannot** call `UniversalGatewayPC` itself. If it did, `msg.sender` would be the agent, the Vault would derive the *agent's* CEA, and the agent would hold Bob's position. Structurally blocked.
- Instead it calls **Bob's wallet** itself — from `0xagent`, or, for an external key, by driving its UEA, which verifies that key and then calls the wallet.

> **The caller is the authority.**
> `executeAsAgent` admits only the agent the named rules set records. Anyone else — Bob included — is refused `CallerIsNotAgent` before the engine runs. There is no signature and no relayer: the agent pays the Push gas itself (an EOA from its own PC balance, a UEA through its gas path) — a separate balance from the wallet's.

```
0xagent
  └─▶ 0xbobagw.executeAsAgent(rulesId, mode, execCalldata)
        │
        │  ── THE WALLET DOES THE ENTRYPOINT'S JOBS ITSELF (Push Chain has none) ──
        ├─ 1. session engine still installed?                       ✓
        ├─ 2. msg.sender == agentOf(rulesId)?   else CallerIsNotAgent — before the engine runs
        ├─ 3. build PackedUserOperation in memory (ABI shape only)
        │       sender = address(this) · paymasterAndData = "" · gas fields and nonce zeroed
        │       signature = USE ‖ rulesId ‖ msg.sender   ← written by the wallet, never supplied
        │
        └─▶ SmartSession.validateUserOp
              ├─ permission enabled?
              ├─ URP.checkAction  ── reads the mode record: UNIVERSAL · EVM ──
              │                    ── the 16-gate gauntlet, in order ──
              │     1 configured · 2 NOT EXPIRED · 3 gateway only · 4 send selector
              │     5 token == USDC · 6 per-call cap · 7 lifetime cap · 8 PC value cap
              │     9 maxPCForGas != 0 · 10 revertRecipient == wallet · 11 recipient EMPTY
              │     12 multicall envelope · 13 1..10 entries
              │     per entry: 14 not wallet/URP/gateway/CEA  ← beats the allow-list
              │                15 (target, selector) allow-listed + beneficiary == 0xbobagwcea
              │                16 per-entry value cap
              │     EFFECTS LAST: spent += amount · emit OutboundMetered
              │
              └─ AgentValidator.validateSignatureWithData   ← LAST, after every policy
                    the 20 bytes the wallet wrote == the agent stored in the rules set?
        │
        ├─ 4. the wallet enforces the verdict itself (authorizer, validAfter/validUntil)
        ├─ 5. the wallet refuses itself and the engine as target, whatever the verdict
        ├─▶ 6. dispatch THE EXACT VALIDATED BYTES ──▶ UniversalGatewayPC.sendUniversalTxOutbound
        │                                                   ▲
        │                                         msg.sender == 0xbobagw
        │                                         ← decides which CEA executes
        └─ 7. emit RulesActionAuthorized(rulesId, 0xagent, keccak256(execCalldata))
```

- **Any single gate failing reverts the whole transaction** — counters, everything. A failed action costs the agent gas and changes nothing else. The agent's runtime is never trusted; URP is the trust boundary.
- **Replay** is the sender's own nonce — the EOA's, or the UEA payload's. The wallet keeps no agent replay state: the same call sent twice is two actions, each checked and metered.
- **Ordering note that looks wrong and is not:** the engine consults the session validator **after** the policies. The wallet has already checked the caller, but every policy, forever, must still be safe against arbitrary calldata the engine has not yet authenticated. URP is safe by construction: no external calls, effects last, revert on every failure.

### 💰 FUND MOVEMENT #3 — 100 pUSDC burns on Push Chain

```
0xbobagw [100 pUSDC] ──BURN──▶ ∅        emit UniversalTxOutbound(sender = 0xbobagw, …)
URP.assets[0].spent: 0 → 100e6         emit OutboundMetered(..., token, amount)   ← the correlation record
```

---

## STAGE 6 — Cross-chain settlement

- `PostTxProcessing` creates a pending outbound; Universal Validators produce a **DKLS23 threshold signature**; TSS calls `Vault.finalizeUniversalTx(pushAccount = 0xbobagw, …)` on Ethereum.

### 💰 FUND MOVEMENT #4 — 100 USDC released to the wallet's CEA

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

- Funds return to `0xbobagw` — because URP pinned `revertRecipient` to the wallet, gate 10.
- Push's Universal Executor Module then calls `URP.creditRevert(...)`, which reduces `spent` — **module-only, once per outbound id, saturating**.
- **STATUS: designed and shipped, NOT YET FUNCTIONAL** — the Push-core callback has not landed. Until it does, a failed far leg leaves `spent` inflated and the remedy is revoke-and-regrant. **Gas is never credited back; it was genuinely consumed.**

---

## STAGE 7 — After the action

### The control chain — transitive, and single-parent at every hop

```
0xbobuea  ──owns──▶  0xbobagw  ──is pushAccount of──▶  0xbobagwcea
 (identity)          (agent wallet)                    (Ethereum hand)
```

- **The UEA cannot command the CEA directly.** To withdraw from Morpho, `0xbobuea` calls `0xbobagw.execute(...)`, which originates an outbound, which the TSS routes to `0xbobagwcea`. Always two hops.
- **The agent cannot withdraw** — `withdraw()` is not in the allow-list, so the owner path is the only exit by construction.
- **The CEA has no independent security.** It is a projection of the agent wallet, not a second line of defence.

| Actor | Can do | Cannot do |
| --- | --- | --- |
| **`0xbobuea`** (Bob) | anything, unconditionally — withdraw anywhere, revoke, replace a rules set, install/uninstall a validator | — |
| **`0xagent`** | exactly what the rules set permits, until expiry | everything else |
| **Push governance** | — | reach `0xbobagwcea`; the only path in is a TSS outbound originating from `0xbobagw` |

### The owner's three operations, in full

- **Withdraw** — `execute([...])`. **There is no `withdraw()` function**; the owner path *is* withdrawal, with no destination restriction and no policy in the path. It must succeed in every degraded state — zero rules sets, engine uninstalled, hostile validator installed.
- **Revoke** — `revokeRules(pid)` (existence-checked, so a typo reverts loudly instead of silently "succeeding") or `revokeAllRules()`. Immediate on Push, unblockable, no callbacks on the path. **One honest limit:** an instruction already dispatched across the bridge still completes.
- **Change a rules set** — **it cannot be edited.** A change is one owner transaction batching: `URP.assertSpent(expected[] — one per token)` → `revokeRules(old)` → `grantRules(new)`. If the agent spent in the composition window, the assertion reverts the whole change. **Counters restart at zero on the new rules set**, and any request for the old id is dead: removal cleared its agent, and the new rules set has a new id.
- **Every one of these advances the wallet's checkpoint counter** — one tick per owner-door call, per grant and per revoked id — so a job's evaluator can tell the owner acted. Agent actions never move it.

### STAGE 7b — the second action, and why it may carry zero USDC

- Bob's agent later wants to move the position from Morpho into Aave. **No new USDC is bridged** — the capital is already at `0xbobagwcea`.
- So the outbound carries `amount == 0` with a payload of allow-listed instructions. **v3 permits this**; `spent` does not move, because the lifetime cap counts what is **bridged**, not what is **redeployed**.
- The exposure is bounded elsewhere: the per-call PC ceiling, the requirement that every instruction be allow-listed, and the wallet's own small PC balance.

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
                                                      │ derive addresses · compose rules set
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
                        ├──2─▶ 🔑 grantRules(session) — kind DERIVED from the chain,
                        │                       salt from grantNonce, shape enforced
                        │        URP: expiry · asset · caps · allow-list · expectedCEA
                        ├──3─▶ 💰 100 pUSDC ──▶ 0xbobagw
                        └──4─▶ ⛽ PC ──▶ 0xbobagw   (pays its own outbound gas swap)

  STAGE 4        agent researches off-chain · composes 4 nested layers
                                │
  STAGE 5                       ▼
     0xagent calls ──▶ 0xbobagw.executeAsAgent(rulesId, …)
                                │
                    ┌───────────┴────────────────────────┐
                    │ WALLET: engine installed ·         │
                    │   caller == the agent · userOp     │
                    ├────────────────────────────────────┤
                    │ URP: 16 gates, fail closed        │
                    │  gateway only · asset · caps       │
                    │  recipient EMPTY · refund → wallet │
                    │  ≤10 entries · NOT the CEA         │
                    │  allow-list · beneficiary == CEA   │
                    ├────────────────────────────────────┤
                    │ SENDER CHECKED AGAIN, LAST         │
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

## The five things to remember

1. **One signature — and the wallet is Bob's forever.** Identity, wallet, rules set and funding land atomically. The wallet's owner is baked into its bytecode at creation and can never be reassigned.
2. **The agent authorises; it never holds.** It triggers one function under sixteen simultaneous gates. Funds move only from Bob's own accounts, only to Bob's own CEA.
3. **The caller is the authority.** `executeAsAgent` admits only the agent the rules set names; an external key acts through its UEA, which verifies the key. There is no bearer request and no relayer.
4. **`msg.sender` at the gateway decides everything.** Because `0xbobagw` originates the outbound, the CEA is Bob's — so Morpho credits Bob. Had the agent originated it, the position would have been the agent's. **That single fact is the design.**
5. **URP is the only contract that can see what the agent is really doing.** To the engine, every universal agent action looks identical — the wallet calling the gateway. Everything Bob actually cares about lives two decode levels down, and URP is what opens it. Remove URP and the rules set enforces nothing.

---

*This document walked the universal workflow. For the same wallet, the same engine and the same URP running a Push-native rules set — no gateway, no bridge, no destination account, the agent's every argument pinned by the owner — read `4_Native_Flow.md`.*
