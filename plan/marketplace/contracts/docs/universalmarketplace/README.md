# Universal Marketplace

How the Universal Marketplace contracts work, end to end. Written for a reviewer: every guarantee is tied to the
code that enforces it, and every assumption the code makes about something else is stated.

| Doc | Contents |
|---|---|
| **This file** | What the marketplace is, its parts, the agent card lifecycle, `openJob` step by step, the rules check, the criteria, admin powers, upgradeability, trust model, limitations, tests, reviewer checklist |
| [`reference.md`](./reference.md) | Every function, event, error, registration reason, storage slot and constant, one by one |
| [`criteria.md`](./criteria.md) | The `jobSpecTemplate` format, how a job's `JobSpec` is built from it, and two worked examples |
| [`../addresses/push_donut_universal_marketplace.md`](../addresses/push_donut_universal_marketplace.md) | The live Push Donut deployment: every proxy, implementation, ProxyAdmin, role and supported chain |

Code as of branch `sdk-iteration-v1`, commit `7cd2d7b` (marketplace v2, PRD 12). Deployed on Push Donut on 2026-10-20
(§12.5).

---

## Contract locations

| Contract | Path | Kind |
|---|---|---|
| **UniversalMarketplace** | [`src/agentic-commerce-8183/UniversalMarketplace.sol`](../../src/agentic-commerce-8183/UniversalMarketplace.sol) | Upgradeable (TransparentUpgradeableProxy), stateful. The only contract users and providers call. `version()` = `"2.0.0"`. |
| **UniversalMarketplaceRules** | [`src/agentic-commerce-8183/UniversalMarketplaceRules.sol`](../../src/agentic-commerce-8183/UniversalMarketplaceRules.sol) | Stateless, `pure`, not upgradeable. The rules side of a card: registration guards and rules = card at `openJob`. |
| **JobSpecBuilder** | [`src/agentic-commerce-8183/libraries/JobSpecBuilder.sol`](../../src/agentic-commerce-8183/libraries/JobSpecBuilder.sol) | External library, linked into the marketplace and called by `DELEGATECALL`. Builds each job's criteria. |
| Types | [`src/agentic-commerce-8183/libraries/Types.sol`](../../src/agentic-commerce-8183/libraries/Types.sol) | Every struct and enum of the package (file-level), and the markers `MARKER_WALLET` / `MARKER_PRINCIPAL`. |
| Errors | [`src/agentic-commerce-8183/libraries/Errors.sol`](../../src/agentic-commerce-8183/libraries/Errors.sol) | `UniversalMarketplaceErrors` (40 errors), `RulesBindingHookErrors`, `ERC8183HookErrors`. |
| JobSpecTypes | [`src/agentic-commerce-8183/libraries/JobSpecTypes.sol`](../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol) | The built criteria (`JobSpec`): the wire format shared with the future UniversalHook and UniversalEvaluator. |
| IUniversalMarketplace | [`src/agentic-commerce-8183/interfaces/IUniversalMarketplace.sol`](../../src/agentic-commerce-8183/interfaces/IUniversalMarketplace.sol) | The marketplace's events and functions (banners UM_1–UM_5). |
| IUniversalMarketplaceRules | [`src/agentic-commerce-8183/interfaces/IUniversalMarketplaceRules.sol`](../../src/agentic-commerce-8183/interfaces/IUniversalMarketplaceRules.sol) | The rules helper's two functions (banner UMR_1). |
| AGW interfaces | [`interfaces/external/IAGW.sol`](../../src/agentic-commerce-8183/interfaces/external/IAGW.sol), [`IAGWFactory.sol`](../../src/agentic-commerce-8183/interfaces/external/IAGWFactory.sol), [`ISmartSession.sol`](../../src/agentic-commerce-8183/interfaces/external/ISmartSession.sol) | The SmartSession `Session` mirror and the AGW / factory / engine functions the package calls. AGW types are imported, not copied (§12.1). |

Contracts the marketplace works with, but which are **not** part of it:

