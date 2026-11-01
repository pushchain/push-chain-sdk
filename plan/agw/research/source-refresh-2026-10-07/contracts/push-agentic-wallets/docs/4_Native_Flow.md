# Bob Stakes 100 USDC on Push Chain — End-to-End Native Flow (Architecture v3)

**Assumes:** the v3 contract set is live — `AGWFactory` + `AGW` + `SmartSession` (adopted) + `URP` + `AgentValidator`.

**Bob's intent:** *"Put 100 USDC to work in a Push-native staking vault and let an agent manage the position — stake, claim, compound — without ever holding my keys."*

> **This is one of the two agentic workflows v3 supports — the PUSH-NATIVE one.** Bob's agent acts on *Push Chain itself*, calling a Push contract directly from Bob's wallet, under a `NATIVE` rules set. There is no gateway, no bridge, no far chain and no destination account anywhere in this document. The other workflow — the agent acting on a *far* chain through the gateway, under a `UNIVERSAL` rules set — is walked in `3_Universal_Flow.md`. The wallet, the engine, URP and the validator are the same contracts in both; what differs is the kind of rules set Bob grants, which of URP's rulebooks runs — native here; for a universal rules set, the EVM or the Solana one, according to the far chain — and where the money ends up. Both kinds may live on one wallet at once.

> **⚠ THIS DOCUMENT IS v3.** If anything you read elsewhere in this repo contradicts this file, this file wins. In particular: **there is no OutboundExecutor module, no wallet-level "provider" slot, no guardian, no pause on any wallet, and no in-place editing of a granted permission.** The companion document `1_AGW.md` carries the full reasoning.

---

## Cast

| Handle | What it is | Where |
| --- | --- | --- |
| `0xbob` | Bob's EOA — holds USDC | Ethereum |
| `0xbobuea` | Bob's Universal Executor Account — his identity | Push Chain |
| `0xbobagw` | Bob's **agent wallet** — holds the budgeted funds, owned by `0xbobuea`. **One of several Bob may own** | Push Chain |
| `0xagent` | The agent's **Push address** — its own EOA, or the UEA of an external key (EVM, Solana, …). It calls the agent door itself | Push Chain |
| `0xpushstake` | **The Push-native protocol** — a staking vault on Push Chain. Any contract Bob chooses to name; nothing about it is built, adopted or trusted | Push Chain |
| `pUSDC` | Bob's USDC, as it exists on Push Chain | Push Chain |
| `AGWFactory` | Deploys agent wallets at predictable addresses; the registry of record | Push Chain |
| `SmartSession` | The adopted permission engine — the wallet's only installed module | Push Chain |
| `URP` | Universal Rules Policy — **the only contract that checks how the agent calls a Push contract: which arguments, how much value, how many times.** Its native rulebook runs here | Push Chain |
| `AgentValidator` | Stateless sender validator — confirms the sender is the agent. **Never installed** — named inside each permission | Push Chain |

**Deliberately absent from this cast, and from every stage below:** `UniversalGatewayPC` and `0xbobagwcea`. A native rules set may never name the gateway — the wallet refuses it at grant and URP refuses it again at validation — and without the gateway there is no outbound, no TSS, no destination account and no far side. **Everything in this document happens on Push Chain, and every agent action is one Push transaction, start to finish.**

**Not in v3, and deliberately absent from this flow:** any executor module (module type 2 is refused by the wallet), any hook or fallback module, any job/escrow/evaluator layer, any fee split.

---

## STAGE 1 — Intent capture *(off-chain, zero transactions)*

- Bob types his intent. The tooling resolves `0xbobuea`, and asks Bob the v3 question:

  > *"Put this in a **new** agent wallet, or add it as another rules set on an **existing** one?"*

  A new wallet is a new blast-radius boundary. An extra rules set on an existing wallet shares the pool. **This choice is Bob's** (Rule 1).

- The tooling also settles the rules set's **kind** from the intent, and it is not a question Bob is asked: the vault is on Push Chain, so this is a `NATIVE` rules set — the wallet calls `0xpushstake` directly, as itself. Had the vault been on Ethereum, it would be `UNIVERSAL`, and the rest of this document would read as the other one does.

