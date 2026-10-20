# 2. Universal Marketplace

<aside>
🏪

**Where we are going.** `UniversalMarketplace` at its permanent Donut address, named like the rest of the Push codebase, carrying multi-asset rules, the criteria mutability flag and a per-card payment token: a registry of agent cards plus one entry point, `openJob`, that on a single owner signature deploys the wallet if needed, grants the card's rules and creates the 8183 job with the criteria built on-chain. It moves no funds.

**What this page is.** The one thing that breaks on the AGW redeploy, the decisions taken against the team's build, the rename map, the structural changes, and the contract surface as a diff. The team's reviewer docs (README, reference, criteria) live in the repo under `docs/universalmarketplace/`; the public narrative is [ERC-8183 x Push: Trust Layer](https://app.notion.com/p/ERC-8183-x-Push-Trust-Layer-3f4188aea7f48036a26bc8b58e748cf1?pvs=21).

**Status.** BUILT on `push-chain-core-contracts` branch `universalMarketplace_v1` (236 tests, invariants, mutation run). Not deployed. Priority P2 behind the AGW redeploy. SDK surface on [6. SDK: Universal Marketplace](6%20SDK%20Universal%20Marketplace%203ea188aea7f481e2961ed97129f3a4e6.md).

</aside>

# 0. Before anything else: the marketplace breaks when the AGW redeploys

**What happens.** The AGW is moving to multi-asset rules (`assets: AssetCap[]`, `maxGasPerCall`; [1. AGW Contract Changes (nomenclature standard + change set)](1%20AGW%20Contract%20Changes%20(nomenclature%20standard%20+%20ch%203e9188aea7f4813aa31fc95ceb4e684d.md) section 4c). The marketplace still carries the old single-asset shape in two places: the card's rule terms (`RulesCardTerms { asset, maxPCPerCall, ... }`) and a hand-copied mirror of the AGW's `UniversalTerms` in `interfaces/external/IAGW.sol`. Its rules check compares the signed session field by field against that shape.

**What breaks.** The day the new AGW is on Donut, every `openJob` fails at `grantRulesWithSig`: the session the marketplace accepted is not one the wallet will store.

**Fix.** Item 1 in section 4 and the diff in 4b, shipped in the same window as the AGW. The rules helper is not upgradeable, so this is a redeploy of the helper plus a marketplace upgrade pointing at it. Same rule as page 1 section 0: import the AGW's types from its package instead of copying them, so the next struct change fails the build and not `openJob`.

# 1. What the marketplace is, in one paragraph

An agent lists what it will do, under which rules, judged how (an agent card: listing, rules, job spec template). A user picks a card, sees it in words, signs once; `openJob` deploys the user's agentic wallet if needed, grants it exactly the card's rules bound to this job, and creates the 8183 job with the wallet as client and the criteria built from the card's template. The marketplace moves no funds and holds none: the user deposits into the wallet from any chain, the provider prices with `setBudget`, the wallet funds with `fund`, the agent acts within the rules, the evaluator rules ([3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md), [4. Universal Evaluation](4%20Universal%20Evaluation%203e9188aea7f4817bb03ef4c78c883f8b.md)). Phase 2 (users post, agents bid) is a separate proposal: [Proposal: Open Jobs and Budget Proposals for ERC-8183](https://app.notion.com/p/Proposal-Open-Jobs-and-Budget-Proposals-for-ERC-8183-3f4188aea7f481cdad84fdd7a446ab7b?pvs=21).

# 2. Decisions

| # | Decision | Outcome |
| --- | --- | --- |
| M1 | Scope of the one call | **Deploy or reuse the wallet, grant the rules, create the job. Nothing else.** No funds move, no approvals run, no escrow is touched. Funding is a plain transfer to the wallet from any chain, later. The job is Open with budget 0 when the call returns. (2026-10-01, matches the build.) |
| M2 | One signature | **The AGW's `OwnerIntent`**, signed once under the factory's EIP-712 domain with the signer's home chain id, presentable only by the marketplace (`intent.executor`). The factory and the wallet verify the owner; the marketplace mirrors the checks for early named errors. Works for a Push EOA owner too. Replaces the three WithSig variants once planned on page 1. |
| M3 | Criteria | **Built on-chain from the card's stored template** (`JobSpecBuilder`), so a relayer or SDK cannot swap in easier criteria, and the result sits inside the `createJob` calldata the owner signs. `reads` (what to look at), `checks` (how to compare), `logic` (how checks combine; was `nodes`). The template is stored as given and not judged; the verified tag is the review; the SDK renders every check in words before the signature. |
| M4 | Criteria mutability | **`AllowedMutability allowedMutability` on `JobSpec` and on the template** (NONE, CLIENT, PROVIDER, BOTH; named `Mutability mutability` until 2026-10-12). `PROVIDER` means a whole replacement spec may be proposed at `setBudget`; the evaluator refuses changes to `origin` and to `allowedMutability` itself; the client accepts by funding. Shared wire format with the evaluator; lands in both repos together. (2026-10-06, 2026-10-07) |
| M5 | Rules on the card | **Multi-asset.** `AgentCardRules { assets[], principalAsset, maxGasPerCall, allowedCalls, approvals }`. The rules check binds the principal asset's total to the job's principal and compares every other cap byte for byte. Follows the AGW decision of 2026-10-05. |
| M6 | Payment token | **`Card.paymentToken`, inherited by the job.** Requires the kernel to take the token at `createJob` (K-12 on [3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md)); until then cards are priced in the kernel's one token. (2026-10-09) |
| M7 | Approvals | **The owner's, never the agent's.** The card lists the ERC-20 allowances the job needs on the execution chain; the helper rejects `approve` and `increaseAllowance` in any agent allow-list (the universal rulebook pins only the receiving address, not the spender). The owner makes them through the wallet's owner door, a cross-chain call that must land before the agent's first call; the SDK bundles them into the deposit. Nothing on-chain verifies they ran. v1. |
| M8 | Destination account check | **Keep, as `computeCEA`.** The signed rule names the account on the destination chain that must receive what the agent deposits and that the criteria read. The marketplace derives that address itself (fixed formula over the wallet address plus the chain's CEA factory and proxy implementation, registered by the admin) and refuses a rule naming anyone else's. Later this check may move into URP at grant time, covering every grant; URP is over the size limit now. The rule field stays `expectedCEA`. |
| M9 | Session fields the marketplace does not compare | **No marketplace code.** Validator, policy address, action target and selector, and the extra policy lists are pinned by the AGW at `grantRules`, which runs before any marketplace state write. One line in the repo doc closes the team's open question. |
| M10 | Per-chain pause | **Removed.** It only gated `openJob` for one destination during a CEA rotation, which already fails closed (`ExpectedCEAMismatch`). The marketplace owns no per-chain switch; `pause()` and `unpause()` are its only pause. `setCEADeployment(chainHash, 0, 0)` may clear a chain to `ChainNotSupported`. |
| M11 | Hook and evaluator | **Separate contracts.** The rules hook maps job to wallet rules and exists only on Push; the evaluator is directly callable so a developer with their own hook or no AGW can use it. (2026-10-06) |
| M12 | Provider identity and rating | **Open registration, no stake, `getAgentRating(agent)` placeholder** returning the admin's dummy value until `VerifiedRatings.sol` is wired. No registration fee exists in the code; the kernel's `platformFee` at `complete` is the only fee. |
| M13 | The noun | **`AgentCard`, full word everywhere in code.** The stack already says "agent card"; A2A's Agent Card is the same family of object (ours carries rules and criteria and is on-chain), one doc line states the difference. `Listing` rejected. `cardId` stays as the short id. |

# 3. Rename map (current to proposed)

| Area | Today | Proposed |
| --- | --- | --- |
| Inherited names (SmartSession, AGW) | `Session`, `session`, `SessionContext`, `OwnerIntent`, `IntentSessionMismatch`, `UniversalTerms` | unchanged: the AGW's own ABI says `grantRules(Session session)`, so the marketplace says `session` too |
| Entry point | `startJob`, `StartJobParams`, `JobStarted` | `openJob`, `OpenJobParams`, `JobOpened` (the job is Open, not started; start is `fund`) |
| Helper contract | `UniversalMarketplaceTerms`, `TERMS()`, `InitParams.terms` | `UniversalMarketplaceRules`, `RULES()`, `InitParams.rules` |
| Card rules | `RulesCardTerms`, `rulesTerms`, `_rulesTerms`, `validateRulesTerms`, `verifySession` | `AgentCardRules`, `rules`, `_agentCardRules`, `validateAgentCardRules`, `checkRulesMatchCard` |
| Criteria | `evaluation`, `_evaluations`, `evaluationHash`, `EvaluationTemplate` | `jobSpecTemplate`, `_jobSpecTemplates`, `jobSpecHash`, `JobSpecTemplate` (prose: "criteria"; one noun with the evaluator's `JobSpec`, decided 2026-10-12) |
| Card functions | `registerCard`, `modifyAgentCard`, `setCardActive`, `adminDisableCard`, `verifyAgentCard`, `revokeAgentCardVerification`, `getCard` | `registerAgentCard`, `updateAgentCard`, `setAgentCardActive`, `disableAgentCard`, `verifyAgentCard`, `revokeAgentCardVerification`, `getAgentCard` |
| Card views and types | `isCardVerified`, `isCardAdminDisabled`, `cardVersion`, `cardCount`, `CardView` | `isAgentCardVerified`, `isAgentCardDisabled`, `agentCardVersion`, `agentCardCount`, `AgentCardView` |
| Card events | `CardRegistered`, `CardModified`, `CardStatusChanged`, `CardDisabledByAdmin`, `CardVerified`, `CardVerificationRevoked` | `AgentCardRegistered`, `AgentCardUpdated`, `AgentCardStatusChanged`, `AgentCardDisabled`, `AgentCardVerified`, `AgentCardVerificationRevoked` |
| Card errors | `CardInactive`, `CardAdminDisabled`, `CardVersionMismatch`, `InvalidCard(reason)`, `CardIdentityImmutable` | `AgentCardInactive`, `AgentCardDisabled`, `AgentCardVersionMismatch`, `InvalidAgentCard(reason)`, `AgentCardIdentityImmutable` |
| Fee | `fee` | `providerFee` (the kernel's `platformFee` is the other fee) |
| Live job | `isAGWFree(agw) returns (bool)`, `lastJobOf(agw)`, `AGWBusy(agw, jobId)` | `activeJobOf(agw) returns (uint256 jobId)`, `WalletHasActiveJob(agw, jobId)` |
| Destination account | `expectedCEAOf(agw, chainHash)` | `computeCEA(agw, chainHash)` (mirrors core's `computeUEA`; the rule field stays `expectedCEA`) |
| Per-chain pause | `setUniversalPaused`, `isUniversalPaused`, `UniversalChainPaused`, `ChainPaused` error | removed (M10) |
| Rules check errors | `PCCapMismatch`, `CapMismatch` | `GasCapMismatch`, `PrincipalCapMismatch` |
| Set-once wiring | `pushChainHash()` | `PUSH_CHAIN_HASH()` (URP has the same lowercase name; align on its next redeploy) |
| Hook views | `rulesOf(jobId)` returning `{agw, rulesId}`, `isAGWBusy`, `liveJobOf` | `rulesOfJob(jobId)`, `agwOfJob(jobId)`, `activeJobOf(agw)`: one spelling with the marketplace |
| Criteria tree | `Node`, `NodeKind`, `nodes`, `MAX_NODES` | `Logic`, `LogicKind`, `logic`, `MAX_LOGIC` |
| Chain field | `AgentCard.chainNamespace` full CAIP-2; `Read.chainNamespace` namespace only with `chainId` beside it | unchanged; rule written once: a single field naming a chain is the full CAIP-2 string, the split form appears only where `chainId` sits beside it |
| Layout | `docs/universalmarketplace/README.md`, unnumbered tests, hand-copied AGW mirrors in `interfaces/external/` | deferred; AGW types imported, not copied (section 0) |

# 4. Structural changes that ride along with the rename

1. **Multi-asset card rules** (M5). `AgentCardRules { AssetCap[] assets; uint8 principalAsset; uint256 maxGasPerCall; AllowedCall[] allowedCalls; Approval[] approvals; }`. `checkRulesMatchCard` applies total equals principal to `assets[principalAsset]` and byte-equal caps to the rest. Replace the `UniversalTerms` mirror with the AGW's new struct in the same change. Blocks the AGW redeploy (section 0).
2. **Mutability on the criteria** (M4). `AllowedMutability allowedMutability` on `JobSpec` and `JobSpecTemplate`, copied by the builder. Field order decided 2026-10-12: `reads, checks, logic, allowedMutability, origin, executeBy, failFinalAt`; the template is the first four fields plus `params`, so `JobSpecBuilder` copies four and appends `origin` and timing. Supersedes both this repo's order and the Trust Layer page's. Implementation lands in `JobSpecTypes.sol` with the evaluator team.
3. **`Card.paymentToken`** (M6), after K-12 lands on the kernel. `providerFee` is read in it.
4. **`activeJobOf`** replaces `isAGWFree` and `lastJobOf`; the hook adopts the same view and the marketplace's two job views.
5. **Per-chain pause removed** (M10). Storage slot 14 becomes a reserved gap entry.
6. **`getAgentRating(agent)`** placeholder (M12). **`version()`** added. **`PUSH_CHAIN_HASH()`** uppercase.
7. **Admin surface stays out of the SDK**: `verifyAgentCard`, `disableAgentCard`, `setCEADeployment`, `setHook`, `setEvaluator`, `pause`, `unpause`.

# 4b. Contract surface, as a diff

Read `+` as added, `-` as removed, `~` as changed in place, `=` as unchanged. Names are the post-rename names. Storage is append-only; renames are labels only.

**UniversalMarketplace**

```diff
// cards
~ registerAgentCard(AgentCard c, bytes rules, bytes jobSpecTemplate) returns (uint256 cardId)   // was registerCard(c, rulesTerms, evaluation); reverts AgentCardAlreadyRegistered(provider) on a second card (decided 2026-10-12)
~ updateAgentCard(uint256 cardId, AgentCard c, bytes rules, bytes jobSpecTemplate)              // was modifyAgentCard
~ setAgentCardActive(uint256 cardId, bool active)                                        // was setCardActive
~ disableAgentCard(uint256 cardId)                                                       // was adminDisableCard; admin
= verifyAgentCard(uint256 cardId, uint256 version), revokeAgentCardVerification(uint256 cardId)   // admin
~ getAgentCard(uint256 cardId) view returns (AgentCardView)                              // was getCard
~ isAgentCardVerified, isAgentCardDisabled, agentCardVersion, agentCardCount             // was isCardVerified, isCardAdminDisabled, cardVersion, cardCount
+ getAgentRating(address agent) view returns (uint256)                                   // placeholder; TAP or VerifiedRatings later

// jobs
~ openJob(OpenJobParams p) returns (uint256 jobId, address agw, bytes32 rulesId)         // was startJob(StartJobParams)
~ activeJobOf(address agw) view returns (uint256 jobId)                                  // replaces isAGWFree and lastJobOf; 0 = free
= cardOfJob, agwOfJob, rulesOfJob
~ computeCEA(address agw, bytes32 chainHash) view returns (address)                      // was expectedCEAOf
= buildCreateJobCalldata(uint256 cardId, address owner, uint96 index, JobInputs job) view returns (bytes32 mode, bytes executionCalldata)
= previewIntent(IntentRequest r, Session s) view returns (OwnerIntent)

// admin
= setHook, setEvaluator, setCEADeployment, pause, unpause
~ setCEADeployment(chainHash, 0, 0) allowed: clears the chain to ChainNotSupported
- setUniversalPaused(bytes32 chainHash, bool paused), isUniversalPaused(bytes32)

// views (wiring)
= AGW_FACTORY(), KERNEL(), hook(), evaluator()
~ RULES() returns (IUniversalMarketplaceRules)                                           // was TERMS()
~ PUSH_CHAIN_HASH() returns (bytes32)                                                    // was pushChainHash()
+ version() returns (string)

// events
~ AgentCardRegistered(cardId, provider, jobType, chainNamespace, rulesHash, jobSpecHash, metadataHash, providerFee)
~ AgentCardUpdated(cardId, version, rulesHash, jobSpecHash, metadataHash, providerFee)
~ AgentCardStatusChanged, AgentCardDisabled, AgentCardVerified, AgentCardVerificationRevoked
~ JobOpened(cardId, owner, agw, jobId, rulesId, principal, cardVersion)                   // was JobStarted
= HookUpdated, EvaluatorUpdated, CEADeploymentSet
- UniversalChainPaused

// storage (slots never move)
= 0 AGW_FACTORY, 1 KERNEL, 2 hook, 3 evaluator, 4 PUSH_CHAIN_HASH, 5 RULES, 6 agentCardCount, 7 _cards, 8 _agentCardRules, 9 _jobSpecTemplates,
= 10 agentCardVersion, 11 isAgentCardVerified, 12 isAgentCardDisabled, 13 ceaDeployment, 15 activeJobOf (was lastJobOf), 16 cardOfJob, 17 agwOfJob, 18 rulesOfJob
~ 14 reserved (was isUniversalPaused)
+ _agentRating appended after the gap start; __gap shrinks by one
```

**Types** (`libraries/Types.sol`)

```diff
~ struct AgentCard { address provider; bytes32 jobType; string metadataURI; bytes32 metadataHash; string chainNamespace;
~                    uint256 providerFee; address paymentToken;                           // was fee; paymentToken NEW with K-12
~                    uint256 principalMin; uint256 principalMax; uint32 minDuration; uint32 maxDuration; uint32 minExecuteWindow; uint32 settleWindow; bool active; }
- struct RulesCardTerms { address asset; uint256 maxPCPerCall; AllowedCall[] allowedCalls; Approval[] approvals; }
+ struct AgentCardRules { AssetCap[] assets; uint8 principalAsset; uint256 maxGasPerCall; AllowedCall[] allowedCalls; Approval[] approvals; }
+ struct AssetCap { address token; uint256 maxPerCall; uint256 maxTotal; }               // imported from the AGW package, not copied
= struct Approval { address token; address spender; bool capIsPrincipal; uint256 cap; }
~ struct OpenJobParams { uint256 cardId; uint256 cardVersion; JobInputs job; Session session; OwnerIntent intent; bytes sig; string label; }   // was StartJobParams
~ struct AgentCardView { AgentCard card; bytes rules; bytes jobSpecTemplate; uint256 version; bool verified; bool disabled; }   // was CardView
~ struct JobSpecTemplate { ReadTemplate[] reads; CheckTemplate[] checks; Logic[] logic; AllowedMutability allowedMutability; ParamBounds[] params; }   // was EvaluationTemplate with nodes; CriteriaTemplate in the morning draft; first four fields match JobSpec
= JobInputs, IntentRequest, InitParams (field terms -> rules), SessionContext, Fill, ReadTemplate, CheckTemplate, ParamBounds
```

**JobSpecTypes** (shared wire format with the hook and the evaluator)

```diff
~ enum Evaluation { BOOLEAN, COMPARE, NUMBER, PERCENTAGE }                             // was EvalType { BOOL, CMP, NUM, PCT }; SDK constant names (2026-10-12)
~ enum Operation { EQUAL, NOT_EQUAL, GREATER_THAN, GREATER_OR_EQUAL, LESS_THAN, LESS_OR_EQUAL }   // was Op
~ enum LogicKind { ALL, ANY, AT_LEAST }                                                  // was NodeKind; CHECK leaf dropped (PROPOSED)
+ enum AllowedMutability { NONE, CLIENT, PROVIDER, BOTH }
~ struct Check { uint8 read; Evaluation evaluation; Operation operation; int256 target; }
~ struct Logic { LogicKind kind; uint8[] checks; uint8[] children; uint8 k; }           // was Node; no leaf nodes
~ struct JobSpec { Read[] reads; Check[] checks; Logic[] logic; AllowedMutability allowedMutability; bytes32 origin; uint64 executeBy; uint64 failFinalAt; }
~                                                                                        // order decided 2026-10-12: content, then allowedMutability and origin, then timing (section 4, item 2)
~ MAX_LOGIC = 32                                                                         // was MAX_NODES
= Read, T_* codes, MAX_READS, MAX_CHECKS
```

**UniversalMarketplaceRules** (was UniversalMarketplaceTerms)

```diff
~ validateAgentCardRules(bytes rules) pure returns (address[] tokens)                    // was validateRulesTerms returning one asset
~   checks: 1..MAX_ASSETS assets, principalAsset in range, no duplicate token, 1..32 allowed calls, no duplicate (target, selector),
~           no approve or increaseAllowance, transfer and transferFrom pin their recipient, at most 8 approvals, approval shape, no duplicate (token, spender)
~ checkRulesMatchCard(bytes cardRules, Session session, SessionContext ctx) pure         // was verifySession
~   checks, in order: agent == provider; one action; one policy; envelope chain == card chain;
~           assets[] equal to the card's with assets[principalAsset].maxTotal == principal and maxPerCall <= principal;
~           maxGasPerCall equal; allowedCalls byte-equal; validUntil == expiredAt; expectedCEA == computeCEA(agw, chainHash)
~ errors: AssetMismatch, GasCapMismatch (was PCCapMismatch), ActionsMismatch, PrincipalCapMismatch (was CapMismatch), ExpiryMismatch, ExpectedCEAMismatch
= MAX_ALLOWED_CALLS = 32, MAX_APPROVALS = 8; + MAX_ASSETS = 8 (imported from the AGW)
```

**RulesBindingHook** (interim; extended by the evaluator track)

```diff
= beforeAction(fund): optParams == abi.encode(rulesId); client is a factory AGW; rules live on the engine; no live job; records the binding; emits RulesBound
+ afterAction(setBudget): decode the optional JobSpec proposal; check allowedMutability against the caller; hand to the evaluator or revert
+ afterAction(fund): freeze the standing JobSpec; trigger the baseline (prefunded by the client)
+ afterAction(submit): evaluator.verify(jobId)
~ rulesOfJob(jobId) view returns (bytes32), agwOfJob(jobId) view returns (address)       // was rulesOf(jobId) returning a struct
~ activeJobOf(agw) view returns (uint256)                                                // was isAGWBusy and liveJobOf
- the binder role (rules expire by validUntil); recomputing a criteria hash (criteria are built on-chain); refusing submit before the baseline (the evaluator returns inconclusive)
```

**Not in this change set** (belongs elsewhere, listed so nobody looks for it here): the kernel's per-job payment token (K-12, [3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md)), the evaluator, Solana and native (Push-side) cards, the `EvaluatorGateway` for jobs on other chains.

# 5. Open for review on this page

1. Client-side cancellation of an Open unfunded job. Decided 2026-10-12: enforced at the contract level, the client can cancel on the kernel. What is still open is the AGW side: on cancel the hook must release the wallet's rules so the wallet is not blocked until `expiredAt`. Research tagged on [3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md) (open item 2).
2. One card per provider. Decided 2026-10-12: enforced on-chain, `registerAgentCard` reverts `AgentCardAlreadyRegistered(provider)`; a provider changes its offer through `updateAgentCard`. `agent.card()` on page 6 reads the one card.
3. `JobSpec` field order and `origin`: decided 2026-10-12 (section 4, item 2); pending implementation in `JobSpecTypes.sol`.
4. Recurring jobs (a 7 or 15 day job renewing until cancelled) against the one-live-job rule: a renewal is a new job that must start the moment the old one completes, or the rule needs a successor slot. Research, with the fee design (tagged 2026-10-12).
5. Size: 21.3 KB today with 3.3 KB to the EIP-170 limit; multi-asset rules add code, another split may be needed.
6. Anything in the rename map or the diff that should stay as is.