| Contract | Where | Role |
|---|---|---|
| **AgenticCommerce** (the "kernel") | [`src/agentic-commerce-8183/AgenticCommerce.sol`](../../src/agentic-commerce-8183/AgenticCommerce.sol) | The ERC-8183 job kernel: jobs, budgets, escrow, payout. The marketplace only creates jobs on it (through the user's wallet). On Donut the marketplace uses **its own instance**, deployed with it on pUSDC (`0x977cf1AC973E9eC4332791d531507575006157Ed`), not the `marketplace_demo` kernel (§12.5). |
| **RulesBindingHook** | [`src/agentic-commerce-8183/hooks/RulesBindingHook.sol`](../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol) | The interim 8183 hook every marketplace job is created with. At `fund` it binds the job to the wallet's live rules set and allows one live job per wallet. |
| **AGW + AGWFactory** | `push-agentic-wallets` repo (submodule [`lib/push-agentic-wallets`](../../lib/push-agentic-wallets)) | The user's agentic wallet (an ERC-7579 account with SmartSession) and its factory. Verifies the owner's signature. AGW v6 is deployed on Donut. |
| **UniversalRulesPolicy (URP)** | `push-agentic-wallets` repo | The SmartSession policy that enforces the agent's rules when the agent sends outbound calls through the gateway. |
| **CEAFactory** | destination chain (`src/cea/CEAFactory.sol` here) | Deploys each user's Chain Executor Account (CEA) on the destination chain. The marketplace only predicts CEA addresses. |
| UniversalHook, UniversalEvaluator (V2) | not compatible yet (§12.5) | The intended long-term hook and evaluator. Until they ship, jobs use RulesBindingHook and a Push-controlled evaluator address. |

---

## 1 · What the marketplace is

The Universal Marketplace is a registry of **agent cards** plus one entry point, **`openJob`**.

- **An agent card** is a standing offer from one provider (an AI agent's address). Each provider has at most one
  card. It covers one job type on one EVM execution chain. It says who the agent is, what it does, what it needs
  permission to do there (the **rules**), and how "done" is judged (the **`jobSpecTemplate`**, the criteria
  template).
- **`openJob`** is one relayed call. On a single signature from the user, it:
  1. deploys the user's agentic wallet (AGW) if needed;
  2. grants the AGW the card's rules, with the card's markers filled for this job, so the agent can act from it;
  3. creates an ERC-8183 job on the kernel, with the AGW as client, the card's provider as provider, the
     marketplace's configured evaluator and hook, and **criteria built on-chain from the card**.

What the marketplace deliberately does **not** do:

| Not done | Where it happens instead |
|---|---|
| Move any funds | The user funds the AGW in a separate transaction. The provider prices the job with `setBudget`; the AGW funds it with `fund`. Both are kernel calls. |
| Grant token approvals as the owner | Approvals are the agent's: an `approve` is an allowed call the agent makes, with its spender and amount pinned by the card (D1, §6.3). |
| Judge whether the criteria make sense | Nobody, on-chain. The admin's **verified tag** is the review. |
| Evaluate the job | The job's evaluator (the UniversalEvaluator, once shipped). |
| Enforce the agent's rules at execution | The AGW's SmartSession engine and URP. |

The marketplace never holds tokens or native PC. Tests `test_MS02_movesNoFunds` and the invariants
`MI02_marketplaceHoldsNothing` and `MI05_userBalanceNeverMovedByOpenJob` check this.

---

## 2 · Glossary

| Term | Meaning |
|---|---|
| **Provider / agent** | One address. It registers the card, is the 8183 job's `provider` (and fee recipient), and is the agent the rules authorise (`sessionValidatorInitData == abi.encode(provider)`). One card per provider (`agentCardOf`). |
| **User / owner** | The person opening a job. Signs one `OwnerIntent`; owns the AGW. |
| **AGW** | Agentic Wallet: the user's smart account, deployed by the AGW factory at an address derived from `(owner, index)`. The job's client. |
| **CEA** | Chain Executor Account: the AGW's account on the destination chain, at an address derived from the AGW (`computeCEA`). It is where the agent's outbound calls execute and where the criteria read balances. |
| **Agent card** | `AgentCard` (the listing) plus two blobs: `rules` and `jobSpecTemplate`. |
| **Rules** | On the card: `abi.encode(AgentCardRules)`, the assets with caps, the gas cap and the allowed calls with pins. At `openJob`: the SmartSession `Session` granted to the agent, whose one policy carries the AGW v6 envelope `abi.encode(uint16 ENVELOPE_VERSION, string chain, bytes body)` with `UniversalTerms` as body. `rulesId` is the engine's `permissionId`. |
| **Pin** | An AGW v6 `ArgPin{offset, op, value}` on an allowed call: the calldata word at `offset` must equal (`EQ`) or not exceed (`MAX`) `value`. |
| **Markers** | Two published `bytes32` constants a card may hold where a per-job value goes: `MARKER_WALLET` (the user's CEA on the card's chain, EQ pins only) and `MARKER_PRINCIPAL` (this job's principal, in pins and in the principal asset's caps). The signed session holds the filled values, never a marker (D2, D3). |
| **OwnerIntent** | The single owner-signed message (AGW type, imported). One signature authorises the wallet deploy, the rules grant and the `createJob` execution. |
| **`jobSpecTemplate`** | `abi.encode(JobSpecTemplate)`: the V2 `JobSpec` with holes. Stored on the card. Also called the criteria template. |
| **JobSpec** | The built criteria for one job: reads, checks, the `logic` tree, `allowedMutability`, `origin`, times. `abi.encode(JobSpec)` is the 8183 job's `description`. |
| **`logic`** | The job's pass logic: `Logic` steps, each combining checks and child steps with `ALL`, `ANY` or `AT_LEAST k`. Copied verbatim; its semantics are evaluator-owned. |
| **Card version** | 1 at registration, +1 per update. Bound into every job's criteria, so an intent signed against one version can't open a job on another. Recorded per job (`cardVersionOfJob`). |
| **Verified tag** | An admin label: "this card, at this version, was reviewed". A tag, not a gate. |
| **chainHash** | `keccak256` of a CAIP-2 string such as `"eip155:11155111"`. The key for chain configuration. |
| **`PUSH_CHAIN_HASH`** | `keccak256("eip155:" ‖ block.chainid)`: Push Chain itself. No card may name it. |

---

## 3 · The parts and how they fit

```mermaid
flowchart LR
    Provider -- registerAgentCard / updateAgentCard --> MKT[UniversalMarketplace]
    Relayer -- openJob --> MKT
    MKT -- validateAgentCardRules / checkRulesMatchCard --> RULES[UniversalMarketplaceRules]
    MKT -- DELEGATECALL build --> JSB[JobSpecBuilder]
    JSB -. computeCEA .-> MKT
    MKT -- predictWallet / deployWalletWithSig / ownerOf --> FACT[AGWFactory]
    MKT -- grantRulesWithSig / executeWithSig --> AGW[User's AGW]
    AGW -- createJob --> KERNEL[AgenticCommerce kernel]
    MKT -- jobCounter / getJob / whitelistedHooks / paymentToken --> KERNEL
    KERNEL -- beforeAction / afterAction --> HOOK[RulesBindingHook]
```

- **The marketplace** holds the cards and runs `openJob`. It is the `executor` named in the user's intent: the
  factory and the wallet accept that intent only from it.
- **The rules helper** is pure logic, split out for the EIP-170 size limit. It validates a card's rules at
  registration (R1–R17) and checks the user's session against the card at `openJob` (C1–C14).
- **JobSpecBuilder** is an external library. It turns the card's `jobSpecTemplate` plus the job's inputs into the
  job's `JobSpec`. It runs in the marketplace's context, so it reads CEAs from the marketplace's own `computeCEA`.
- **The AGW** does the work that needs the owner's authority: it verifies the owner's signature, grants the rules,
  and calls `createJob` itself, so the kernel records the AGW as the client.

---

## 4 · The agent card

### 4.1 What a card holds

A card is three things stored on-chain together:

1. **`AgentCard`**, the listing. Who: `provider`. What: `jobType`, `metadataURI` and `metadataHash` (off-chain
   JSON with the name, summary, ABIs, criteria in words and param units). Where: `chainNamespace`, a full CAIP-2
   string `"eip155:<id>"`, immutable after registration. Commercials: `providerFee` (reference price, in
   `paymentToken`) and `paymentToken`. Windows: `principalMin` / `principalMax` (in the principal asset's units),
   `minDuration` / `maxDuration`, `minExecuteWindow`, `settleWindow`. And an `active` switch.
2. **Rules**, `abi.encode(AgentCardRules)`: `assets` (1–8 AGW `AssetCap{token, maxPerCall, maxTotal}`, each a
   PRC20 of the card's chain), `principalAsset` (an index into `assets`), `maxGasPerCall` (PC wei per outbound),
   and `allowedCalls` (1–32 AGW `AllowedCall`s, with pins). See §6.
3. **`jobSpecTemplate`**, `abi.encode(JobSpecTemplate)`: see [`criteria.md`](./criteria.md).

`getAgentCard(cardId)` returns all three, the version and both tags in one call (`AgentCardView`).

**One card per provider.** `registerAgentCard` reverts `AgentCardAlreadyRegistered(provider)` if
`agentCardOf[msg.sender] != 0`. Disabling a card does not free the provider: a disabled provider cannot register
again (`test_MR11_onePerProvider`, invariant `MI06`).

**`paymentToken`.** Until the kernel supports a per-job payment token (K-12, out of scope), every job is paid in
the kernel's token, so a card must name exactly `KERNEL.paymentToken()` (`InvalidAgentCard("payment token")`,
`test_MR12_paymentTokenGuard`). `providerFee` is a reference price the client funds against; the marketplace does
not enforce it (§5).

### 4.2 What registration checks

`registerAgentCard` checks `agentCardOf` first; then it and `updateAgentCard` run `_validateCard`, in this order.
The first failure reverts.

| # | Check | Error |
|---|---|---|
| 1 | `jobType != 0` | `InvalidAgentCard("job type zero")` |
| 2 | `metadataURI` not empty | `InvalidAgentCard("metadata uri empty")` |
| 3 | `metadataHash != 0` | `InvalidAgentCard("metadata hash zero")` |
| 4 | `chainNamespace` starts with `"eip155:"` and is longer than 7 bytes | `InvalidAgentCard("chain namespace")` |
| 5 | the chain is not Push, and has a CEA deployment (`setCEADeployment`) | `ChainNotSupported(chainHash)` |
| 6 | `paymentToken == KERNEL.paymentToken()` | `InvalidAgentCard("payment token")` |
| 7 | the caller is not the marketplace's evaluator | `InvalidAgentCard("provider is evaluator")` |
| 8 | `principalMax != 0` and `principalMin ≤ principalMax` | `InvalidAgentCard("principal range")` |
| 9 | `1 hour ≤ minDuration ≤ maxDuration` | `InvalidAgentCard("duration range")` |
| 10 | `settleWindow != 0` | `InvalidAgentCard("settle window")` |
| 11 | `minExecuteWindow + settleWindow ≤ maxDuration` | `InvalidAgentCard("execute window")` |
| 12 | the rules pass `RULES.validateAgentCardRules` (R1–R17, §6.2) | `InvalidAgentCard(...)` from the helper |
| 13 | **every** asset's `SOURCE_CHAIN_NAMESPACE()` is a well-formed string equal to the card's chain | `InvalidAgentCard("asset")` / `InvalidAgentCard("asset chain")` |

**The `jobSpecTemplate` is stored as given; it is not checked.** Whether the evaluator can run it is the
provider's responsibility. A malformed template fails only when a job is built from it (§7.3).

Check 13 uses a raw `staticcall` plus an ABI-shape check, not `try/catch`: a `try` clause cannot catch the
decoding of its own return data, so a non-string answer would otherwise revert with an opaque error. A codeless
asset answers empty and fails the length check (`test_MR06_assetTeeth`, `test_MR13_everyAssetOnChain`).

### 4.3 Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Active: registerAgentCard (version 1, unverified)
    Active --> Inactive: setAgentCardActive(false) by provider
    Inactive --> Active: setAgentCardActive(true) by provider
    Active --> Active: updateAgentCard (version +1, tag cleared)
    Inactive --> Inactive: updateAgentCard (version +1, tag cleared)
    Active --> Disabled: disableAgentCard
    Inactive --> Disabled: disableAgentCard
    Disabled --> [*]
```

| Action | Who | Effect |
|---|---|---|
| `registerAgentCard` | any address without a card (becomes the provider) | Stores the card, version 1, active, unverified; `agentCardOf[provider] = cardId`. The contract writes `provider = msg.sender` and `active = true`, ignoring the caller's values. |
| `updateAgentCard` | the provider | Replaces every field except `provider`, `chainNamespace` and `active` (so `jobType`, `metadataURI`, `metadataHash`, `providerFee`, `paymentToken`, principal range, durations and windows), and both blobs. Version +1, verified tag cleared. **The chain cannot change** (`AgentCardIdentityImmutable`). Refused for a disabled card (`AgentCardDisabled`). |
| `setAgentCardActive` | the provider | Switches the card on or off. A disabled card cannot be switched back on. |
| `verifyAgentCard(cardId, cardVersion)` | admin | Sets the verified tag. `cardVersion` must be the current version (`AgentCardVersionMismatch`), so a provider who updates after review makes it revert. Refused for a disabled card; allowed for an inactive one. |
| `revokeAgentCardVerification` | admin | Clears the tag. Idempotent: emits only if there was a tag. |
| `disableAgentCard` | admin | Permanent kill switch: disabled, inactive, tag cleared. The provider cannot undo it, and keeps its `agentCardOf` entry. |

**Updates and signed intents.** The card version is hashed into every job's `origin`, which is inside the
`createJob` calldata the owner signs. After an update, an intent signed against the old version fails at
`AgentCardVersionMismatch` (stale `p.cardVersion`) or at `IntentExecMismatch` (current version, old intent)
(`test_ML11_update_invalidatesOldIntents`). A provider therefore cannot swap the card under a user's signature.
Jobs already opened are untouched (`test_ML12_update_leavesOpenedJobsUntouched`).

**The verified tag is a tag, not a gate.** `openJob` treats verified and unverified cards alike. The SDK shows it.

---

## 5 · End-to-end flow

```mermaid
sequenceDiagram
    autonumber
    actor P as Provider (agent)
    actor U as User (owner)
    participant SDK
    participant M as UniversalMarketplace
    participant F as AGWFactory
    participant W as User's AGW
    participant K as Kernel (AgenticCommerce)
    participant H as RulesBindingHook

    P->>M: registerAgentCard(card, rules, jobSpecTemplate)
    U->>SDK: pick a card, principal, times, params
    SDK->>SDK: build the session: card rules, markers filled (Appendix E of PRD 12)
    SDK->>M: previewIntent(request, session)
    M-->>SDK: OwnerIntent (calldata hash binds the built criteria)
    U->>SDK: sign the OwnerIntent once
    SDK->>M: openJob(params) via a relayer
    M->>F: deployWalletWithSig(intent, sig, label) [if new]
    M->>W: grantRulesWithSig(session, intent, sig)
    M->>W: executeWithSig(createJob calldata, intent, sig)
    W->>K: createJob(provider, evaluator, expiredAt, JobSpec, hook)
    Note over M,K: job is Open, budget 0. Nothing has moved.
    U->>W: funding tx (SDK-built): principal, PC for gas, fee
    P->>K: setBudget(jobId, card.providerFee)
    W->>K: fund(jobId, card.providerFee, abi.encode(rulesId))
    K->>H: beforeAction(fund): bind job to the live rules set
    P->>W: act within the rules (URP-enforced outbound calls, approvals included)
    P->>K: submit; evaluator completes or rejects
```

1. **The provider registers a card** (§4).
2. **The user opens a job.** The SDK builds the session from the card's rules (filling the markers), calls
   `previewIntent`, the user signs the returned `OwnerIntent` once, and a relayer calls `openJob`. The AGW is
   deployed (if new), granted the rules, and creates the job in **Open** with budget 0.
3. **The user funds** the AGW, in one transaction built by the SDK: the principal (in the principal asset), PC
   for gas and the fee.
4. **The provider prices** the job: `kernel.setBudget(jobId, card.providerFee)`.
5. **The AGW funds** the job: `kernel.fund(jobId, card.providerFee, abi.encode(rulesId))`. The kernel calls the
   hook, which checks the AGW is a factory wallet, the rules set is live, and the AGW has no other live job. A
   provider who prices above the card's fee cannot be funded, because the owner's `expectedBudget` is the card fee
   (`BudgetMismatch`; `test_MS17_8183Continuation_feeEnforcedAtFund`).
6. **The agent executes** within the rules (including any pinned `approve`), submits, and the evaluator completes
   or rejects (kernel).

Steps 3–6 are outside the marketplace. They are shown because the marketplace's design depends on them. The fork
test `test_fork_openJob_realAGWv6` runs steps 2, 4 and 5 against the real AGW v6 on Donut.

---

## 6 · The rules: rules = card

The owner signs a SmartSession `Session` the SDK builds, which they cannot read. The marketplace proves it is
exactly the card's rules, with the card's markers filled for this job, for the card's agent, bound to this job.
Both checks live in the rules helper.

### 6.1 The format (AGW v6)

The card stores `AgentCardRules`:

```solidity
struct AgentCardRules {
    AssetCap[] assets;           // 1..MAX_ASSETS (8) PRC20s on Push, each SOURCE_CHAIN_NAMESPACE == card chain
    uint8 principalAsset;        // index into assets
    uint256 maxGasPerCall;       // PC wei per outbound, copied to the session exactly
    AllowedCall[] allowedCalls;  // 1..32; pins may hold MARKER_WALLET / MARKER_PRINCIPAL
}
```

`AssetCap`, `AllowedCall`, `ArgPin` and `PinOp` are the AGW v6 types, imported from `@push-agw/libraries/Types.sol`.
The session's one action carries one URP policy whose `initData` is the v6 **envelope**
`abi.encode(uint16 version, string chainNamespace, bytes body)`, with `version == ENVELOPE_VERSION` (1) and
`body = abi.encode(UniversalTerms{validUntil, expectedCEA, assets, maxGasPerCall, allowedCalls})`.

**Multi-asset.** Each asset has its own `maxPerCall` and lifetime `maxTotal`. The principal asset's caps are set
per job (D3); every other asset's caps are copied from the card. A second asset with caps `{0, 0}` may route a
request but never moves (the two-asset fixture `_rulesTwoAssets`).

**Markers** (D2, D3). Where a card needs a per-job value it holds a marker, and the signed session holds the
value the marketplace fills in:

| Card holds | Where | The signed session must hold |
|---|---|---|
| `MARKER_PRINCIPAL` | `assets[principalAsset].maxTotal` (as `uint256`) | `principal` |
| `MARKER_PRINCIPAL` | `assets[principalAsset].maxPerCall` | `principal` |
| a number `n` | `assets[principalAsset].maxPerCall` | `n` (a "tranche" card, `test_MS20_openJob_trancheCard`) |
| a number | any field of any other asset | the same number |
| `MARKER_WALLET` | a pin's `value` (op EQ) | `bytes32(uint256(uint160(computeCEA(agw, cardChainHash))))` |
| `MARKER_PRINCIPAL` | a pin's `value` (op EQ or MAX) | `bytes32(principal)` |
| any other `bytes32` | a pin's `value` | the same value |

`MARKER_WALLET = keccak256("push.marketplace.marker.WALLET")` and
`MARKER_PRINCIPAL = keccak256("push.marketplace.marker.PRINCIPAL")`. Both have non-zero high 96 bits, so neither
is a clean address word (`test_naming_markers`).

**Approvals are allowed calls** (D1). There is no owner-approval list. The agent may call ERC-20 `approve` only
with the spender pinned to a fixed address and the amount capped by a `MAX` pin (a literal or
`MARKER_PRINCIPAL`). Several entries may share one `(target, selector)` with different pins ("approve to Aave or
to Uniswap"), but only if every one of them is pinned.

### 6.2 At registration: `validateAgentCardRules`

Decodes `AgentCardRules` (malformed bytes revert in `abi.decode` without data), then runs R1–R17 in this order;
the first failure reverts `InvalidAgentCard(reason)`. Each rule is checked over every item before the next rule.

| # | Check | Reason |
|---|---|---|
| R1 | `1 <= assets.length <= MAX_ASSETS` | `"asset count"` |
| R2 | `principalAsset < assets.length` | `"principal asset"` |
| R3 | every asset's `token != address(0)` | `"asset zero"` |
| R4 | no two assets share a token | `"duplicate asset"` |
| R5 | `assets[principalAsset].maxTotal == uint256(MARKER_PRINCIPAL)` | `"principal total not marker"` |
| R6 | `assets[principalAsset].maxPerCall != 0` | `"principal per-call zero"` |
| R7 | no other asset holds `MARKER_PRINCIPAL` in either cap | `"marker off principal asset"` |
| R8 | `1 <= allowedCalls.length <= 32` | `"allow-list size"` |
| R9 | `pins.length <= MAX_PINS` (8) per call, and `<= MAX_ALLOWED_CALL_PINS` (32) in total | `"too many pins"` |
| R10 | a pin holding `MARKER_WALLET` has `op == EQ` | `"wallet marker op"` |
| R11 | no two calls are byte-identical | `"duplicate call"` |
| R12 | two calls with the same `(target, selector)` are both pinned | `"unpinned duplicate"` |
| R13 | no `increaseAllowance` | `"increaseAllowance"` |
| R14 | `approve` has a pin `{4, EQ, v}`, `v` a non-zero clean address word (so never a marker) | `"approve spender not pinned"` |
| R15 | `approve` has a pin `{36, MAX, *}` | `"approve amount not capped"` |
| R16 | `transfer` binds its recipient to the user's account: beneficiary at 4, or a pin `{4, EQ, MARKER_WALLET}` | `"erc20 transfer recipient"` |
| R17 | `transferFrom` likewise at offset 36 | `"erc20 transferFrom recipient"` |

It returns every asset's token, which the marketplace then checks against the card's chain (§4.2, check 13). The
full table is in [`reference.md`](./reference.md#universalmarketplacerules).

### 6.3 At `openJob`: `checkRulesMatchCard`

In order; the first mismatch reverts.

| # | The session must… | Error |
|---|---|---|
| C1 | name the card's provider as its agent: `sessionValidatorInitData == abi.encode(provider)` | `AgentMismatch()` |
| C2 | have exactly one action | `ActionCount()` |
| C3 | with exactly one policy | `PolicyShape(0)` |
| C4 | whose `initData` starts with the word `ENVELOPE_VERSION`, read **before** any decode (0 if under 32 bytes) | `EnvelopeVersionMismatch(actual)` |
| C5 | and names the card's chain | `ChainMismatch(0)` |
| C6 | carry as many assets as the card | `AssetCountMismatch(expected, actual)` |
| C7 | with the card's tokens, in order | `AssetMismatch(i)` |
| C8 | with the principal asset's `maxTotal == principal`, and `maxPerCall == principal` (marker) or the card's number | `PrincipalCapMismatch()` |
| C9 | and every other asset's caps exactly the card's | `AssetMismatch(i)` |
| C10 | and the card's `maxGasPerCall` | `GasCapMismatch()` |
| C11 | and the card's allowed calls: same count, same target, selector, beneficiary fields, `maxValue`, pin count, and each pin's offset and op | `ActionsMismatch()` |
| C12 | with each pin's value equal to the card's, markers filled (table in §6.1) | `PinMismatch(call, pin)` |
| C13 | expiring with the job: `validUntil == expiredAt` | `ExpiryMismatch()` |
| C14 | paying only the AGW's own CEA on that chain: `expectedCEA == computeCEA(agw, chainHash)` | `ExpectedCEAMismatch(expected, actual)` |

C4 mirrors URP: a pre-v6 two-field envelope `(string, bytes)` has first word 64 (the string's offset), so it is
named `EnvelopeVersionMismatch(64)` instead of panicking the decoder (`test_MS22_envelopeVersion_named`). C11 and
C12 share one loop, per call and then per pin.

The session never carries a marker: C8 and C12 compare against the filled value, so a session holding the raw
marker fails (`test_MT09_match_pins`). D3 makes the principal caps exact: a per-call cap below the principal is
refused (`test_MB04_perCallMustEqualPrincipal`); the invariant `MI07` checks every granted `maxTotal` equals the
job's principal.

What C12 and C14 protect: the `MARKER_WALLET` pins and URP's beneficiary pins bind funds the agent moves to the
user's own CEA. The marketplace derives the CEA itself (§9); the SDK derives it independently from the
destination `CEAFactory`. A disagreement fails closed before anything happens.

Fields the helper does not compare, and why that is safe, are in §13.2.

---

## 7 · The criteria: card ⊆ job

### 7.1 Why they are built on-chain

If the SDK or relayer supplied the job's criteria, nothing would guarantee they are the card's: a relayer could
swap in easier ones. Instead, `openJob` builds the criteria from the card's **stored** `jobSpecTemplate` and the
job's inputs. The result goes into the `createJob` calldata, which the owner's intent hashes (`execCalldataHash`).
So the owner's single signature covers the exact criteria, and the marketplace re-derives them before executing.

### 7.2 What building does

`JobSpecBuilder.build(jobSpecTemplate, ctx)` fills the template's holes:

| Hole | Filled with |
|---|---|
| a `Fill` with source `CEA` in a read's args | the AGW's CEA **on that read's chain** |
| a `Fill` with source `PARAM` | one of the job's `params` (two's complement for negatives) |
| a check target `FIXED` | the template's value |
| a check target `PRINCIPAL_BPS` | `principal × bps / 10 000`, rounded down |
| a check target `PARAM` | one of the job's `params` |
| a check target `CEA` | the AGW's CEA on the check's read chain |
| `executeBy` | the job's `executeBy` |
| `failFinalAt` | `executeBy + card.settleWindow` |
| `origin` | `keccak256(abi.encode(marketplace, cardId, cardVersion, principal))` |

`logic` (the pass-logic tree), `allowedMutability` and every other read field are copied verbatim. The full format
and two worked examples are in [`criteria.md`](./criteria.md).

### 7.3 What building checks, and what it doesn't

The template is **not judged**. Building checks only what building needs:

| Check | Error |
|---|---|
| one param per template param | `ParamCountMismatch(expected, actual)` |
| each param inside its inclusive bounds | `ParamOutOfRange(index, value)` |
| each fill writes inside its read's args | `FillOutOfBounds(read, fill)` |
| `principal × bps` fits in uint256 | `TargetOverflow(check)` |
| a CEA is asked only for a chain with a CEA deployment | `ChainNotSupported(chainHash)` |

Anything else malformed reverts on its own when a job is built (an index out of range panics, undecodable bytes
fail in `abi.decode`). A template the evaluator could not run, such as a read no check uses or an unreachable
logic step, **builds without complaint** (`test_JB08_doesNotJudgeTheTemplate`). `allowedMutability` is carried,
not enforced: nothing in this repo reads it. The verified tag is the review.

---

## 8 · `openJob`, step by step

`openJob(OpenJobParams p)` is `whenNotPaused` and `nonReentrant`. **Every check runs before the first state
change**, so a refusal leaves no wallet, no grant and no job (`test_MS13_intentSessionMismatch_noStateOnFailure`,
`test_MS22_envelopeVersion_named`).

| Step | What | Code | Error on failure |
|---|---|---|---|
| 1 | Card exists and is active | `_checkCardAndJob` | `AgentCardInactive()` |
| 2 | `p.cardVersion` is the card's current version | `_checkCardAndJob` | `AgentCardVersionMismatch(provided, current)` |
| 3 | `principalMin ≤ principal ≤ principalMax` | `_checkJobWindows` | `PrincipalOutOfRange()` |
| 4 | `now + minDuration ≤ expiredAt ≤ now + maxDuration` | `_checkJobWindows` | `ExpiryOutOfRange()` |
| 5 | `executeBy ≥ now + minExecuteWindow` and `executeBy + settleWindow ≤ expiredAt` | `_checkJobWindows` | `ExecuteByOutOfRange()` |
| 6 | the card's provider is not the current evaluator (it may have changed since registration) | `_checkCardAndJob` | `ProviderIsEvaluator()` |
| 7 | `(agw, deployed) = AGW_FACTORY.predictWallet(intent.owner, intent.index)`; the intent names that wallet and this marketplace as executor | `_resolveWallet` | `IntentWalletMismatch(expected, provided)` · `ExecutorMismatch(expected, actual)` |
| 8 | the AGW has no active job opened here: `activeJobOf(agw) == 0` | `openJob` | `WalletHasActiveJob(agw, jobId)` |
| 9 | build the job's criteria from the card's `jobSpecTemplate` | `_buildCreateJob` → `JobSpecBuilder.build` | §7.3 errors |
| 10 | encode `createJob(provider, evaluator, expiredAt, description, hook)` as an ERC-7579 single execution: `abi.encodePacked(kernel, 0, call)` | `_buildCreateJob` | — |
| 11 | the intent's `mode`, `execCalldataHash` and `nonceKey` (`OPENJOB_LANE`) are exactly this execution, and its `sessionHash` is this session | `_bindIntent` | `IntentExecMismatch(expectedHash)` · `IntentSessionMismatch(expectedHash)` |
| 12 | the session is the card's rules with markers filled, `SessionContext{agent: provider, chainHash, principal, expiredAt, expectedCEA: computeCEA(agw, chainHash)}` (§6.3) | `_checkRules` → `RULES.checkRulesMatchCard` | C1–C14 errors |
| — | *first state change* | | |
| 13 | deploy the predicted wallet (`deployWalletWithSig`) and require it landed at the prediction; or, for an existing wallet, require the factory's `ownerOf` is the intent's owner | `_deployOrCheckOwner` | `AGWMismatch(expected, actual)` · `WalletOwnerMismatch(expected, actual)` |
| 14 | `rulesId = AGW.grantRulesWithSig(session, intent, sig)` | `openJob` | the AGW's own errors |
| 15 | `AGW.executeWithSig(MODE_SINGLE, calldata, intent, sig)`; exactly one new kernel job; its client is the AGW and its provider, hook and evaluator are the expected ones | `_createJob` | `UnexpectedJobCount(before, after)` · `JobMismatch()` |
| 16 | record `_lastJobOf`, `cardOfJob`, `agwOfJob`, `rulesOfJob`, `cardVersionOfJob`; emit `JobOpened(cardId, owner, agw, jobId, rulesId, principal, cardVersion)` | `openJob` | — |

`openJob` makes one `createJob` execution (`MODE_SINGLE`). It does not revoke a wallet's previous rules set.

**What one signature binds.** The owner signs one `OwnerIntent`. Through it:

| Bound value | How |
|---|---|
| principal, `executeBy`, params, card version, the wallet (through its CEA) | inside the built `JobSpec`, inside the `createJob` calldata → `execCalldataHash` |
| `expiredAt`, provider, evaluator, hook | `createJob` arguments → `execCalldataHash` |
| the rules (assets and caps, gas cap, calls and pins, CEA, expiry) | the `Session` → `sessionHash` |
| which wallet, which executor | `wallet`, `executor` fields |
| replay | `nonceKey` / `nonceSeq` (the owner lane) and `grantNonce`, checked by the AGW |

`test_MS12_intentExecMismatch_everyBoundInput` changes each bound input in turn and expects `IntentExecMismatch`.

**Who checks the signature.** Not the marketplace. The factory and the wallet verify the owner's signature
themselves and accept the intent only from its `executor` (this contract). The marketplace's own checks
(steps 7 and 11) mirror the wallet's, so a mismatch fails early with a named error before any state change.

**Previewing.** `previewIntent(request, session)` returns the exact `OwnerIntent` to sign: it predicts the wallet,
builds the same calldata `openJob` will, hashes it, and reads the wallet's live nonces (0 for a wallet not yet
deployed). `buildCreateJobCalldata` returns the execution itself. Both revert `AgentCardInactive` for an unknown
card, and both revert exactly as step 9 would on a bad template. `test_MV04_buildCreateJobCalldata` asserts that
what `openJob` executes equals this view's answer.

**Front-running.** `openJob` can be called by anyone holding the signed parameters; the relayer has no power. A
third party who submits them first opens exactly the job the owner signed. The AGW's nonces make it one-shot.

---

## 9 · Chains and CEAs

A card's chain must be configured before any card can name it:

- **`setCEADeployment(chainHash, ceaFactory, ceaProxyImpl)`** (admin) records the destination chain's CEA factory
  and proxy implementation. A chain without one cannot carry cards (`ChainNotSupported`), and the builder cannot
  ask for a CEA on it.
- **Clearing a chain.** `setCEADeployment(chainHash, 0, 0)` deletes the entry and emits
  `CEADeploymentSet(chainHash, 0, 0)`. Registration and update on that chain, `computeCEA`, and `openJob` on an
  existing card there then revert `ChainNotSupported(chainHash)`. Exactly one zero address reverts `ZeroAddress()`
  (`test_MV11_setCEADeployment_clear`).
- **`computeCEA(agw, chainHash)`** mirrors `CEAFactory._computeCEAInternal`: an OZ minimal proxy of
  `ceaProxyImpl`, salt `keccak256(abi.encode(agw))`, deployed by the CEA factory (`test_MV02_computeCEA` checks it
  against the real `CEAFactory`).
- **Push itself is never a card chain** (`PUSH_CHAIN_HASH`, set at `initialize` from `block.chainid`).

There is **no per-chain pause** any more (the `setUniversalPaused` / `isUniversalPaused` pair was removed; its
slot 14 is reserved and always zero; `test_MV14_noPerChainPause`).

**CEA implementation rotation.** If the destination rotates its CEA proxy implementation, `computeCEA` goes stale.
An SDK reading the destination factory then signs the new CEA (in the `MARKER_WALLET` pin and `expectedCEA`), and
`openJob` refuses it, first at the wallet pin (`PinMismatch(1, 0)` in the test fixture), until the admin updates
the deployment (`test_MV03_ceaRotation_staleCaught`). Runbook:

1. `pause()` stops registration, updates and `openJob` marketplace-wide.
2. Rotate the implementation on the destination chain.
3. `setCEADeployment(chainHash, factory, newImpl)`.
4. `unpause()`.

An intent signed before the rotation names the old CEA in its criteria, so after step 3 it fails
`IntentExecMismatch` and must be re-signed. The CEA value is security-relevant: it is the wallet pin and expected
CEA of every rules grant on that chain (§6.3 C12, C14). A wrong entry still cannot silently redirect funds,
because the SDK derives the CEA independently and the two must agree.

---

## 10 · One live job per wallet

Two rules, at two moments, read through two views named `activeJobOf`:

| View | Where | Returns the job id while | Used by |
|---|---|---|---|
| `UniversalMarketplace.activeJobOf(agw)` | marketplace | the last job **opened here** for the AGW is Funded, Submitted, or Open and not yet expired; else 0 | `openJob` step 8 (`WalletHasActiveJob(agw, jobId)`) |
| `RulesBindingHook.activeJobOf(agw)` | hook | the AGW's last job **bound by the hook** is Funded or Submitted; else 0 | `fund` (`AGWHasLiveJob(agw, jobId)`) |

The difference is intended: the marketplace binds at `openJob`, so an Open, unexpired job also blocks and a user
cannot stack unfunded jobs on one wallet; the hook binds at `fund`, so it only sees funded jobs. An Open job frees
the wallet once it expires or is rejected; a Funded or Submitted job frees it once it is completed, rejected or
refunded (`test_MS14_oneLiveJob`, `test_MS21_activeJobOf`, hook `test_activeJobOf_returnsId`).

Jobs created directly on the kernel, not through the marketplace, are invisible to the marketplace's
`activeJobOf`. The hook's rule still covers any job that names the hook.

---

## 11 · Admin powers

Roles (OpenZeppelin AccessControl): `DEFAULT_ADMIN_ROLE` manages roles; `ADMIN_ROLE` runs every admin function.
Both go to `InitParams.admin`. Upgrades are separate: they belong to the ProxyAdmin owner.

| Function | Effect | Limits |
|---|---|---|
| `setHook(hook)` | hook of every **new** job | must be non-zero and whitelisted on the kernel; existing jobs keep theirs |
| `setEvaluator(evaluator)` | evaluator of every **new** job | non-zero; a card whose provider is the new evaluator can't open jobs (`ProviderIsEvaluator`) |
| `setCEADeployment(chainHash, factory, impl)` | enables a chain and sets its CEA derivation, or clears it with `(h, 0, 0)` | exactly one zero reverts |
| `setAgentRating(agent, rating)` | sets an agent's rating, read by `getAgentRating` | no validation; a placeholder until VerifiedRatings is wired |
| `pause()` / `unpause()` | stops or resumes `registerAgentCard`, `updateAgentCard`, `openJob` | admin functions, `setAgentCardActive` and views stay live |
| `disableAgentCard(cardId)` | permanently disables a card | cannot re-enable; the provider stays registered |
| `verifyAgentCard(cardId, cardVersion)` / `revokeAgentCardVerification(cardId)` | the verified tag | version-bound |

The admin cannot move funds (the marketplace holds none), cannot change an opened job (the kernel fixed its
provider, evaluator, hook and description at creation), and cannot re-enable a disabled card.

The admin **can** influence future jobs: the evaluator decides completion, and the hook gates funding. Both are
trust points of the deployment.

---

## 12 · Deployment, upgradeability and build

### 12.1 AGW dependency

The package compiles against AGW v6 source: the submodule [`lib/push-agentic-wallets`](../../lib/push-agentic-wallets),
pinned at commit `ffd567d3e49b2d27c6f50ad36093274dbac3090f` (branch `deploy-agw`), with the remapping
`@push-agw/=lib/push-agentic-wallets/src/`. AGW v6 on Donut was deployed from that same commit.

- Imported by name from `@push-agw/libraries/Types.sol` (a file with no imports): `OwnerIntent`,
  `OWNER_LANE_FLAG`, `AssetCap`, `AllowedCall`, `ArgPin`, `PinOp`, `UniversalTerms`, `ENVELOPE_VERSION`,
  `MAX_ASSETS`, `MAX_PINS`, `MAX_ALLOWED_CALL_PINS`; the fork test also imports the EIP-712 constants and
  `SEND_OUTBOUND_SELECTOR`. A struct change in the AGW fails this build, not `openJob`.
- `Session` and its parts stay a mirror in `IAGW.sol` (the vendor SmartSession tree cannot be compiled here). The
  fork test pins it: a wrong mirror changes the session hash and the real wallet refuses the grant.
- Donut v6 addresses are deploy-time inputs and test constants; nothing in `src/` hard-codes them.

### 12.2 Wiring

1. Deploy `UniversalMarketplaceRules` (no constructor arguments).
2. Deploy the `JobSpecBuilder` library and link it into `UniversalMarketplace`. Foundry links it automatically in
   tests and scripts.
3. Deploy the `UniversalMarketplace` implementation; its constructor disables initializers.
4. Deploy a `TransparentUpgradeableProxy` calling `initialize(InitParams{agwFactory, kernel, hook, evaluator,
   rules, admin})`. `agwFactory`, `kernel`, `rules`, `admin`, `hook` and `evaluator` must be non-zero, and the
   hook must be whitelisted on the kernel.
5. `setCEADeployment` for each supported destination chain.

Interim configuration (until the V2 UniversalHook and UniversalEvaluator ship): `hook` = RulesBindingHook,
`evaluator` = a Push-controlled address.

### 12.3 Upgradeability

- **The marketplace** sits behind a `TransparentUpgradeableProxy`. Its storage is append-only (slots 0–21, slot 14
  reserved, then a 27-slot gap, 22–48; see [`reference.md`](./reference.md#storage-layout)). OZ upgradeable bases
  use ERC-7201 namespaced storage, so they don't occupy these slots. `test_MV09_storageLayout_bySlot` pins every
  slot by position, and `test_MV10_upgrade_preservesState` upgrades through the ProxyAdmin. v1 was never
  deployed, so there is no migration from it. v2 is live on Donut (§12.5): from now on every upgrade must keep
  this layout.
- **The rules helper and JobSpecBuilder** are not upgradeable. A rule change is a new deployment plus a
  marketplace upgrade that points at it. The helper is an `initialize`-time address (`RULES`); the library's
  address is linked into the implementation's bytecode.

### 12.4 Deploy script

[`scripts/agentic-commerce-8183/DeployUniversalMarketplace.s.sol`](../../scripts/agentic-commerce-8183/DeployUniversalMarketplace.s.sol)
deploys the whole stack in one run and follows §12.2:

1. `AgenticCommerce` (kernel) proxy, `initialize(pUSDC, treasury, deployer)`.
2. `RulesBindingHook` proxy, `initialize(kernel, AGW v6 factory, AGW v6 session engine)`, then
   `kernel.setHookWhitelist(hook, true)`.
3. `UniversalMarketplaceRules`; the `JobSpecBuilder` library is deployed and linked by Foundry.
4. `UniversalMarketplace` proxy, `initialize` with the deployer as `admin` and as `evaluator`.
5. `setCEADeployment` for Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia and BSC Testnet.

Each proxy gets its own ProxyAdmin, owned by the deployer. Fees stay zero. Inputs come from `.env`: `DEPLOYER_KEY`
(the broadcaster) and `TREASURE_KEY` (its address becomes the kernel's platform treasury); both are accepted with or
without the `0x` prefix. The script refuses any chain other than Donut (42101).

```bash
forge script scripts/agentic-commerce-8183/DeployUniversalMarketplace.s.sol \
  --rpc-url $PUSH_CHAIN_TESTNET_RPC_URL --broadcast --slow
```

### 12.5 Live deployment (Push Donut)

Full table: [`docs/addresses/push_donut_universal_marketplace.md`](../addresses/push_donut_universal_marketplace.md).

| Contract | Proxy |
|---|---|
| UniversalMarketplace | `0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4` |
| AgenticCommerce (kernel, pUSDC `0x7A58048036206bB898008b5bBDA85697DB1e5d66`) | `0x977cf1AC973E9eC4332791d531507575006157Ed` |
| RulesBindingHook | `0xDe7A94e510b6C571DE7880d441349689F73A32b3` |
| UniversalMarketplaceRules (not a proxy) | `0x5b98A8E0df5b918DF76cD2BE84bA7995B39dfd44` |
| JobSpecBuilder (library) | `0x2de1e3F053b0bBa0cE0C6953144534a0b055f59e` |

- **Its own kernel.** The stack does not use the `marketplace_demo` kernel (`0x4F9b…B1E0`) or its UniversalEvaluator
  (`0x7D62…4Ce3`). That kernel is priced in eUSD, its admin is not ours, its evaluator accepts only jobs created
  with its own UniversalHook, and that evaluator decodes a different `JobSpec` layout from `JobSpecTypes.sol`.
- **Evaluator is an EOA.** The deployer `0x1afC81396f1bb36F91f74506284952b81e4bd47c` completes or rejects jobs by
  hand until a compatible evaluator is set with `setEvaluator` (and, if it needs its own hook, `setHook`).
- **Moving to another kernel.** `KERNEL` is set once at `initialize` and has no setter. Pointing the marketplace at
  a different kernel takes a marketplace upgrade or redeploy plus a new RulesBindingHook whitelisted on that kernel.
  Jobs already opened stay on the old kernel.
- Contracts are not source-verified on the explorer.

### 12.6 Build configuration

- solc 0.8.26, `via_ir`, EVM `shanghai`.
- **`UniversalMarketplace.sol` compiles at 1 000 optimizer runs**; every other contract uses 99 999. This is the
  `compilation_restrictions` entry in `foundry.toml`. At 99 999 runs the inliner puts the marketplace over the
  EIP-170 limit.
- Coverage must run with `FOUNDRY_PROFILE=coverage`, which drops that restriction. Otherwise contracts tested
  from both compile jobs exist twice, and coverage keeps the hits of only one.

| Contract | Runtime size | Margin to EIP-170 |
|---|---|---|
| UniversalMarketplace (1 000 runs) | 22,156 B | 2,420 B |
| UniversalMarketplaceRules | 9,376 B | 15,200 B |
| JobSpecBuilder | 6,352 B | 18,224 B |
| RulesBindingHook | 4,499 B | 20,077 B |

---

## 13 · Trust model and security notes

### 13.1 What the marketplace guarantees

| Guarantee | Enforced by | Tested by |
|---|---|---|
| The rules granted are exactly the card's, markers filled, for the card's agent, bound to this job's principal, expiry and CEA | `checkRulesMatchCard` (§6.3) | `MB01`–`MB04`, `MT07`–`MT11`, `MS19`, `MS20`, `MI07`, fork test |
| The job's criteria are exactly the card's template, filled with this job's inputs | `_buildCreateJob` + intent binding (§7, §8) | `MS01`, `ML13`, `MV04`, `MC01`–`MC05` |
| The job is created by the user's own wallet, with the card's provider, the configured evaluator and hook | `_createJob` | `MS15` |
| A provider can't change a card under a user's signature | card version in `origin` | `ML11` |
| One card per provider | `agentCardOf` | `MR11`, `MI06` |
| Nothing moves through the marketplace | no transfer code; no payable function | `MS02`, `MI02`, `MI05` |
| One active job per wallet | `activeJobOf` (§10) | `MS14`, `MS21`, `MI01` |
| Every refusal happens before any state change | step order (§8) | `MS13`, `MS22` |

### 13.2 What the marketplace relies on, or does not check

1. **The AGW and its factory verify the owner's signature** and accept the intent only from its executor. They
   also enforce deadlines, nonces and the signer chain. The marketplace's mirror checks only name the error
   early. The unit suites use `MockAGW` / `MockAGWFactory`, which verify no signature; the fork test
   `test_fork_openJob_realAGWv6` runs the real AGW v6 stack on Donut with a real owner signature.
2. **SmartSession and URP enforce the rules at execution.** The marketplace checks the rules' *content* at grant
   time; it does not execute or watch them.
3. **Session fields the helper does not compare are pinned by the AGW.** The helper never compares the
   `sessionValidator`, the policy address, the action target and selector, `userOpPolicies`, `erc7739Policies`,
   `permitERC4337Paymaster` or `salt`. AGW v6 `_grantRules` refuses the grant unless: `userOpPolicies`, both
   ERC-7739 lists are empty and `permitERC4337Paymaster` is false (`MalformedSessionShape`); a universal rules set
   has exactly one action, targeting `UNIVERSAL_GATEWAY_PC` with `SEND_OUTBOUND_SELECTOR` (`RulesTypeMismatch`);
   that action has one policy, which is URP; `sessionValidator == SESSION_VALIDATOR` and
   `validateConfig(sessionValidatorInitData)` passes; and it overwrites `salt` with its grant nonce. URP then
   refuses an envelope whose first word is not `ENVELOPE_VERSION`, an empty or oversized allow-list, a past or
   zero `validUntil`, a zero `expectedCEA`, too many pins, and 0 or more than 8 assets, duplicates, or an asset
   whose `SOURCE_CHAIN_NAMESPACE()` is not the envelope's chain. The question left open in v1 is therefore
   closed: pinning these fields in the marketplace would duplicate the wallet's own checks.
4. **The criteria are not judged** (§7.3). A provider can register criteria the evaluator cannot run, or that
   are trivially satisfied. The verified tag is the review, and the SDK must render every check in words before
   the user signs.
5. **The asset check is a sanity check, not a security property.** The asset contract chooses its own
   `SOURCE_CHAIN_NAMESPACE()` answer. What binds the assets is URP: the session's assets must equal the card's.
6. **`providerFee` is a reference price.** The marketplace never enforces it; the kernel does, at `fund`, through
   the owner's `expectedBudget`.
7. **`createJob`'s `description` and `expiredAt` are not re-read after creation.** Step 15 checks the new job's
   client, provider, hook and evaluator. The description and expiry are trusted to the AGW executing exactly the
   signed calldata (its `execCalldataHash` check).
8. **The evaluator and hook are admin-set trust points** for new jobs (§11).
9. **`MARKER_PRINCIPAL` on a non-principal token's `approve` is not detectable.** The helper requires an
   `approve`'s amount to be capped (R15) but cannot check that a `MARKER_PRINCIPAL` cap sits on the principal
   token's `approve`: `IPRC20` has no source-token view, so a PRC20 cannot be mapped to its destination token.
   The verified tag covers it.

### 13.3 Reentrancy and external calls

`openJob` is `nonReentrant` and makes its external calls only after every check:

1. `AGW_FACTORY.deployWalletWithSig`, a factory the deployment chose;
2. `AGW.grantRulesWithSig`, `AGW.executeWithSig`, on the predicted wallet;
3. `KERNEL.jobCounter`, `KERNEL.getJob`.

Before them, the checks read `AGW_FACTORY.predictWallet`, `KERNEL.getJob` (for `activeJobOf`) and call the pure
`RULES` helper. The wallet is the factory's deterministic deployment for the intent's owner, re-checked by
`AGWMismatch` / `WalletOwnerMismatch`. The marketplace holds no value, so a reentrant path has nothing to drain.
Registration also calls `KERNEL.paymentToken()` and each asset's `SOURCE_CHAIN_NAMESPACE()`.

### 13.4 Known limitations of v2

| Limitation | Note |
|---|---|
| **EVM destinations only** | Cards name `eip155:*` chains, never Push. Solana and native (Push-side) cards are out of scope. |
| **One payment token** | Until kernel K-12, every card's `paymentToken` must be the kernel's token (pUSDC on the Donut deployment). |
| **Kernel is fixed** | `KERNEL` has no setter; changing kernels needs an upgrade or redeploy (§12.5). |
| **Interim hook and evaluator** | RulesBindingHook and a Push-controlled evaluator until the V2 UniversalHook and UniversalEvaluator ship. The `JobSpec` description and its `allowedMutability` are inert to RulesBindingHook. |
| **No revoke of a previous grant** | `openJob` on an existing wallet grants a new rules set; the previous one is not revoked by the marketplace. |
| **Rating is a placeholder** | `setAgentRating` / `getAgentRating` store an admin number until VerifiedRatings is wired. |
| **A card can be internally inconsistent** | Registration checks `minExecuteWindow + settleWindow ≤ maxDuration` only. A card whose `minDuration` is shorter than that sum simply can't open jobs at its shortest expiry (`ExecuteByOutOfRange`). |
| **Error decoding** | Each contract's ABI lists only the errors it raises itself. Decode marketplace reverts, including rules-helper and builder errors that bubble through `openJob`, with the `UniversalMarketplaceErrors` artifact, which lists all 40. |

---

## 14 · Invariants

Fuzzed by [`UniversalMarketplace.invariants.t.sol`](../../test/8183-tests/UniversalMarketplace.invariants.t.sol):
64 runs × depth 100 per invariant. The handler opens jobs through honest and misbehaving wallets, registers cards
from three providers, updates the card, cancels jobs and moves time.

| Invariant | Property |
|---|---|
| `MI01_activeJobIsTheAgwsOwnJob` | `activeJobOf(agw)` is 0 or a job whose client is that AGW |
| `MI02_marketplaceHoldsNothing` | The marketplace's token, rules-asset and native balances are always 0 |
| `MI03_outcomesExactlyExpected` | An honest open on a free wallet always succeeds; a misbehaving wallet (two jobs, foreign client) is always refused with its own named error |
| `MI04_everyJobIsWellFormed` | Every opened job's description decodes as a `JobSpec` with the recorded `origin`, and has the configured evaluator and hook |
| `MI05_userBalanceNeverMovedByOpenJob` | The user's tokens and PC never change |
| `MI06_onePerProvider` | `agentCardOf[p]` is 0 or a card whose provider is `p`; no two cards share a provider; a second registration is always refused with `AgentCardAlreadyRegistered` |
| `MI07_principalCapEqualsPrincipal` | For every opened job, the granted rules' `assets[principalAsset].maxTotal` equals that job's principal |
| `afterInvariant` | Liveness: at least one honest open and one refused misbehaviour happened, so none of the above held vacuously |

---

## 15 · Tests

`forge test --match-path 'test/8183-tests/*' --no-match-contract 'Invariants|ForkTest'`: 247 tests, all passing.
The invariant suites and both fork tests pass too. The marketplace-related suites:

| Suite | Tests | Covers |
|---|---|---|
| [`UniversalMarketplace.t.sol`](../../test/8183-tests/UniversalMarketplace.t.sol) | 68 | Registration (MR01–MR14), card lifecycle (ML01–ML13), `openJob` (MS01–MS22), rules = card through the marketplace (MB01–MB04), views, admin, initialize, storage layout, upgrade, CEA clearing, rating, version, no per-chain pause (MV01–MV14) |
| [`UniversalMarketplaceRules.t.sol`](../../test/8183-tests/UniversalMarketplaceRules.t.sol) | 11 | The helper directly: R1–R17 (MT01–MT06), each C1–C14 error with exact arguments (MT07–MT09), malformed input (MT10), fuzzed principal binding (MT11) |
| [`JobSpecBuilder.t.sol`](../../test/8183-tests/JobSpecBuilder.t.sol) | 12 | Fills, targets, timing and origin, params, overflow, fill bounds, unsupported chains, "does not judge", fuzz, `logic` and `allowedMutability` copied (JB12) |
| [`UniversalMarketplace.conformance.t.sol`](../../test/8183-tests/UniversalMarketplace.conformance.t.sol) | 5 | Built criteria equal the V2 design doc's examples, field by field; every built read decodes in a copy of the V2 evaluator's decoder; the `JobSpec` ABI field order (MC05) |
| [`UniversalMarketplace.invariants.t.sol`](../../test/8183-tests/UniversalMarketplace.invariants.t.sol) | 7 | §14 |
| [`UniversalMarketplace.fork.t.sol`](../../test/8183-tests/UniversalMarketplace.fork.t.sol) | 1 | `openJob` against the real AGW v6 on Donut: fresh wallet, fund through the hook, refusal while Funded, existing-wallet path, pre-v6 envelope named |
| [`Naming.t.sol`](../../test/8183-tests/Naming.t.sol) | 8 | Every function, event and error of the v2 surface pinned to literal signatures; marker values; no retired names in ABIs |
| [`RulesBindingHook.t.sol`](../../test/8183-tests/RulesBindingHook.t.sol) | 32 | The interim hook, including `activeJobOf` returning the id |
| [`RulesBindingHook.fork.t.sol`](../../test/8183-tests/RulesBindingHook.fork.t.sol) | 1 | The factory and engine interfaces against Donut v6 |

The two fork tests skip unless `PUSH_CHAIN_TESTNET_RPC_URL` is set. Both were run against Donut at block
24310581 and passed.

Unit fixtures use the real kernel, the real RulesBindingHook, the real rules helper and builder library, and the
real `CEAFactory`. The AGW factory and wallet are mocks: they enforce the rules the marketplace relies on
(executor, hashes, nonces), decode the policy envelope as the real wallet does, and verify no signature.
`MockAGW` has misbehaving modes (two jobs, foreign client, rewritten evaluator) to test the marketplace's
post-creation checks. Shared fixtures for card rules and the SDK's session filling are in
[`helpers/RulesFixtures.sol`](../../test/8183-tests/helpers/RulesFixtures.sol).

**Coverage** (`FOUNDRY_PROFILE=coverage`, `--ir-minimum`, gas test excluded):

| Contract | Lines | Statements | Branches | Functions |
|---|---|---|---|---|
| UniversalMarketplace | 97.63% (247/253) | 98.14% (317/323) | 100% (52/52) | 100% (37/37) |
| UniversalMarketplaceRules | 100% (132/132) | 100% (253/253) | 100% (39/39) | 100% (12/12) |
| JobSpecBuilder | 98.28% (57/58) | 98.80% (82/83) | 100% (12/12) | 100% (7/7) |
| RulesBindingHook | 96.43% (27/28) | 96.97% (32/33) | 100% (6/6) | 100% (6/6) |

Every uncovered line is executed by the tests but not attributed by `--ir-minimum`:

| File:line | Code | Executed by |
|---|---|---|
| `UniversalMarketplace.sol:98` | `_disableInitializers()` (constructor) | every test that deploys the implementation; `test_MV08_initialize` asserts its effect |
| `UniversalMarketplace.sol:107-109` | `__AccessControl_init()`, `__Pausable_init()`, `__ReentrancyGuard_init()` | every `initialize` |
| `UniversalMarketplace.sol:165`, `:170` | `_pause()`, `_unpause()` | `test_MV07_pause` |
| `RulesBindingHook.sol:40` | `_disableInitializers()` (constructor) | every hook deployment |
| `JobSpecBuilder.sol:106` | the inline `mstore` of a fill | every build with a fill; `test_JB01_fills` asserts the written words |

**Mutation testing.**

30 hand-written mutants, each applied to the source, run against one suite, then restored from a backup outside
`src/`. **30 killed, 0 survived.**

| Group | Mutants | Suite | Result |
|---|---|---|---|
| Registration guards R1–R17, each check removed | 17 | `UniversalMarketplaceRules.t.sol` | 17 killed (MT02–MT06) |
| Rules = card C4, C6–C12, each check removed | 8 | `UniversalMarketplaceRules.t.sol` | 8 killed (MT08, MT09, MT11) |
| Marketplace: the `agentCardOf` check, the `paymentToken` guard, `<` → `<=` in `activeJobOf`'s Open-expiry comparison, the `delete` in `setCEADeployment`'s both-zero branch, the `cardVersionOfJob` write | 5 | `UniversalMarketplace.t.sol` | 5 killed (MR11, MR12, MS14, MV11, ML12) |

Several mutants were killed by a wrong-error assertion rather than a missing revert, for example R2 (the decoder
panics on the out-of-range index instead of `InvalidAgentCard("principal asset")`) and C4 (a pre-v6 envelope
panics in `abi.decode` instead of `EnvelopeVersionMismatch(64)`): every negative test names its exact error.

**Gas ceilings** (`test_MS18_gasCeilings`, mock wallet and factory, two-asset card): `registerAgentCard`
≤ 2.70 M (measured 2,564,983), `openJob` on a fresh wallet ≤ 4.45 M (4,231,625), on an existing wallet ≤ 1.89 M
(1,797,405). The v1 ceilings were 2.46 M / 3.49 M / 2.09 M. Both `openJob` figures include `MockAGW` storing the
granted policy `initData` for the tests. `registerAgentCard` is dominated by storing the two content blobs;
`openJob` by the wallet deploy and the kernel storing the description.

---

## 16 · Reviewer checklist

Where to look first:

1. **`openJob` ordering** (§8): every check before the first state change; the intent's `execCalldataHash`
   covers everything per-job.
2. **`checkRulesMatchCard` completeness** (§6.3, §13.2 item 3): the C1–C14 order, the envelope version read before
   decoding, and marker filling in C8 and C12.
3. **Registration guards** (§6.2): R1–R17, especially the approve rules R14–R15 and the duplicate rules R11–R12.
4. **CEA derivation** (§9): `computeCEA` against `CEAFactory`; the rotation runbook; clearing a chain.
5. **`JobSpecBuilder`** ([`criteria.md`](./criteria.md)): the only inline assembly (`mstore` of a fill) and its
   bounds check; the PRINCIPAL_BPS overflow argument; the `DELEGATECALL` context (`address(this)` is the
   marketplace).
6. **`_requireAssetOnChain`**: the raw `staticcall` ABI-shape check, now run for every asset.
7. **Storage layout and upgrade safety** (§12.3, [`reference.md`](./reference.md#storage-layout)).
8. **Admin trust points** (§11): evaluator, hook, CEA deployments.
9. **The interim hook** (`RulesBindingHook`): the `fund`-time binding and its `activeJobOf`.
10. **The AGW dependency** (§12.1): the submodule commit and what is imported versus mirrored.