- Bob chooses a new wallet. The tooling derives `0xbobagw` from `(owner, index)` via `AGWFactory.predictWallet` — **before it exists**. There is no second address to derive: a native rules set has no far-chain hand.

- The tooling composes the rules set. A native rules set is **one to eight actions**, each a `(contract, function)` pair with its own rulebook. Bob's has five:

  | # | Agent may call | Pinned arguments | Caps | Call limit |
  | --- | --- | --- | --- | --- |
  | 1 | `0xpushstake.stakeFor(beneficiary, amount)` | `beneficiary` **= `0xbobagw`** — forced, never typed | `amount` ≤ 50 pUSDC per call, 60 pUSDC lifetime | unlimited |
  | 2 | `0xpushstake.unstake()` | — | — | **2** |
  | 3 | `0xpushstake.claim()` | — | — | unlimited |
  | 4 | `0xpushstake.depositFor(beneficiary)` *payable* | `beneficiary` **= `0xbobagw`** | ≤ 5 PC per call, 20 PC lifetime | unlimited |
  | 5 | a bare PC transfer to `0xpushstake` — **value-only, empty calldata** | — | ≤ 5 PC per call, 20 PC lifetime | unlimited |

  | | |
  | --- | --- |
  | Capital | 100 pUSDC in a wallet only Bob can withdraw from |
  | Expires | 7 days — **an explicit, non-zero value**; URP rejects a zero or past expiry at grant |
  | Revoke | instantly, one signature, unblockable |

- **Argument pins — the position and the exact 32-byte word — are generated from `0xpushstake`'s ABI by tooling, never hand-typed.** A wrong position fails closed (the word will never match); a *missing* pin fails open (that argument is the agent's to choose). Note what is **not** granted: `pUSDC.approve`. Bob approves the vault himself, once, through the owner door in Stage 3. Had the agent needed an approval, the SDK would have insisted on pinning the spender — an unpinned approval is the native form of allow-listing `approve` on the far chain.
- The tooling calls `AgentValidator.validateConfig` on the agent config, and shows Bob the five actions in human terms — contract, function, every pin, every cap, and that **a call limit is consumed by any successful call, even one that moves nothing**.
- Bob reviews and approves. **This is the last human decision point.**

---

## STAGE 2 — One signature on Ethereum

**💰 FUND MOVEMENT #1 — USDC leaves Bob's wallet**

- Bob signs a single EIP-712 payload in his own wallet.
- `UniversalGateway.sendUniversalTx()` on Ethereum locks **100 USDC** into the Vault, takes a small extra amount auto-swapped to $PC for gas, and carries the Push Chain payload.

```
0xbob ──100 USDC──▶ UniversalGateway (Ethereum)      [LOCKED]
```

- **Bob needs no $PC, never visits Push Chain, and signs exactly once.** This is the only moment the gateway appears in this document — on the way *in*, funding Bob. The agent will never touch it.

---

## STAGE 3 — Inbound: identity, wallet, rules set, approval — one atomic multicall

- Universal Validators observe the Ethereum event → ballot reaches quorum → `x/uexecutor` dispatches:
  - `UEAFactory.deployUEA()` → **`0xbobuea` created** (first time only)
  - gas auto-swapped to $PC, UEA credited
  - **100 pUSDC minted to `0xbobuea`**
  - `0xbobuea.executeUniversalTx(payload, sig)` → signature verified → multicall runs

**💰 FUND MOVEMENT #2 — 100 USDC arrives as 100 pUSDC**

### The multicall, step by step

