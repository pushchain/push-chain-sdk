# Universal Marketplace — Reference

Every function, event, error, type, constant and storage slot of the Universal Marketplace package. For how they
fit together, read [`README.md`](./README.md) first. Section numbers like "§8" refer to that file.

- [UniversalMarketplace](#universalmarketplace)
  - [Initialization](#initialization)
  - [Admin functions](#admin-functions)
  - [Card functions](#card-functions)
  - [openJob](#openjob)
  - [Views](#views)
  - [Constants](#constants)
  - [Storage layout](#storage-layout)
- [UniversalMarketplaceRules](#universalmarketplacerules)
- [JobSpecBuilder](#jobspecbuilder)
- [RulesBindingHook (interim hook)](#rulesbindinghook-interim-hook)
- [Types](#types)
- [Markers](#markers)
- [Events](#events)
- [Errors](#errors)

---

## UniversalMarketplace

[`src/agentic-commerce-8183/UniversalMarketplace.sol`](../../src/agentic-commerce-8183/UniversalMarketplace.sol).
Inherits OZ `Initializable`, `AccessControlUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable` and
`IUniversalMarketplace`. Deployed behind a `TransparentUpgradeableProxy`. It has no payable function and holds
no funds. `version()` returns `"2.0.0"`.

### Initialization

#### `constructor()`
Calls `_disableInitializers()`, so the implementation itself can never be initialized.

#### `initialize(InitParams calldata p)` — `initializer`

| Step | Effect |
|---|---|
| 1 | Reverts `ZeroAddress()` if `agwFactory`, `kernel`, `rules` or `admin` is zero. |
| 2 | Initializes AccessControl, Pausable and ReentrancyGuard. |
| 3 | Stores `AGW_FACTORY`, `KERNEL`, `RULES`. |
| 4 | `PUSH_CHAIN_HASH = keccak256("eip155:" ‖ decimal(block.chainid))`. |
| 5 | `_setHook(p.hook)`: `ZeroAddress()` if zero, `HookNotWhitelisted()` unless `KERNEL.whitelistedHooks(hook)`; emits `HookUpdated`. |
| 6 | `_setEvaluator(p.evaluator)`: `ZeroAddress()` if zero; emits `EvaluatorUpdated`. |
| 7 | Grants `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE` to `p.admin`. |

A second call reverts `InvalidInitialization()` (OZ).

### Admin functions

All are `onlyRole(ADMIN_ROLE)`; a non-admin caller gets `AccessControlUnauthorizedAccount(caller, ADMIN_ROLE)`.
None is pausable.

#### `setHook(address hook)`
Sets the hook every **new** job is created with. Reverts `ZeroAddress()` or `HookNotWhitelisted()`. Emits
`HookUpdated(hook)`. Existing jobs keep the hook the kernel recorded at creation.

#### `setEvaluator(address evaluator)`
Sets the evaluator every **new** job is created with. Reverts `ZeroAddress()`. Emits `EvaluatorUpdated(evaluator)`.
Not checked against providers: a card whose provider is now the evaluator is refused at `openJob`
(`ProviderIsEvaluator()`).

#### `setCEADeployment(bytes32 chainHash, address ceaFactory, address ceaProxyImpl)`
Records a destination chain's CEA factory and proxy implementation, which enables the chain for cards and for
criteria reads and sets the CEA derivation (§9).

| Arguments | Effect |
|---|---|
| both zero | `delete ceaDeployment[chainHash]`: the chain then reports `ChainNotSupported(chainHash)` everywhere |
| exactly one zero | reverts `ZeroAddress()` |
| both non-zero | sets the entry |

Emits `CEADeploymentSet(chainHash, ceaFactory, ceaProxyImpl)` when it does not revert. Rotation runbook:
`pause()` → rotate on the destination → `setCEADeployment` → `unpause()`.

#### `setAgentRating(address agent, uint256 rating)`
`_agentRating[agent] = rating`; emits `AgentRatingSet(agent, rating)`. No validation. A placeholder until
VerifiedRatings is wired.

#### `pause()` / `unpause()`
OZ Pausable. While paused, `registerAgentCard`, `updateAgentCard` and `openJob` revert `EnforcedPause()`. Admin
functions, `setAgentCardActive` and every view stay live.

#### `disableAgentCard(uint256 cardId)`
Permanently disables a card: `isAgentCardDisabled = true`, `active = false`, verified tag cleared. Reverts
`AgentCardInactive()` for an unknown card. Emits `AgentCardVerificationRevoked(cardId)` (only if it was verified),
then `AgentCardDisabled(cardId)`. Nothing re-enables it. `agentCardOf[provider]` is kept, so the provider cannot
register again.

#### `verifyAgentCard(uint256 cardId, uint256 cardVersion)`
Sets the verified tag for the card's current version.

| Revert | When |
|---|---|
| `AgentCardInactive()` | unknown card |
| `AgentCardDisabled(cardId)` | disabled card |
| `AgentCardVersionMismatch(cardVersion, current)` | `cardVersion` is not the current version, e.g. the card changed after review |

Allowed for a card its provider switched off. Emits `AgentCardVerified(cardId, cardVersion)`.

#### `revokeAgentCardVerification(uint256 cardId)`
Clears the tag. Reverts `AgentCardInactive()` for an unknown card. Idempotent: emits
`AgentCardVerificationRevoked(cardId)` only if the card was verified.

### Card functions

#### `registerAgentCard(AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate) returns (uint256 cardId)` — `whenNotPaused`

| Step | Effect |
|---|---|
| 1 | `AgentCardAlreadyRegistered(msg.sender)` if `agentCardOf[msg.sender] != 0`. |
| 2 | `_validateCard(c, rules)`: the 13 checks of README §4.2, in order. |
| 3 | `cardId = ++agentCardCount` (ids start at 1). |
| 4 | Stores the card, then overwrites `provider = msg.sender` and `active = true`. |
| 5 | Stores both blobs as given; `agentCardVersion = 1`; `agentCardOf[msg.sender] = cardId`. |
| 6 | Emits `AgentCardRegistered(cardId, msg.sender, jobType, chainNamespace, keccak256(rules), keccak256(jobSpecTemplate), metadataHash, providerFee)`. |

`jobSpecTemplate` is **not** checked (§7.3). `rules` must decode as `AgentCardRules`; undecodable bytes revert
in `abi.decode` with no data.

#### `updateAgentCard(uint256 cardId, AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate)` — `whenNotPaused`

| Step | Effect / revert |
|---|---|
| 1 | `CallerIsNotProvider()` unless the card exists and `msg.sender` is its provider. |
| 2 | `AgentCardDisabled(cardId)` if disabled. |
| 3 | `AgentCardIdentityImmutable()` if `c.chainNamespace` differs from the stored one. |
| 4 | `_validateCard(c, rules)`, as at registration. |
| 5 | Writes `jobType`, `metadataURI`, `metadataHash`, `providerFee`, `paymentToken`, `principalMin`, `principalMax`, `minDuration`, `maxDuration`, `minExecuteWindow`, `settleWindow`; replaces both blobs. `provider`, `chainNamespace` and `active` stay. |
| 6 | `version = ++agentCardVersion[cardId]`; clears the verified tag (emits `AgentCardVerificationRevoked` if there was one). |
| 7 | Emits `AgentCardUpdated(cardId, version, keccak256(rules), keccak256(jobSpecTemplate), metadataHash, providerFee)`. |

Opened jobs are untouched (`test_ML12`). Intents signed against the previous version stop working (§4.3).

#### `setAgentCardActive(uint256 cardId, bool active)`
Provider only (`CallerIsNotProvider()`, also for an unknown card). Switching on a disabled card reverts
`AgentCardDisabled(cardId)`; switching it off is allowed. Emits `AgentCardStatusChanged(cardId, active)`. Not
pausable.

### openJob

#### `openJob(OpenJobParams calldata p) returns (uint256 jobId, address agw, bytes32 rulesId)` — `whenNotPaused nonReentrant`

Deploys the AGW if needed, grants it the card's rules and creates the job. The 16 steps, checks and errors are in
§8. Records `cardOfJob`, `agwOfJob`, `rulesOfJob`, `cardVersionOfJob` and the wallet's last job. Emits
`JobOpened(cardId, intent.owner, agw, jobId, rulesId, principal, cardVersion)`.

`OpenJobParams`:

| Field | Meaning |
|---|---|
| `cardId` | the card |
| `cardVersion` | the version the owner signed against; must equal the current version |
| `job` | `JobInputs{principal, expiredAt, executeBy, params}` |
| `session` | the rules (SmartSession `Session`) the owner signed, markers filled |
| `intent` | the owner-signed `OwnerIntent` (from `previewIntent`) |
| `sig` | the owner's signature over the intent |
| `label` | wallet label, used only when deploying a new wallet |

Calls made, in order, after every check: `AGW_FACTORY.deployWalletWithSig` (new wallet) or
`AGW_FACTORY.ownerOf` (existing wallet); `AGW.grantRulesWithSig`; `KERNEL.jobCounter`; `AGW.executeWithSig`;
`KERNEL.jobCounter`; `KERNEL.getJob`.

### Views

| View | Returns | Notes |
|---|---|---|
| `getAgentCard(uint256 cardId)` | `AgentCardView{card, rules, jobSpecTemplate, version, verified, disabled}` | All zero for an unknown card. |
| `isAgentCardVerified(uint256 cardId)` | `bool` | Verified at the current version. |
| `isAgentCardDisabled(uint256 cardId)` | `bool` | |
| `agentCardVersion(uint256 cardId)` | `uint256` | 1 at registration, +1 per update, 0 if unknown. |
| `agentCardCount()` | `uint256` | The last card id. |
| `agentCardOf(address provider)` | `uint256` | The provider's card id; 0 for none. |
| `getAgentRating(address agent)` | `uint256` | 0 by default. |
| `activeJobOf(address agw)` | `uint256` | The AGW's last job opened here while it is Funded, Submitted, or Open with `block.timestamp < expiredAt`; else 0 (§10). |
| `cardOfJob(uint256 jobId)` / `agwOfJob` / `rulesOfJob` / `cardVersionOfJob` | card id / AGW / `rulesId` / card version | Recorded by `openJob`; zero for jobs not opened here. |
| `ceaDeployment(bytes32 chainHash)` | `(address ceaFactory, address ceaProxyImpl)` | Zero if unconfigured or cleared. |
| `computeCEA(address agw, bytes32 chainHash)` | `address` | The AGW's CEA on that chain (§9). Reverts `ChainNotSupported(chainHash)` if unconfigured. |
| `buildCreateJobCalldata(uint256 cardId, address owner, uint96 index, JobInputs job)` | `(bytes32 mode, bytes executionCalldata)` | Exactly what `openJob` executes for wallet `index` of `owner`. Reverts `AgentCardInactive()` for an unknown card, and like step 9 on a bad template or bad inputs. |
| `previewIntent(IntentRequest r, Session s)` | `OwnerIntent` | The intent to sign (§8). Nonces are read from the wallet, or 0 if not yet deployed. Reverts like `buildCreateJobCalldata`. |
| `AGW_FACTORY()`, `KERNEL()`, `RULES()` | addresses | Set once at `initialize`. |
| `PUSH_CHAIN_HASH()` | `bytes32` | `keccak256("eip155:" ‖ block.chainid)` at initialization. |
| `hook()`, `evaluator()` | addresses | Admin-settable. |
| `version()` | `string` | `"2.0.0"` (`pure`). |
| `hasRole`, `paused`, … | | OZ AccessControl and Pausable views. |

`previewIntent` output:

| Field | Value |
|---|---|
| `owner`, `index`, `deadline`, `signerChainId` | from the request |
| `wallet` | `AGW_FACTORY.predictWallet(owner, index)` |
| `executor` | the marketplace |
| `sessionHash` | `keccak256(abi.encode(session))` |
| `mode` | `MODE_SINGLE` (0) |
| `execCalldataHash` | `keccak256(buildCreateJobCalldata(...))` |
| `nonceKey` | `OPENJOB_LANE` |
| `nonceSeq` | `AGW.getNonce(OPENJOB_LANE)` if deployed, else 0 |
| `grantNonce` | `AGW.grantNonce()` if deployed, else 0 |

Removed in v2: `setUniversalPaused`, `isUniversalPaused`, `isAGWFree`, the public `lastJobOf`, `expectedCEAOf`,
`startJob`, `registerCard`, `modifyAgentCard`, `setCardActive`, `adminDisableCard`, `getCard`, `isCardVerified`,
`isCardAdminDisabled`, `cardVersion`, `cardCount`, `TERMS`, `pushChainHash`, `STARTJOB_LANE`.

### Constants

| Constant | Value | Use |
|---|---|---|
| `ADMIN_ROLE` | `keccak256("ADMIN_ROLE")` | every admin function |
| `OPENJOB_LANE` | `OWNER_LANE_FLAG` (`1 << 191`, imported from AGW v6) | the AGW nonce lane `openJob`'s execution uses (owner lane, key 0) |
| `MODE_SINGLE` | `bytes32(0)` | ERC-7579 single call, default exec type |
| `MIN_DURATION` (internal) | `1 hours` | lower bound on a card's `minDuration` |
| `EVM_PREFIX` (internal) | `"eip155:"` | required prefix of a card's `chainNamespace` |

### Storage layout

Append-only from this layout. OZ upgradeable bases use ERC-7201 namespaced storage and occupy none of these
slots, so slot 0 is the marketplace's. Pinned by `test_MV09_storageLayout_bySlot`.

| Slot | Variable | Type |
|---|---|---|
| 0 | `AGW_FACTORY` | `IAGWFactory` |
| 1 | `KERNEL` | `IAgenticCommerce` |
| 2 | `hook` | `address` |
| 3 | `evaluator` | `address` |
| 4 | `PUSH_CHAIN_HASH` | `bytes32` |
| 5 | `RULES` | `IUniversalMarketplaceRules` |
| 6 | `agentCardCount` | `uint256` |
| 7 | `_cards` | `mapping(uint256 => AgentCard)` |
| 8 | `_agentCardRules` | `mapping(uint256 => bytes)` |
| 9 | `_jobSpecTemplates` | `mapping(uint256 => bytes)` |
| 10 | `agentCardVersion` | `mapping(uint256 => uint256)` |
| 11 | `isAgentCardVerified` | `mapping(uint256 => bool)` |
| 12 | `isAgentCardDisabled` | `mapping(uint256 => bool)` |
| 13 | `ceaDeployment` | `mapping(bytes32 => CEADeployment)` |
| 14 | `__reserved14` | `uint256`, always 0 (was the per-chain pause) |
| 15 | `_lastJobOf` | `mapping(address => uint256)` |
| 16 | `cardOfJob` | `mapping(uint256 => uint256)` |
| 17 | `agwOfJob` | `mapping(uint256 => address)` |
| 18 | `rulesOfJob` | `mapping(uint256 => bytes32)` |
| 19 | `agentCardOf` | `mapping(address => uint256)` |
| 20 | `cardVersionOfJob` | `mapping(uint256 => uint256)` |
| 21 | `_agentRating` | `mapping(address => uint256)` |
| 22–48 | `__gap` | `uint256[27]` |

---

## UniversalMarketplaceRules

[`src/agentic-commerce-8183/UniversalMarketplaceRules.sol`](../../src/agentic-commerce-8183/UniversalMarketplaceRules.sol),
implementing [`IUniversalMarketplaceRules`](../../src/agentic-commerce-8183/interfaces/IUniversalMarketplaceRules.sol).
Stateless and `pure`, with no admin and no upgrade. Split out of the marketplace for EIP-170. Reverts with
`UniversalMarketplaceErrors`, so its reverts bubble through the marketplace unchanged.

| Constant | Value |
|---|---|
| `MAX_ALLOWED_CALLS` | 32 (URP's allow-list bound; internal there, so mirrored) |
| `ERC20_TRANSFER` / `ERC20_APPROVE` / `ERC20_TRANSFER_FROM` | `IERC20.transfer/approve/transferFrom.selector` (`0xa9059cbb` / `0x095ea7b3` / `0x23b872dd`) |
| `ERC20_INCREASE_ALLOWANCE` | `bytes4(keccak256("increaseAllowance(address,uint256)"))` (`0x39509351`) |
| `MAX_ASSETS`, `MAX_PINS`, `MAX_ALLOWED_CALL_PINS`, `ENVELOPE_VERSION` | 8, 8, 32, 1 (imported from AGW v6 `Types.sol`) |
| `MARKER_WALLET`, `MARKER_PRINCIPAL` | imported from the package's `Types.sol` ([Markers](#markers)) |

#### `validateAgentCardRules(bytes calldata rules) external pure returns (address[] memory tokens)`

Decodes `AgentCardRules` with `abi.decode` (malformed bytes revert without data). Then runs the checks below **in
this order**, reverting `InvalidAgentCard(reason)`. Returns `tokens[i] = assets[i].token` for every asset.

| # | Check | Reason |
|---|---|---|
| R1 | `1 <= assets.length <= MAX_ASSETS` | `"asset count"` |
| R2 | `principalAsset < assets.length` | `"principal asset"` |
| R3 | for each asset `i`: `token != address(0)` | `"asset zero"` |
| R4 | for each `i`, no `j < i` with the same token | `"duplicate asset"` |
| R5 | `assets[principalAsset].maxTotal == uint256(MARKER_PRINCIPAL)` | `"principal total not marker"` |
| R6 | `assets[principalAsset].maxPerCall != 0` (it is the marker or a fixed number > 0) | `"principal per-call zero"` |
| R7 | for each `i != principalAsset`: `maxPerCall != uint256(MARKER_PRINCIPAL)` and `maxTotal != uint256(MARKER_PRINCIPAL)` | `"marker off principal asset"` |
| R8 | `1 <= allowedCalls.length <= MAX_ALLOWED_CALLS` | `"allow-list size"` |
| R9 | for each call: `pins.length <= MAX_PINS`, and the sum over all calls `<= MAX_ALLOWED_CALL_PINS` | `"too many pins"` |
| R10 | for each pin: if `value == MARKER_WALLET` then `op == PinOp.EQ` | `"wallet marker op"` |
| R11 | for each call `i`, no `j < i` with byte-identical content (`keccak256(abi.encode(calls[i])) == keccak256(abi.encode(calls[j]))`) | `"duplicate call"` |
| R12 | for each call `i`, if some `j != i` has the same `(target, selector)`, then **both** have `pins.length > 0` (a pinless entry beside a pinned one makes the pins pointless, per the v6 docs) | `"unpinned duplicate"` |
| R13 | `selector == ERC20_INCREASE_ALLOWANCE` is refused | `"increaseAllowance"` |
| R14 | `selector == ERC20_APPROVE` requires a pin `{offset: 4, op: EQ, value: v}` where `v != 0`, `uint256(v) >> 160 == 0` (a clean address word), and `v` is not a marker | `"approve spender not pinned"` |
| R15 | `selector == ERC20_APPROVE` requires a pin `{offset: 36, op: MAX, value: w}` where `w` is `MARKER_PRINCIPAL` or any fixed value | `"approve amount not capped"` |
| R16 | `selector == ERC20_TRANSFER` requires the recipient (offset 4) pinned to the user's account: `hasBeneficiary && beneficiaryOffset == 4`, **or** a pin `{offset: 4, op: EQ, value: MARKER_WALLET}` | `"erc20 transfer recipient"` |
| R17 | `selector == ERC20_TRANSFER_FROM` likewise at offset 36 | `"erc20 transferFrom recipient"` |

Implementation notes: each rule runs over every item before the next rule starts. R11/R12 compare across all
entries (O(n²), n ≤ 32). The required pins of R14–R17 may sit anywhere in `pins[]`; extra pins are allowed. R14's
"not a marker" holds through the clean-address-word test, because both markers have non-zero high 96 bits.
Known limit: whether a `MARKER_PRINCIPAL` pin sits on the **principal** token's `approve` is not checked (`IPRC20`
has no source-token view); the verified tag covers it.

#### `checkRulesMatchCard(bytes calldata cardRules, Session calldata session, SessionContext calldata ctx) external pure`

`ctx` is `SessionContext{agent, chainHash, principal, expiredAt, expectedCEA}`, filled by the marketplace from the
card, the job and `computeCEA`. Checks **in this order**; the first failure reverts:

| # | Check | Error |
|---|---|---|
| C1 | `keccak256(session.sessionValidatorInitData) == keccak256(abi.encode(ctx.agent))` | `AgentMismatch()` |
| C2 | `session.actions.length == 1` | `ActionCount()` |
| C3 | `session.actions[0].actionPolicies.length == 1` | `PolicyShape(0)` |
| C4 | let `d = actionPolicies[0].initData`. Require `d.length >= 32` and `uint256(bytes32(d[0:32])) == ENVELOPE_VERSION`, **before any decode**. If `d.length < 32`, revert with actual `0` | `EnvelopeVersionMismatch(uint256 actual)` |
| C5 | `(, string chainNamespace, bytes body) = abi.decode(d, (uint16, string, bytes))`; `keccak256(bytes(chainNamespace)) == ctx.chainHash` | `ChainMismatch(0)` |
| C6 | `UniversalTerms t = abi.decode(body, (UniversalTerms))`; `AgentCardRules c = abi.decode(cardRules, (AgentCardRules))`; `t.assets.length == c.assets.length` | `AssetCountMismatch(c.assets.length, t.assets.length)` |
| C7 | for each `i`: `t.assets[i].token == c.assets[i].token` | `AssetMismatch(i)` |
| C8 | for `i == c.principalAsset`: `t.maxTotal == ctx.principal`; and `t.maxPerCall == ctx.principal` if `c.maxPerCall == uint256(MARKER_PRINCIPAL)`, else `t.maxPerCall == c.maxPerCall` | `PrincipalCapMismatch()` |
| C9 | for each `i != c.principalAsset`: `t.maxPerCall == c.maxPerCall && t.maxTotal == c.maxTotal` | `AssetMismatch(i)` |
| C10 | `t.maxGasPerCall == c.maxGasPerCall` | `GasCapMismatch()` |
| C11 | `t.allowedCalls.length == c.allowedCalls.length`; for each `i`: `target`, `selector`, `beneficiaryOffset`, `hasBeneficiary`, `maxValue` and `pins.length` equal; for each pin `k`: `offset` and `op` equal | `ActionsMismatch()` |
| C12 | for each pin `k` of call `i`: card `value == MARKER_WALLET` ⇒ session `value == bytes32(uint256(uint160(ctx.expectedCEA)))`; card `value == MARKER_PRINCIPAL` ⇒ session `value == bytes32(ctx.principal)`; otherwise session `value ==` card `value` | `PinMismatch(i, k)` |
| C13 | `t.validUntil == ctx.expiredAt` | `ExpiryMismatch()` |
| C14 | `t.expectedCEA == ctx.expectedCEA` | `ExpectedCEAMismatch(ctx.expectedCEA, t.expectedCEA)` |

C11 and C12 share one loop: per call, the call fields; then per pin, offset and op, then value. Never compared: the
card's `principalAsset` (an index, not a rule), and the session's validator, policy address, action target and
selector, userOp and ERC-7739 lists, paymaster flag and salt — AGW v6 `_grantRules` pins all of them (README
§13.2). Malformed bytes after a correct version word, an undecodable body or undecodable card rules revert in
`abi.decode` without data (`test_MT10_malformedInputs`).

---

## JobSpecBuilder

[`src/agentic-commerce-8183/libraries/JobSpecBuilder.sol`](../../src/agentic-commerce-8183/libraries/JobSpecBuilder.sol).
An external library: deployed once, linked into the marketplace, called by `DELEGATECALL`. Inlined, it would put
the marketplace over the size limit.

#### `build(bytes memory jobSpecTemplate, BuildContext memory ctx) public view returns (bytes memory)`
Returns `abi.encode(JobSpec)` for one job: the 8183 job's description. Algorithm and checks are in
[`criteria.md`](./criteria.md#building-a-jobspec). `logic` and `allowedMutability` are copied verbatim.

`BuildContext{agw, principal, executeBy, settleWindow, params, origin}` comes from the job's inputs, the card's
`settleWindow`, and `origin = keccak256(abi.encode(marketplace, cardId, cardVersion, principal))`.

The library reads CEAs with `IUniversalMarketplace(address(this)).computeCEA(agw, chainHash)`, with
`chainHash = keccak256(abi.encodePacked(read.chainNamespace, ":", read.chainId))`. Under `DELEGATECALL`,
`address(this)` is the marketplace proxy, so this is an external call back into the marketplace. Called directly
(not through the marketplace), a template that needs a CEA reverts, because the library would ask itself. It has
no storage.

---

## RulesBindingHook (interim hook)

[`src/agentic-commerce-8183/hooks/RulesBindingHook.sol`](../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol),
on [`BaseERC8183Hook`](../../src/agentic-commerce-8183/hooks/BaseERC8183Hook.sol). Not part of the marketplace,
but every marketplace job is created with it until the V2 UniversalHook ships. Behind a
`TransparentUpgradeableProxy`; storage continues the base at slot 50.

| Item | Behaviour |
|---|---|
| `initialize(address kernel, address agwFactory, address sessionEngine)` | All non-zero (`ERC8183HookErrors.ZeroAddress()`). Sets `KERNEL`, `AGW_FACTORY`, `SESSION_ENGINE`. |
| `beforeAction` / `afterAction` | Kernel only (`CallerIsNotKernel(caller)`). Acts only in `beforeAction(fund)`; every other action passes through. |
| `beforeAction(fund)` | In order: `fund.optParams` is exactly 32 bytes, `abi.encode(rulesId)` (`InvalidOptParams(length)`); the client is a factory AGW (`CallerIsNotAGW(caller)`); `SESSION_ENGINE.isPermissionEnabled(rulesId, client)` (`RulesNotLive(agw, rulesId)`); `activeJobOf(client) == 0` (`AGWHasLiveJob(agw, liveJobId)`). Then records the binding and the AGW's live job, and emits `RulesBound(jobId, agw, rulesId)`. |
| `rulesOfJob(uint256 jobId)` | The `rulesId` bound at `fund`, or zero. |
| `agwOfJob(uint256 jobId)` | The AGW bound at `fund`, or zero. |
| `activeJobOf(address agw)` | The AGW's last bound job while it is Funded or Submitted; else 0. Narrower than the marketplace's view (README §10). |

Storage: 50 `AGW_FACTORY`, 51 `SESSION_ENGINE`, 52 `_bindingOf` (`mapping(uint256 => Binding{agw, rulesId})`),
53 `_liveJobOf` (`mapping(address => uint256)`), 54–103 `__gap[50]`. Because the hook runs in `beforeAction`, any
revert leaves the job Open with no escrow moved. A wallet is freed by reading the kernel's job status, so an
unhooked `claimRefund` frees it too. `optParams` stays exactly `abi.encode(rulesId)`.

---

## Types

All in [`libraries/Types.sol`](../../src/agentic-commerce-8183/libraries/Types.sol), file-level. The built
criteria (`JobSpec`, `Read`, `Check`, `Logic` and the enums) are in
[`libraries/JobSpecTypes.sol`](../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol). The AGW types
(`OwnerIntent`, `AssetCap`, `AllowedCall`, `ArgPin`, `PinOp`, `UniversalTerms`) are imported from
`@push-agw/libraries/Types.sol`; the SmartSession `Session` and its parts are mirrored in
[`interfaces/external/IAGW.sol`](../../src/agentic-commerce-8183/interfaces/external/IAGW.sol).

| Type | Fields | Notes |
|---|---|---|
| `AgentCard` | `provider`, `jobType`, `metadataURI`, `metadataHash`, `chainNamespace`, `providerFee`, `paymentToken`, `principalMin`, `principalMax`, `minDuration`, `maxDuration`, `minExecuteWindow`, `settleWindow`, `active` | `provider` and `active` are contract-written. `chainNamespace` is the full CAIP-2 string `"eip155:<id>"`, immutable after registration. `providerFee` is in `paymentToken`, which must equal `KERNEL.paymentToken()`; principal is in the principal asset's units; durations and windows in seconds. |
| `AgentCardRules` | `assets` (`AssetCap[]`), `principalAsset` (uint8), `maxGasPerCall`, `allowedCalls` (`AllowedCall[]`) | `abi.encode`d into the card's `rules`. |
| `CEADeployment` | `ceaFactory`, `ceaProxyImpl` | Per destination chain. |
| `AgentCardView` | `card`, `rules`, `jobSpecTemplate`, `version`, `verified`, `disabled` | `getAgentCard`'s return. |
| `JobInputs` | `principal`, `expiredAt` (uint48), `executeBy` (uint48), `params` (int256[]) | Per-job inputs the owner signs. |
| `OpenJobParams` | `cardId`, `cardVersion`, `job`, `session`, `intent`, `sig`, `label` | `openJob`'s argument. |
| `IntentRequest` | `cardId`, `owner`, `index`, `job`, `deadline`, `signerChainId` | `previewIntent`'s argument. |
| `InitParams` | `agwFactory`, `kernel`, `hook`, `evaluator`, `rules`, `admin` | `initialize`'s argument. |
| `SessionContext` | `agent`, `chainHash`, `principal`, `expiredAt`, `expectedCEA` | The rules helper's per-job context. |
| `FillSource`, `Fill`, `ReadTemplate`, `TargetSource`, `CheckTemplate`, `ParamBounds`, `JobSpecTemplate`, `BuildContext` | | The criteria template; see [`criteria.md`](./criteria.md). `CheckTemplate` is `{read, evaluation, operation, source, value}`; `JobSpecTemplate` is `{reads, checks, logic, allowedMutability, params}`. |

Deleted in v2: `Approval`, `RulesCardTerms`, `CardView`, `StartJobParams`, `EvaluationTemplate`, and the local
copies of `OwnerIntent`, `OWNER_LANE_FLAG`, `AllowedCall`, `UniversalTerms`.

---

## Markers

Published constants in [`libraries/Types.sol`](../../src/agentic-commerce-8183/libraries/Types.sol); the SDK uses
the same values. Pinned by `test_naming_markers`.

| Constant | Value | Meaning in a card |
|---|---|---|
| `MARKER_WALLET` | `0x38beb8621ef19c2ac125b45b1ac07225511365301161eb56ac7a21aa8641cf5a` = `keccak256("push.marketplace.marker.WALLET")` | "the user's account (CEA) on the card's chain". EQ pins only (R10). |
| `MARKER_PRINCIPAL` | `0xc12ba2e9bfe16dd303c04d7f517245a6b49fd69f9d0e5c82d14be8c18ef34d52` = `keccak256("push.marketplace.marker.PRINCIPAL")` | "this job's principal". Pins (EQ or MAX) and the principal asset's caps, as `uint256`. |

How each is filled is the table in README §6.1. Other constants: `ENVELOPE_VERSION` 1, `MAX_ASSETS` 8, `MAX_PINS` 8,
`MAX_ALLOWED_CALL_PINS` 32 (AGW `Types.sol`); `MAX_ALLOWED_CALLS` 32 (rules helper); `OPENJOB_LANE`
`OWNER_LANE_FLAG` (`1 << 191`); `version()` `"2.0.0"`.

---

## Events

Emitted by the marketplace (declared in `IUniversalMarketplace`, banner UM_1):

| Event | Emitted by |
|---|---|
| `AgentCardRegistered(uint256 indexed cardId, address indexed provider, bytes32 indexed jobType, string chainNamespace, bytes32 rulesHash, bytes32 jobSpecHash, bytes32 metadataHash, uint256 providerFee)` | `registerAgentCard` |
| `AgentCardUpdated(uint256 indexed cardId, uint256 version, bytes32 rulesHash, bytes32 jobSpecHash, bytes32 metadataHash, uint256 providerFee)` | `updateAgentCard` |
| `AgentCardStatusChanged(uint256 indexed cardId, bool active)` | `setAgentCardActive` |
| `AgentCardDisabled(uint256 indexed cardId)` | `disableAgentCard` |
| `AgentCardVerified(uint256 indexed cardId, uint256 version)` | `verifyAgentCard` |
| `AgentCardVerificationRevoked(uint256 indexed cardId)` | `revokeAgentCardVerification`, `updateAgentCard`, `disableAgentCard` (only when a tag is cleared) |
| `AgentRatingSet(address indexed agent, uint256 rating)` | `setAgentRating` |
| `HookUpdated(address hook)` | `initialize`, `setHook` |
| `EvaluatorUpdated(address evaluator)` | `initialize`, `setEvaluator` |
| `CEADeploymentSet(bytes32 indexed chainHash, address ceaFactory, address ceaProxyImpl)` | `setCEADeployment` (both zero when clearing) |
| `JobOpened(uint256 indexed cardId, address indexed owner, address indexed agw, uint256 jobId, bytes32 rulesId, uint256 principal, uint256 cardVersion)` | `openJob` |

`rulesHash = keccak256(rules)` and `jobSpecHash = keccak256(jobSpecTemplate)`, so an indexer can check the blobs
returned by `getAgentCard`. Removed: `UniversalChainPaused`. The hook emits
`RulesBound(uint256 indexed jobId, address indexed agw, bytes32 indexed rulesId)`. OZ emits `RoleGranted`,
`Paused`, `Unpaused`, `Initialized`.

---

## Errors

All marketplace, rules-helper and builder errors are in the `UniversalMarketplaceErrors` library
([`libraries/Errors.sol`](../../src/agentic-commerce-8183/libraries/Errors.sol)). A library error has the same
selector wherever it is raised, so a helper or builder revert bubbles through `openJob` unchanged.

Each contract's ABI lists only the errors that contract itself raises. **Decode marketplace reverts with the
`UniversalMarketplaceErrors` artifact**, which lists all 40.

| Error | Raised by | Status |
|---|---|---|
| `ZeroAddress()` | initialize, setters, `setCEADeployment` (one zero) | unchanged |
| `HookNotWhitelisted()` | `setHook` | unchanged |
| `AgentCardInactive()` | `openJob` step 1, `_requireCard` (unknown card in disable, verify, revoke, `buildCreateJobCalldata`, `previewIntent`) | was `CardInactive` |
| `CallerIsNotProvider()` | update, setActive (also for an unknown card) | unchanged |
| `AgentCardDisabled(uint256 cardId)` | update, setActive(on), verify | was `CardAdminDisabled` |
| `ChainNotSupported(bytes32 chainHash)` | register/update, `computeCEA` (so also `openJob` and the builder) | unchanged |
| `InvalidAgentCard(string reason)` | register/update, rules helper | was `InvalidCard` |
| `AgentCardVersionMismatch(uint256 provided, uint256 current)` | `openJob`, verify | was `CardVersionMismatch` |
| `AgentCardIdentityImmutable()` | update | was `CardIdentityImmutable` |
| `AgentCardAlreadyRegistered(address provider)` | register | **new** |
| `PrincipalOutOfRange()`, `ExpiryOutOfRange()`, `ExecuteByOutOfRange()`, `ProviderIsEvaluator()` | `openJob` | unchanged |
| `ParamCountMismatch(uint256 expected, uint256 actual)`, `ParamOutOfRange(uint256 index, int256 value)`, `TargetOverflow(uint256 check)`, `FillOutOfBounds(uint256 read, uint256 fill)` | builder | unchanged |
| `IntentWalletMismatch(address expected, address provided)`, `ExecutorMismatch(address expected, address actual)`, `IntentSessionMismatch(bytes32 actual)`, `IntentExecMismatch(bytes32 actualCalldataHash)`, `AGWMismatch(address expected, address actual)`, `WalletOwnerMismatch(address expected, address actual)` | `openJob` | unchanged |
| `WalletHasActiveJob(address agw, uint256 jobId)` | `openJob` step 8 | was `AGWBusy` |
| `AgentMismatch()`, `ActionCount()`, `PolicyShape(uint256 i)`, `ChainMismatch(uint256 i)`, `ActionsMismatch()`, `ExpiryMismatch()`, `ExpectedCEAMismatch(address expected, address actual)` | rules helper | unchanged |
| `EnvelopeVersionMismatch(uint256 actual)` | rules helper C4 | **new** |
| `AssetCountMismatch(uint256 expected, uint256 actual)` | rules helper C6 | **new** |
| `AssetMismatch(uint256 index)` | rules helper C7, C9 | **now carries the index** |
| `PrincipalCapMismatch()` | rules helper C8 | was `CapMismatch` |
| `GasCapMismatch()` | rules helper C10 | was `PCCapMismatch` |
| `PinMismatch(uint256 call, uint256 pin)` | rules helper C12 | **new** |
| `UnexpectedJobCount(uint256 before, uint256 afterCount)`, `JobMismatch()` | `openJob` step 15 | unchanged |
| ~~`ChainPaused(bytes32)`~~ | | **deleted** |

`IntentSessionMismatch` and `IntentExecMismatch` carry the hash the marketplace expected (this session's hash,
this execution's calldata hash).

### `InvalidAgentCard` reasons

| Raised by | Reasons |
|---|---|
| marketplace | `"job type zero"`, `"metadata uri empty"`, `"metadata hash zero"`, `"chain namespace"`, `"payment token"` (new), `"provider is evaluator"`, `"principal range"`, `"duration range"`, `"settle window"`, `"execute window"`, `"asset"`, `"asset chain"` |
| rules helper | `"asset count"`, `"principal asset"`, `"asset zero"`, `"duplicate asset"`, `"principal total not marker"`, `"principal per-call zero"`, `"marker off principal asset"`, `"allow-list size"`, `"too many pins"`, `"wallet marker op"`, `"duplicate call"` (now identical entries only), `"unpinned duplicate"`, `"increaseAllowance"`, `"approve spender not pinned"`, `"approve amount not capped"`, `"erc20 transfer recipient"`, `"erc20 transferFrom recipient"` |
| deleted | `"erc20 approval"`, `"approval count"`, `"approval token"`, `"approval spender"`, `"approval cap"`, `"duplicate approval"` |

### Hook errors

Unchanged.

| Library | Error |
|---|---|
| `RulesBindingHookErrors` | `InvalidOptParams(uint256 length)`, `CallerIsNotAGW(address caller)`, `RulesNotLive(address agw, bytes32 rulesId)`, `AGWHasLiveJob(address agw, uint256 liveJobId)` |
| `ERC8183HookErrors` | `CallerIsNotKernel(address caller)`, `ZeroAddress()` |