| # | Call | Effect |
| --- | --- | --- |
| 1 | `AGWFactory.deployWallet("staking")` | **`0xbobagw` deployed** at the predicted address; owner = `0xbobuea`, baked into bytecode. **Inside the same call the factory invokes `initializeAccount()`, which installs SmartSession** — atomic, no uninitialised state |
| 2 | `0xbobagw.grantRules(session)` | 🔑 **RULES GRANTED** — see below |
| 3 | `pUSDC.transfer(0xbobagw, 100e6)` | 💰 funds → the agent wallet |
| 4 | `PC.transfer(0xbobagw, …)` | ⛽ PC for the two payable actions — the wallet's own value, capped per action by URP |
| 5 | `0xbobagw.execute(pUSDC.approve(0xpushstake, 100e6))` | 🔓 **the owner approves the vault, through the owner door.** No policy in the path — the owner may do anything. The agent was never granted `approve` |

**There is no `installModule(2, OutboundExecutor)` step.** v3 supports **module type 1 only**. The wallet calls the vault itself; nothing else is installed, ever.

### 🔑 The rules set grant (step 2) in detail

`grantRules` takes **one argument**. Nobody tells it what kind of rules set this is: it reads the **chain** each action's policy envelope declares, and derives the kind from that. These actions declare Push's own chain, so this is a `NATIVE` rules set — one that never leaves the chain.

It then does exactly three things: it **overwrites the salt** with the wallet's own monotonic `grantNonce`, it **enforces the canonical session shape** for the derived kind, and it **asserts that kind against every action** — under `NATIVE`, one to eight actions, none of them the gateway.

**Every action must name the same chain**, or the grant reverts `InconsistentChain(i)` naming the odd one out. That is what makes a mixed rules set *unrepresentable* rather than merely forbidden: one chain per rules set means one kind per rules set, so there is no shape in which a cross-chain action could hide among Push-side ones.

```
sessionValidator         = AgentValidator
sessionValidatorInitData = abi.encode(0xagent)              ← the agent's Push address
salt                     = bytes32(grantNonce++)             ← WALLET-SUPPLIED, never the caller's

userOpPolicies:          [ ]        ← ALWAYS EMPTY (that class has a floor of zero)
erc7739Policies:         [ ]        ← ALWAYS EMPTY
permitERC4337Paymaster:  false      ← ALWAYS FALSE

actions: [ ONE TO EIGHT — the NATIVE shape; five here ]

  [0]  actionTarget = 0xpushstake · actionTargetSelector = stakeFor.selector
       actionPolicies: [ URP AND ONLY URP ]
         initData = (chainNamespace = "eip155:42101", body = ↓)   ← THIS chain ⇒ NATIVE
           validUntil       = now + 7 days            ← THE EXPIRY LIVES INSIDE URP, per action
           target, selector = 0xpushstake, stakeFor   ← defensive copies, asserted again at N4/N5
           pins             = [ { offset 4, expected = 0xbobagw } ]     ← the beneficiary, FORCED
           amount           = { on, offset 36, maxPerCall 50e6, maxTotal 60e6 }
           maxValuePerCall  = 0 · maxValueTotal = 0    ← stakeFor is not payable
           maxCalls         = 0                        ← zero means UNLIMITED

  [1]  unstake()    — no pins, no amount, maxCalls = 2
  [2]  claim()      — no pins, no amount, no value, no limit: the strictest shape there is —
                      only the expiry, and the function may take no arguments at all
  [3]  depositFor(beneficiary) payable — pin beneficiary = 0xbobagw · 5 PC per call · 20 PC lifetime
  [4]  VALUE-ONLY  — selector 0xFFFFFFFF, meaning EMPTY calldata · 5 PC per call · 20 PC lifetime
                     (a bare PC transfer; NOT the same as a function with no arguments)
```

**What the wallet refuses before the engine ever sees the session.** Every native action's target is checked against seven addresses that would turn the agent into the owner — the zero address, the engine's wildcard marker `address(1)`, **the wallet itself**, **the engine**, URP, the validator, the factory — and any of them reverts `ForbiddenActionTarget`, naming it. The engine's two wildcard function markers revert `ForbiddenActionSelector`. The gateway reverts `RulesTypeMismatch(NATIVE, i, gateway)` — a gateway target is not *forbidden*, it is the wrong kind for the chain these actions declare. The same target under a foreign chain is perfectly grantable; it would simply be a `UNIVERSAL` rules set. The same `(contract, function)` twice reverts `DuplicateAction`. A wrong policy, an extra user-op policy, a wrong validator: `MalformedSessionShape`, exactly as under `UNIVERSAL`. Zero actions or nine: `TooManyActions(n)`.

**Why URP is the *only* action policy — per action.** The engine requires at least one action policy per action. With URP as the only one on each of the five, **removing URP from any action leaves that action with zero policies and every request against it dies**. The property is per action; a rules set holding eight of them holds it eight times over.

**What URP refuses at initialisation.** A native config may not name the gateway as its target (the mirror of the wallet's check, one layer down). A value-only config may carry neither pins nor an amount rule — it could never authorise anything, so it is a misconfiguration Bob believes he granted, not a valid strict one. More than eight pins, a zero target, a zero or past expiry: refused, each by name.

**The rules set identity.** `permissionId = keccak256(sessionValidator, initData, salt)`. Because the wallet supplies the salt, granting byte-identical terms twice yields two independent rules sets. Because the agent config is in the hash, **the agent cannot be swapped inside a rules set — a different agent is a different rules set** (Rule 4). Each of the five actions has its own action id under that one permission id, and its own URP record under that action id.

**What the agent can do:** five functions, on exactly one Push contract, with the beneficiary forced to Bob's own wallet wherever there is one, up to two amount ceilings and two value ceilings, at most two unstakes, until the expiry.

**What it cannot do:** call any other contract · call any sixth function · stake for anyone but the wallet · deposit for anyone but the wallet · exceed any cap · unstake a third time · act after expiry · call `approve` at all · install or remove modules · call the wallet, the engine, URP, the validator, the factory, **or the gateway** · touch `0xbobuea` · grant or extend anything.

### State after Stage 3

```
0xbobuea    : 0 pUSDC            ← identity only, clean
0xbobagw    : 100 pUSDC + PC     ← owned by 0xbobuea; one NATIVE rules set live (five actions)
pUSDC       : allowance(0xbobagw → 0xpushstake) = 100e6    ← the OWNER's approval, not the agent's
URP.stakeFor: amountSpent 0 · callsUsed 0     (and four more records, all at zero)
```

**Bob signed once. He has an identity, an agent wallet, a five-action bounded rules set, and zero exposure beyond 100 pUSDC and the PC he funded.**

---

## STAGE 4 — The agent works *(off-chain, no funds move)*

- The agent's runtime decides to stake **40 pUSDC** now and keep 60 in reserve.
- It composes the request as **one flat call** — there are no nested layers, no instruction list and no gateway envelope in the native workflow:

```
Layer 1  the execution payload  mode = single · executionCalldata = (0xpushstake, value 0, stakeFor(0xbobagw, 40e6))
```

- **It composes a call; it does not move money.** It signs nothing for the wallet — exactly as in the universal workflow, its authority is being the sender.

---

## STAGE 5 — Execution via the agent door

**🔑 THE AGENT ACTS — the only time it acts in the entire lifecycle**

- The agent **cannot** call `0xpushstake` itself. If it did, `msg.sender` would be the agent, `stakeFor` would pull pUSDC from the *agent's* balance — it has none — and any position would be the agent's. Structurally pointless and structurally blocked.
- Instead it calls **Bob's wallet** itself — from `0xagent`, or, for an external key, by driving its UEA, which verifies that key and then calls the wallet.

> **The caller is the authority.**
> `executeAsAgent` admits only the agent the named rules set records. Anyone else — Bob included — is refused `CallerIsNotAgent` before the engine runs. There is no signature and no relayer: the agent pays the Push transaction gas itself; the wallet pays only the `value` URP allowed.

```
0xagent
  └─▶ 0xbobagw.executeAsAgent(rulesId, mode, execCalldata)
        │
        │  ── THE WALLET DOES THE ENTRYPOINT'S JOBS ITSELF (Push Chain has none) ──
        ├─ 1. session engine still installed?                       ✓
        ├─ 2. msg.sender == agentOf(rulesId)?   else CallerIsNotAgent — before the engine runs
        ├─ 3. build PackedUserOperation in memory (ABI shape only)
        │       signature = USE ‖ rulesId ‖ msg.sender   ← written by the wallet, never supplied
        │
        └─▶ SmartSession.validateUserOp
              ├─ permission enabled?
              ├─ actionId = keccak(0xpushstake, stakeFor)  ← THE ENGINE ROUTES BY (contract, function)
              │     an ungranted pair dies HERE, before any policy runs
              ├─ URP.checkAction  ── reads the mode record: NATIVE ──
              │                    ── the native gates, in order ──
              │     N1 configured · N2 NOT EXPIRED · N3 never the gateway
              │     N4 target == the record's own copy · N5 selector == the record's copy
              │        (under 4 bytes = value-only, and value-only demands EMPTY calldata)
              │     N6 value ≤ per-call cap · value + valueSpent ≤ lifetime cap
              │     N7 every pin: calldata long enough · word at offset 4 == 0xbobagw, ALL 32 BYTES
              │     N8 amount at offset 36 ≤ 50e6 · amount + amountSpent ≤ 60e6
              │     N9 callsUsed < maxCalls   (0 = unlimited)
              │     EFFECTS LAST: valueSpent · amountSpent += 40e6 · callsUsed += 1
              │                   emit NativeCallMetered(id, …, value 0, amount 40e6)
              │
              └─ AgentValidator.validateSignatureWithData   ← LAST, after every policy
                    the 20 bytes the wallet wrote == the agent stored in the rules set?
        │
        ├─ 4. the wallet enforces the verdict itself (authorizer, validAfter/validUntil)
        ├─ 5. the wallet refuses ITSELF and THE ENGINE as target, whatever the verdict
        ├─▶ 6. dispatch THE EXACT VALIDATED BYTES ──▶ 0xpushstake.stakeFor(0xbobagw, 40e6)
        │                                                   ▲
        │                                         msg.sender == 0xbobagw
        │                                         ← the vault pulls pUSDC from the WALLET
        │                                           and credits the WALLET
        └─ 7. emit RulesActionAuthorized(rulesId, 0xagent, keccak256(execCalldata))
```

- **Any single gate failing reverts the whole transaction** — counters, everything. A failed action costs the agent gas and changes nothing else. The agent's runtime is never trusted; URP is the trust boundary.
- **The engine does half the work here that URP does in the universal flow.** Because the call is flat, its target and function are the engine's own action identity: a request to `0xpushstake.withdrawAll()` or to any other contract never reaches URP at all — it dies at the engine with `NoPoliciesSet`. URP's job is what the engine cannot see: the arguments, the value, the count.
- **Ordering note that looks wrong and is not:** the engine consults the session validator **after** the policies. The wallet has already checked the caller, but URP's native gates still treat the calldata as unauthenticated — so, like the universal gauntlet, they make no external calls, write every counter last, and revert on every failure. Every pin and the metered amount are read straight out of the calldata at a frozen position, bounds-checked in 256-bit arithmetic; nothing is decoded as a structure.
- **Step 5 is the last of four refusals of a self-call.** The wallet and the engine were refused at grant (Stage 3); the engine's own minimum-one-policy floor refuses them a second way; and here the wallet refuses them a fourth time, **after** validation, whatever the engine concluded. This one exists for a session the owner enabled on the engine *directly*, bypassing `grantRules` — a thing the owner door permits. Two permanent tests pin it, one of them reaching the engine as a target through the engine's own wildcard. Do not move it before validation.
- **How a failure surfaces.** The engine re-wraps a policy's revert as `PolicyCheckReverted(bytes32)` and keeps only 32 bytes — the URP error's selector and the first 28 bytes of its first argument. That is why every native error leads with the value you debug with: `ArgPinMismatch(actual, index, expected)` shows you the word that did not match; `NativeAmountExceedsCap(amount, cap)` shows you the amount.

### 💰 FUND MOVEMENT #3 — 40 pUSDC moves from the wallet into the vault

```
0xbobagw [100 pUSDC] ──transferFrom, under the OWNER's approval──▶ 0xpushstake [40 pUSDC, credited to 0xbobagw]
URP.stakeFor: amountSpent 0 → 40e6 · callsUsed 0 → 1       emit NativeCallMetered(...)   ← the correlation record
```

---

## STAGE 6 — There is no Stage 6

- In the universal workflow, Stage 6 is cross-chain settlement: validators, a threshold signature, a Vault on the far chain, a destination account deployed on first contact. **None of that exists here.** The agent action was one Push transaction, and it is over.

| | Universal | Native |
| --- | --- | --- |
| After Stage 5 | a burn, an event, and a pending outbound | **the position exists, credited to the wallet** |
| Something in flight? | yes — bridge latency | **no** |
| A far side that can fail? | yes — funds return, spend credited back (designed, not yet functional) | **no** — the call either succeeded inside the transaction or the whole transaction reverted, counters included |
| Gas on failure | consumed, never credited | consumed by the agent, never credited |
| Revocation window | bridge latency | **zero** — the next request is refused |

### 🎯 What `0xpushstake` sees

```
msg.sender = 0xbobagw · beneficiary = 0xbobagw · stake credited → 0xbobagw
```

**The agent appears nowhere.** It never held a cent, never appeared as staker, and cannot unstake to itself — `unstake()` returns funds to `msg.sender`, and `msg.sender` is always the wallet.

### If the call fails

- `stakeFor` reverts inside the vault — insufficient allowance, a paused vault, anything — and **the whole wallet transaction reverts with it**: all three counters, the metering event, everything. Nothing to credit back, because nothing was recorded. The agent paid gas; that is the entire consequence.

---

## STAGE 7 — After the action

### The control chain — one hop shorter than universal

```
0xbobuea  ──owns──▶  0xbobagw  ──is msg.sender at──▶  0xpushstake (position credited to 0xbobagw)
 (identity)          (agent wallet)                   (the Push-native protocol)
```

- **The UEA cannot command the vault directly** — it is not the staker. To unstake, `0xbobuea` calls `0xbobagw.execute(0xpushstake.unstake())` through the owner door, with no policy in the path, and the pUSDC lands back in the wallet. Always one hop, always the wallet.
- **The agent can unstake, twice, to the wallet only** — `unstake()` is granted with a call limit of two, and it pays `msg.sender`, which is the wallet. It cannot redirect the proceeds because there is no argument to redirect.
- **The vault has no idea a rules set exists.** It sees an ordinary contract calling it. All of the enforcement is behind that call, in the wallet, the engine and URP.

| Actor | Can do | Cannot do |
| --- | --- | --- |
| **`0xbobuea`** (Bob) | anything, unconditionally — unstake, withdraw anywhere, revoke, replace a rules set, install/uninstall a validator | — |
| **`0xagent`** | exactly the five actions, under their pins, caps and limits, until expiry | everything else — including a sixth function on the same contract |
| **`0xpushstake`** | credit and pay whoever calls it | tell the agent from the owner — both arrive as `0xbobagw` |

### The owner's three operations, in full

- **Withdraw** — `execute([...])`. **There is no `withdraw()` function**; the owner path *is* withdrawal. `execute(0xpushstake.unstake())` then `execute(pUSDC.transfer(anywhere, …))`, with no destination restriction and no policy in the path. It must succeed in every degraded state — zero rules sets, engine uninstalled, hostile validator installed.
- **Revoke** — `revokeRules(pid)` (existence-checked, so a typo reverts loudly instead of silently "succeeding") or `revokeAllRules()`. Immediate, unblockable, no callbacks on the path. Removing the permission removes all five action records' standing at once. **There is no in-flight window** — a native rules set has nothing in flight.
- **Change a rules set** — **it cannot be edited.** A change is one owner transaction batching: `URP.assertSpent(id, wallet, valueSpent, amountSpent, calls)` → `revokeRules(old)` → `grantRules(new)`. The native assertion names **all three counters** of the action being replaced and every one must match exactly; it refuses to run against a universal record or a ghost, so a stale belief can never pass by reading zeros from the wrong place. If the agent acted in the composition window, the assertion reverts the whole change. **Counters restart at zero on the new rules set**, and any request for the old id is dead: removal cleared its agent, and the new rules set has a new id.
- **Every one of these advances the wallet's checkpoint counter** — one tick per owner-door call, per grant and per revoked id — so a job's evaluator can tell the owner acted. Agent actions never move it.

### STAGE 7b — the second action, and why it still counts

- A week on, the agent calls `claim()` to harvest rewards into the wallet. `claim()` takes no arguments, sends no value, meters no amount. It is the strictest native shape: only the expiry stands between the agent and the call.
- **The call counter still moves.** `claim()` has no limit, so it does not matter here — but it would on `unstake()`, whose limit is two: a zero-value, zero-amount `unstake()` consumes one of the two. **Every successful call is a use.** A limit that a zero-value call could slip past would be advisory, and this is the one place the native rulebook deliberately differs from the universal one, whose spend counter ignores a zero-amount request.

### STAGE 7c — the six requests that fail, and where

| The agent tries | Dies at | Error, as the agent sees it |
| --- | --- | --- |
| `stakeFor(0xagent, 10e6)` — stake for itself | URP, gate **N7** | `ArgPinMismatch(0xagent…, 0, …)` — the pin is what stops the agent staking to itself |
| `stakeFor(0xbobagw, 25e6)` after 40 already staked | URP, gate **N8** | `TotalNativeAmountExceeded(65e6, 60e6)` — the lifetime amount cap |
| a third `unstake()` | URP, gate **N9** | `CallLimitReached(2, 2)` |
| `0xpushstake.withdrawAll()` — a function Bob never granted | **the engine**, before URP | `NoPoliciesSet(pid)` — no action id, no policy, nothing to run |
| `pUSDC.approve(0xagent, …)` — a contract Bob never granted | **the engine**, before URP | the same |
| `0xbobagw.grantRules(…)` — the wallet itself | **the wallet, at grant** — it was never grantable; and again at dispatch if it were somehow enabled | `ForbiddenActionTarget(0xbobagw)` · `ForbiddenDispatchTarget(0xbobagw)` |

---

## Fund movement — the whole ledger

| # | Stage | Movement | Amount |
| --- | --- | --- | --- |
| 1 | 2 | `0xbob` → UniversalGateway (Ethereum) | 100 USDC locked |
| 2 | 3 | mint on Push Chain → `0xbobuea` | 100 pUSDC |
| 3 | 3 | `0xbobuea` → `0xbobagw` | 100 pUSDC + PC |
| 4 | 5 | `0xbobagw` → `0xpushstake`, **credited to `0xbobagw`** | 40 pUSDC |
| 5 | 7b | `0xpushstake` → `0xbobagw` | rewards |

**The agent never appears as a holder in any row. Rows 1–3 are Bob funding himself; rows 4–5 are the wallet moving its own money in and out of a Push contract, on the agent's call, under Bob's pins.**

---

## Diagram

```
                                   ┌─────────────────────────────────────────┐
  STAGE 1  intent                  │  Bob: "stake 100 USDC on Push, agent    │
  (off-chain)                      │        manages the position"            │
                                   └──────────────────┬──────────────────────┘
                                                      │ NEW wallet or EXISTING? ← v3 choice
                                                      │ kind = NATIVE (the vault is on Push)
                                                      │ derive 0xbobagw · compose 5 actions + pins
                                                      ▼
                                            ┌───────────────────┐
                                            │ Bob approves      │  ← last human decision
                                            │ ONE SIGNATURE     │
                                            └─────────┬─────────┘
═══════ ETHEREUM ═══════════════════════════════════════│═══════════════════════════════
  STAGE 2                                               ▼
   0xbob ──────100 USDC──────▶ UniversalGateway ────[LOCKED in Vault]
                                        │ emit UniversalTx        ← the gateway's ONLY appearance
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
                        ├──2─▶ 🔑 grantRules(session) — NATIVE derived from the chain,
                        │                       salt from grantNonce
                        │        wallet: 5 actions · none the gateway · none the wallet/engine/URP/…
                        │        URP: 5 records — expiry · pins · caps · call limits · kind = NATIVE
                        ├──3─▶ 💰 100 pUSDC ──▶ 0xbobagw
                        ├──4─▶ ⛽ PC ──▶ 0xbobagw   (for the two payable actions)
                        └──5─▶ 🔓 OWNER DOOR: pUSDC.approve(0xpushstake)   ← Bob's, not the agent's

  STAGE 4        agent decides · composes ONE FLAT CALL
                                │
  STAGE 5                       ▼
     0xagent calls ──▶ 0xbobagw.executeAsAgent(rulesId, …)
                                │
                    ┌───────────┴────────────────────────┐
                    │ WALLET: engine installed ·         │
                    │   caller == the agent · userOp     │
                    ├────────────────────────────────────┤
                    │ ENGINE: actionId = (0xpushstake,   │
                    │   stakeFor) — ungranted pair dies  │
                    ├────────────────────────────────────┤
                    │ URP: mode = NATIVE · 9 gates       │
                    │  never the gateway · target copy   │
                    │  selector copy · value caps        │
                    │  PINS (beneficiary = 0xbobagw)     │
                    │  amount caps · call limit          │
                    │  EFFECTS LAST: 3 counters          │
                    ├────────────────────────────────────┤
                    │ SENDER CHECKED AGAIN, LAST         │
                    ├────────────────────────────────────┤
                    │ WALLET: not itself, not the engine │
                    └───────────┬────────────────────────┘
                                ▼
                    0xpushstake.stakeFor(0xbobagw, 40e6)
                    💰 40 pUSDC wallet ──▶ vault   (msg.sender = 0xbobagw)
                                │
                    ┌───────────▼────────────────────┐
                    │  0xpushstake                   │
                    │  msg.sender = 0xbobagw         │
                    │  stake credited → 0xbobagw     │
                    │  the agent appears NOWHERE     │
                    └────────────────────────────────┘
                                │
                         ONE TRANSACTION. DONE.
                         no bridge · no TSS · no far side · nothing in flight
```

---

## Both kinds on one wallet

Bob may hold this native rules set and the universal one from `3_Universal_Flow.md` on the **same** wallet, granted by the same owner, naming the same agent or different ones. They meter in disjoint storage — a native call moves no universal counter, and the reverse — and revoking one leaves the other enabled. The only thing they share is the wallet's balance, which is exactly the blast-radius boundary Bob chose in Stage 1.

---

## The five things to remember

1. **One signature — and the wallet is Bob's forever.** Identity, wallet, rules set, funding and the owner's approval land atomically. The wallet's owner is baked into its bytecode at creation and can never be reassigned.
2. **The agent authorises; it never holds.** It triggers five named functions on one named contract, under nine simultaneous gates each. Funds move only from Bob's own wallet, only into positions credited to Bob's own wallet.
3. **The caller is the authority.** `executeAsAgent` admits only the agent the rules set names; an external key acts through its UEA, which verifies the key. There is no bearer request and no relayer.
4. **`msg.sender` at the protocol decides everything.** Because `0xbobagw` makes the call, the vault credits `0xbobagw`. Had the agent called the vault, the position would have been the agent's — and it has nothing to stake. **That single fact is the design, one hop shorter than universal.**
5. **The engine sees the door; URP sees what walks through it.** The engine already knows which contract and which function — that is its action identity, and an ungranted pair never reaches URP. What the engine cannot see is *how* the function is called: URP's native rulebook pins the arguments, caps the value and the amount, and counts the calls. Remove URP from an action and that action enforces nothing.

---

*This document walked the Push-native workflow. For the same wallet, the same engine and the same URP running a universal rules set — the gateway, the bridge, the destination account on the far chain, and URP's sixteen-gate gauntlet opening the payload two levels deep — read `3_Universal_Flow.md`.*
