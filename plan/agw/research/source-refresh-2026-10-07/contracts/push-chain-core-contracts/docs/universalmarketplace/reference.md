# Universal Marketplace — Reference

Every function, event, error, type and storage slot of the Universal Marketplace package. For how they fit
together, read [`README.md`](./README.md) first. Section numbers like "§8" refer to that file.

- [UniversalMarketplace](#universalmarketplace)
  - [Initialization](#initialization)
  - [Admin functions](#admin-functions)
  - [Card functions](#card-functions)
  - [startJob](#startjob)
  - [Views](#views)
  - [Constants](#constants)
  - [Storage layout](#storage-layout)
- [UniversalMarketplaceTerms](#universalmarketplaceterms)
- [JobSpecBuilder](#jobspecbuilder)
- [RulesBindingHook (interim hook)](#rulesbindinghook-interim-hook)
- [Types](#types)
- [Events](#events)
- [Errors](#errors)

---

## UniversalMarketplace

[`src/agentic-commerce-8183/UniversalMarketplace.sol`](../../src/agentic-commerce-8183/UniversalMarketplace.sol).
Inherits OZ `Initializable`, `AccessControlUpgradeable`, `PausableUpgradeable`, `ReentrancyGuardUpgradeable` and
`IUniversalMarketplace`. Deployed behind a `TransparentUpgradeableProxy`. It has no payable function and holds
no funds.

### Initialization

#### `constructor()`
Calls `_disableInitializers()`, so the implementation itself can never be initialized.

#### `initialize(InitParams calldata p)` — `initializer`

| Step | Effect |
|---|---|
| 1 | Reverts `ZeroAddress()` if `agwFactory`, `kernel`, `terms` or `admin` is zero. |
| 2 | Initializes AccessControl, Pausable and ReentrancyGuard. |
| 3 | Stores `AGW_FACTORY`, `KERNEL`, `TERMS`. |
| 4 | `pushChainHash = keccak256("eip155:" ‖ decimal(block.chainid))`. |
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
Not checked against providers: a card whose provider is now the evaluator is refused at `startJob`
(`ProviderIsEvaluator()`).

#### `setCEADeployment(bytes32 chainHash, address ceaFactory, address ceaProxyImpl)`
Records a destination chain's CEA factory and proxy implementation. This enables the chain for cards and for
criteria reads, and sets the CEA derivation (§9). Reverts `ZeroAddress()` if either address is zero. Emits
`CEADeploymentSet(chainHash, ceaFactory, ceaProxyImpl)`. A deployment cannot be removed, only replaced.

#### `setUniversalPaused(bytes32 chainHash, bool paused)`
Pauses or resumes `startJob` for cards on `chainHash` (`ChainPaused(chainHash)`). Card registration on that chain
is not affected. Emits `UniversalChainPaused(chainHash, paused)`.

#### `pause()` / `unpause()`
OZ Pausable. While paused, `registerCard`, `modifyAgentCard` and `startJob` revert `EnforcedPause()`. Admin
functions, `setCardActive` and every view stay live.

#### `adminDisableCard(uint256 cardId)`
Permanently disables a card: `isCardAdminDisabled = true`, `active = false`, verified tag cleared. Reverts
`CardInactive()` for an unknown card. Emits `CardVerificationRevoked(cardId)` (only if it was verified), then
`CardDisabledByAdmin(cardId)`. Nothing re-enables it.

#### `verifyAgentCard(uint256 cardId, uint256 version)`
Sets the verified tag for the card's current version.

| Revert | When |
|---|---|
| `CardInactive()` | unknown card |
| `CardAdminDisabled(cardId)` | admin-disabled card |
| `CardVersionMismatch(version, current)` | `version` is not the current version, e.g. the card changed after review |

Allowed for a card its provider switched off. Emits `CardVerified(cardId, version)`.

#### `revokeAgentCardVerification(uint256 cardId)`
Clears the tag. Reverts `CardInactive()` for an unknown card. Idempotent: emits `CardVerificationRevoked(cardId)`
only if the card was verified.

### Card functions

#### `registerCard(AgentCard calldata c, bytes calldata rulesTerms, bytes calldata evaluation) returns (uint256 cardId)` — `whenNotPaused`

| Step | Effect |
|---|---|
| 1 | `_validateCard(c, rulesTerms)`: the 12 checks of §4.2, in order. |
| 2 | `cardId = ++cardCount` (ids start at 1). |
| 3 | Stores the card, then overwrites `provider = msg.sender` and `active = true`. |
| 4 | Stores both blobs as given; `cardVersion = 1`. |
| 5 | Emits `CardRegistered(cardId, msg.sender, jobType, chainNamespace, keccak256(rulesTerms), keccak256(evaluation), metadataHash, fee)`. |

`evaluation` is **not** checked (§7.3). `rulesTerms` must decode as `RulesCardTerms`; undecodable bytes revert
in `abi.decode` with no data.

#### `modifyAgentCard(uint256 cardId, AgentCard calldata c, bytes calldata rulesTerms, bytes calldata evaluation)` — `whenNotPaused`

| Step | Effect / revert |
|---|---|
| 1 | `CallerIsNotProvider()` unless the card exists and `msg.sender` is its provider. |
| 2 | `CardAdminDisabled(cardId)` if admin-disabled. |
| 3 | `CardIdentityImmutable()` if `c.chainNamespace` differs from the stored one. |
| 4 | `_validateCard(c, rulesTerms)`, as at registration. |
| 5 | Writes every field except `provider`, `chainNamespace` and `active`; replaces both blobs. |
| 6 | `version = ++cardVersion[cardId]`; clears the verified tag (emits `CardVerificationRevoked` if there was one). |
| 7 | Emits `CardModified(cardId, version, keccak256(rulesTerms), keccak256(evaluation), metadataHash, fee)`. |

Started jobs are untouched (`test_ML12`). Intents signed against the previous version stop working (§4.3).

#### `setCardActive(uint256 cardId, bool active)`
Provider only (`CallerIsNotProvider()`, also for an unknown card). Switching on an admin-disabled card reverts
`CardAdminDisabled(cardId)`; switching it off is allowed. Emits `CardStatusChanged(cardId, active)`. Not pausable.

### startJob

#### `startJob(StartJobParams calldata p) returns (uint256 jobId, address agw, bytes32 rulesId)` — `whenNotPaused nonReentrant`

Deploys the AGW if needed, grants it the card's rules and creates the job. The 16 steps, checks and errors are in
§8. Emits `JobStarted(cardId, intent.owner, agw, jobId, rulesId, principal, cardVersion)`.

`StartJobParams`:

| Field | Meaning |
|---|---|
| `cardId` | the card |
| `cardVersion` | the version the owner signed against; must equal the current version |
| `job` | `JobInputs{principal, expiredAt, executeBy, params}` |
| `session` | the rules (SmartSession `Session`) the owner signed |
| `intent` | the owner-signed `OwnerIntent` (from `previewIntent`) |
| `sig` | the owner's signature over the intent |
| `label` | wallet label, used only when deploying a new wallet |

Calls made, in order, after every check: `AGW_FACTORY.deployWalletWithSig` (new wallet) or
`AGW_FACTORY.ownerOf` (existing wallet); `AGW.grantRulesWithSig`; `KERNEL.jobCounter`; `AGW.executeWithSig`;
`KERNEL.jobCounter`; `KERNEL.getJob`.

### Views

| View | Returns | Notes |
|---|---|---|
| `getCard(uint256 cardId)` | `CardView{card, rulesTerms, evaluation, version, verified, adminDisabled}` | All zero for an unknown card. |
| `isCardVerified(uint256 cardId)` | `bool` | Verified at the current version. |
| `isCardAdminDisabled(uint256 cardId)` | `bool` | |
| `isUniversalPaused(bytes32 chainHash)` | `bool` | |
| `cardVersion(uint256 cardId)` | `uint256` | 1 at registration, +1 per modification, 0 if unknown. |
| `cardCount()` | `uint256` | The last card id. |
| `ceaDeployment(bytes32 chainHash)` | `(address ceaFactory, address ceaProxyImpl)` | Zero if unconfigured. |
| `lastJobOf(address agw)` | `uint256` | The AGW's last job started here; 0 if none. |
| `cardOfJob(uint256 jobId)` / `agwOfJob` / `rulesOfJob` | card id / AGW / `rulesId` | Recorded by `startJob`; zero for jobs not started here. |
| `AGW_FACTORY()`, `KERNEL()`, `TERMS()` | addresses | Set once at `initialize`. |
| `hook()`, `evaluator()` | addresses | Admin-settable. |
| `pushChainHash()` | `bytes32` | `keccak256("eip155:" ‖ block.chainid)` at initialization. |
| `isAGWFree(address agw)` | `bool` | False while the AGW's last job started here is Funded, Submitted, or Open and unexpired (§10). |
| `expectedCEAOf(address agw, bytes32 chainHash)` | `address` | The AGW's CEA on that chain (§9). Reverts `ChainNotSupported(chainHash)` if unconfigured. |
| `buildCreateJobCalldata(uint256 cardId, address owner, uint96 index, JobInputs job)` | `(bytes32 mode, bytes executionCalldata)` | Exactly what `startJob` executes for wallet `index` of `owner`. Reverts `CardInactive()` for an unknown card, and like step 9 on a bad template or bad inputs. |
| `previewIntent(IntentRequest r, Session s)` | `OwnerIntent` | The intent to sign (§8). Nonces are read from the wallet, or 0 if not yet deployed. Reverts like `buildCreateJobCalldata`. |
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
| `nonceKey` | `STARTJOB_LANE` |
| `nonceSeq` | `AGW.getNonce(STARTJOB_LANE)` if deployed, else 0 |
| `grantNonce` | `AGW.grantNonce()` if deployed, else 0 |

### Constants

| Constant | Value | Use |
|---|---|---|
| `ADMIN_ROLE` | `keccak256("ADMIN_ROLE")` | every admin function |
| `STARTJOB_LANE` | `OWNER_LANE_FLAG` (`1 << 191`) | the AGW nonce lane `startJob`'s execution uses (owner lane, key 0) |
| `MODE_SINGLE` | `bytes32(0)` | ERC-7579 single call, default exec type |
| `MIN_DURATION` (internal) | `1 hours` | lower bound on a card's `minDuration` |
| `EVM_PREFIX` (internal) | `"eip155:"` | required prefix of a card's `chainNamespace` |

### Storage layout

Append-only from this layout. OZ upgradeable bases use ERC-7201 namespaced storage and occupy none of these
slots. Pinned by `test_MV09_storageLayout_bySlot`.

| Slot | Variable | Type |
|---|---|---|
| 0 | `AGW_FACTORY` | `IAGWFactory` |
| 1 | `KERNEL` | `IAgenticCommerce` |
| 2 | `hook` | `address` |
| 3 | `evaluator` | `address` |
| 4 | `pushChainHash` | `bytes32` |
| 5 | `TERMS` | `IUniversalMarketplaceTerms` |
| 6 | `cardCount` | `uint256` |
| 7 | `_cards` | `mapping(uint256 => AgentCard)` |
| 8 | `_rulesTerms` | `mapping(uint256 => bytes)` |
| 9 | `_evaluations` | `mapping(uint256 => bytes)` |
| 10 | `cardVersion` | `mapping(uint256 => uint256)` |
| 11 | `isCardVerified` | `mapping(uint256 => bool)` |
| 12 | `isCardAdminDisabled` | `mapping(uint256 => bool)` |
| 13 | `ceaDeployment` | `mapping(bytes32 => CEADeployment)` |
| 14 | `isUniversalPaused` | `mapping(bytes32 => bool)` |
| 15 | `lastJobOf` | `mapping(address => uint256)` |
| 16 | `cardOfJob` | `mapping(uint256 => uint256)` |
| 17 | `agwOfJob` | `mapping(uint256 => address)` |
| 18 | `rulesOfJob` | `mapping(uint256 => bytes32)` |
| 19–48 | `__gap` | `uint256[30]` |

---

## UniversalMarketplaceTerms

[`src/agentic-commerce-8183/UniversalMarketplaceTerms.sol`](../../src/agentic-commerce-8183/UniversalMarketplaceTerms.sol).
Stateless and `pure`, with no admin and no upgrade. Split out of the marketplace for EIP-170. Reverts with
`UniversalMarketplaceErrors`, so its reverts bubble through the marketplace unchanged.

| Constant | Value |
|---|---|
| `MAX_ALLOWED_CALLS` | 32 (URP's allow-list bound) |
| `MAX_APPROVALS` | 8 |
| `ERC20_TRANSFER` / `ERC20_APPROVE` / `ERC20_TRANSFER_FROM` | `IERC20.transfer/approve/transferFrom.selector` (`0xa9059cbb` / `0x095ea7b3` / `0x23b872dd`) |
| `ERC20_INCREASE_ALLOWANCE` | `bytes4(keccak256("increaseAllowance(address,uint256)"))` (`0x39509351`) |

#### `validateRulesTerms(bytes calldata rulesTerms) external pure returns (address asset)`
Decodes `RulesCardTerms` and runs the registration guards of §6.1. Returns the rules asset. Undecodable bytes
revert in `abi.decode`.

#### `verifySession(bytes calldata rulesTerms, Session calldata s, SessionContext calldata ctx) external pure`
The rules ⊆ card check of §6.2, ten checks in order. `ctx` is
`SessionContext{agent, chainHash, principal, expiredAt, expectedCEA}`, filled by the marketplace from the card,
the job and `expectedCEAOf`. The fields it does not compare are listed in §13.2.

---

## JobSpecBuilder

[`src/agentic-commerce-8183/libraries/JobSpecBuilder.sol`](../../src/agentic-commerce-8183/libraries/JobSpecBuilder.sol).
An external library: deployed once, linked into the marketplace, called by `DELEGATECALL`. Inlined, it would put
the marketplace over the size limit.

#### `build(bytes memory evaluation, BuildContext memory ctx) public view returns (bytes memory)`
Returns `abi.encode(JobSpec)` for one job: the 8183 job's description. Algorithm and checks are in
[`criteria.md`](./criteria.md#building-a-jobspec).

`BuildContext{agw, principal, executeBy, settleWindow, params, origin}` comes from the job's inputs, the card's
`settleWindow`, and `origin = keccak256(abi.encode(marketplace, cardId, cardVersion, principal))`.

The library reads CEAs with `IUniversalMarketplace(address(this)).expectedCEAOf(agw, chainHash)`. Under
`DELEGATECALL`, `address(this)` is the marketplace proxy, so this is an external call back into the marketplace.
Called directly (not through the marketplace), a template that needs a CEA reverts, because the library would ask
itself. It has no storage.

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
| `beforeAction(fund)` | In order: `fund.optParams` is exactly 32 bytes, `abi.encode(rulesId)` (`InvalidOptParams(length)`); the client is a factory AGW (`CallerIsNotAGW(caller)`); `SESSION_ENGINE.isPermissionEnabled(rulesId, client)` (`RulesNotLive(agw, rulesId)`); the AGW has no Funded or Submitted job under this hook (`AGWHasLiveJob(agw, liveJobId)`). Then records `rulesOf[jobId] = {agw, rulesId}`, `liveJobOf[agw] = jobId`, and emits `RulesBound(jobId, agw, rulesId)`. |
| `isAGWBusy(address agw)` | Whether the AGW's bound job is Funded or Submitted. |
| `rulesOf(uint256 jobId)` | `(address agw, bytes32 rulesId)` bound at `fund`. |
| `liveJobOf(address agw)` | The last job bound for the AGW. |

Because the hook runs in `beforeAction`, any revert leaves the job Open with no escrow moved. A wallet is freed
by reading the kernel's job status, so an unhooked `claimRefund` frees it too.

---

## Types

All in [`libraries/Types.sol`](../../src/agentic-commerce-8183/libraries/Types.sol), file-level. The built
criteria (`JobSpec`, `Read`, `Check`, `Node` and the enums) are in
[`libraries/JobSpecTypes.sol`](../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol). The AGW and
SmartSession types (`OwnerIntent`, `Session`, `AllowedCall`, `UniversalTerms`, …) are mirrored in
[`interfaces/external/IAGW.sol`](../../src/agentic-commerce-8183/interfaces/external/IAGW.sol).

| Type | Fields | Notes |
|---|---|---|
| `AgentCard` | `provider`, `jobType`, `metadataURI`, `metadataHash`, `chainNamespace`, `fee`, `principalMin`, `principalMax`, `minDuration`, `maxDuration`, `minExecuteWindow`, `settleWindow`, `active` | `provider` and `active` are contract-written. `chainNamespace` is the full CAIP-2 string `"eip155:<id>"`, immutable after registration. `fee` is in the kernel's payment token; principal is in the rules asset's units; durations and windows in seconds. |
| `Approval` | `token`, `spender`, `capIsPrincipal`, `cap` | An owner approval on the execution chain. `capIsPrincipal` ⇒ amount = principal, `cap == 0`; else amount = `cap > 0`. |
| `RulesCardTerms` | `asset`, `maxPCPerCall`, `allowedCalls`, `approvals` | `abi.encode`d into the card's `rulesTerms`. |
| `CEADeployment` | `ceaFactory`, `ceaProxyImpl` | Per destination chain. |
| `CardView` | `card`, `rulesTerms`, `evaluation`, `version`, `verified`, `adminDisabled` | `getCard`'s return. |
| `JobInputs` | `principal`, `expiredAt` (uint48), `executeBy` (uint48), `params` (int256[]) | Per-job inputs the owner signs. |
| `StartJobParams` | `cardId`, `cardVersion`, `job`, `session`, `intent`, `sig`, `label` | `startJob`'s argument. |
| `IntentRequest` | `cardId`, `owner`, `index`, `job`, `deadline`, `signerChainId` | `previewIntent`'s argument. |
| `InitParams` | `agwFactory`, `kernel`, `hook`, `evaluator`, `terms`, `admin` | `initialize`'s argument. |
| `SessionContext` | `agent`, `chainHash`, `principal`, `expiredAt`, `expectedCEA` | Terms' per-job context. |
| `FillSource`, `Fill`, `ReadTemplate`, `TargetSource`, `CheckTemplate`, `ParamBounds`, `EvaluationTemplate`, `BuildContext` | | The criteria template; see [`criteria.md`](./criteria.md). |

---

## Events

Emitted by the marketplace (declared in `IUniversalMarketplace`):

| Event | Emitted by |
|---|---|
| `CardRegistered(uint256 indexed cardId, address indexed provider, bytes32 indexed jobType, string chainNamespace, bytes32 rulesHash, bytes32 evaluationHash, bytes32 metadataHash, uint256 fee)` | `registerCard` |
| `CardModified(uint256 indexed cardId, uint256 version, bytes32 rulesHash, bytes32 evaluationHash, bytes32 metadataHash, uint256 fee)` | `modifyAgentCard` |
| `CardStatusChanged(uint256 indexed cardId, bool active)` | `setCardActive` |
| `CardDisabledByAdmin(uint256 indexed cardId)` | `adminDisableCard` |
| `CardVerified(uint256 indexed cardId, uint256 version)` | `verifyAgentCard` |
| `CardVerificationRevoked(uint256 indexed cardId)` | `revokeAgentCardVerification`, `modifyAgentCard`, `adminDisableCard` (only when a tag is cleared) |
| `HookUpdated(address hook)` | `initialize`, `setHook` |
| `EvaluatorUpdated(address evaluator)` | `initialize`, `setEvaluator` |
| `CEADeploymentSet(bytes32 indexed chainHash, address ceaFactory, address ceaProxyImpl)` | `setCEADeployment` |
| `UniversalChainPaused(bytes32 indexed chainHash, bool paused)` | `setUniversalPaused` |
| `JobStarted(uint256 indexed cardId, address indexed owner, address indexed agw, uint256 jobId, bytes32 rulesId, uint256 principal, uint256 cardVersion)` | `startJob` |

`rulesHash = keccak256(rulesTerms)` and `evaluationHash = keccak256(evaluation)`, so an indexer can check the
blobs returned by `getCard`. The hook emits `RulesBound(uint256 indexed jobId, address indexed agw, bytes32 indexed rulesId)`.
OZ emits `RoleGranted`, `Paused`, `Unpaused`, `Initialized`.

---

## Errors

All marketplace, Terms and builder errors are in the `UniversalMarketplaceErrors` library
([`libraries/Errors.sol`](../../src/agentic-commerce-8183/libraries/Errors.sol)). A library error has the same
selector wherever it is raised, so a Terms or builder revert bubbles through `startJob` unchanged.

Each contract's ABI lists only the errors that contract itself raises. **Decode marketplace reverts with the
`UniversalMarketplaceErrors` artifact**, which lists all 37.

### Config and cards

| Error | Raised by | When |
|---|---|---|
| `ZeroAddress()` | marketplace | a zero address in `initialize`, `setHook`, `setEvaluator`, `setCEADeployment` |
| `HookNotWhitelisted()` | marketplace | the hook is not whitelisted on the kernel |
| `CardInactive()` | marketplace | `startJob` on an unknown or inactive card; `adminDisableCard`, `verifyAgentCard`, `revokeAgentCardVerification`, `buildCreateJobCalldata`, `previewIntent` on an unknown card |
| `CallerIsNotProvider()` | marketplace | `modifyAgentCard` / `setCardActive` by anyone but the provider, or on an unknown card |
| `CardAdminDisabled(uint256 cardId)` | marketplace | modify, verify or switch on an admin-disabled card |
| `ChainNotSupported(bytes32 chainHash)` | marketplace, builder | a card on Push or on an unconfigured chain; `expectedCEAOf` for an unconfigured chain |
| `ChainPaused(bytes32 chainHash)` | marketplace | `startJob` on a paused chain |
| `InvalidCard(string reason)` | marketplace, Terms | a registration / modification check failed; the reasons are below |
| `CardVersionMismatch(uint256 provided, uint256 current)` | marketplace | `startJob` or `verifyAgentCard` with a stale version |
| `CardIdentityImmutable()` | marketplace | `modifyAgentCard` changing `chainNamespace` |

`InvalidCard` reasons:

| Raised by | Reasons |
|---|---|
| marketplace | `job type zero`, `metadata uri empty`, `metadata hash zero`, `chain namespace`, `provider is evaluator`, `principal range`, `duration range`, `settle window`, `execute window`, `asset`, `asset chain` |
| Terms | `asset zero`, `allow-list size`, `duplicate call`, `erc20 approval`, `erc20 transfer recipient`, `erc20 transferFrom recipient`, `approval count`, `approval token`, `approval spender`, `approval cap`, `duplicate approval` |

### startJob: the job

| Error | Raised by | When |
|---|---|---|
| `PrincipalOutOfRange()` | marketplace | principal outside the card's range |
| `ExpiryOutOfRange()` | marketplace | `expiredAt` outside `[now + minDuration, now + maxDuration]` |
| `ExecuteByOutOfRange()` | marketplace | `executeBy < now + minExecuteWindow` or `executeBy + settleWindow > expiredAt` |
| `ProviderIsEvaluator()` | marketplace | the card's provider is the current evaluator |
| `ParamCountMismatch(uint256 expected, uint256 actual)` | builder | wrong number of params |
| `ParamOutOfRange(uint256 index, int256 value)` | builder | a param outside its bounds |
| `TargetOverflow(uint256 check)` | builder | `principal × bps` overflows |
| `FillOutOfBounds(uint256 read, uint256 fill)` | builder | a fill writes outside its read's args |

### startJob: wallet and intent

Same shapes as the AGW's errors of the same name.

| Error | When |
|---|---|
| `IntentWalletMismatch(address expected, address provided)` | the intent's wallet is not `predictWallet(owner, index)` |
| `ExecutorMismatch(address expected, address actual)` | the intent's executor is not the marketplace |
| `IntentSessionMismatch(bytes32 actual)` | the intent's `sessionHash` is not this session's hash (argument: the expected hash) |
| `IntentExecMismatch(bytes32 actualCalldataHash)` | the intent's mode, calldata hash or nonce lane is not this job's (argument: the expected calldata hash) |
| `AGWBusy(address agw, uint256 jobId)` | the AGW has a live job started here |
| `AGWMismatch(address expected, address actual)` | the factory deployed somewhere other than the prediction |
| `WalletOwnerMismatch(address expected, address actual)` | the existing wallet's factory owner is not the intent's owner |

### startJob: rules ⊆ card (Terms)

| Error | When |
|---|---|
| `AgentMismatch()` | `sessionValidatorInitData != abi.encode(card.provider)` |
| `ActionCount()` | the session has not exactly one action |
| `PolicyShape(uint256 i)` | the action has not exactly one policy |
| `ChainMismatch(uint256 i)` | the envelope names another chain |
| `AssetMismatch()` | another asset |
| `PCCapMismatch()` | another `maxPCPerCall` |
| `ActionsMismatch()` | the allowed calls are not byte-equal to the card's |
| `CapMismatch()` | `maxAmountTotal != principal` or `maxAmountPerCall > principal` |
| `ExpiryMismatch()` | `validUntil != expiredAt` |
| `ExpectedCEAMismatch(address expected, address actual)` | the session's CEA is not `expectedCEAOf(agw, chainHash)` |

### startJob: the created job

| Error | When |
|---|---|
| `UnexpectedJobCount(uint256 before, uint256 afterCount)` | the wallet's execution did not create exactly one job |
| `JobMismatch()` | the new job's client, provider, hook or evaluator is not the expected one |

### Hook errors

| Library | Error |
|---|---|
| `RulesBindingHookErrors` | `InvalidOptParams(uint256 length)`, `CallerIsNotAGW(address caller)`, `RulesNotLive(address agw, bytes32 rulesId)`, `AGWHasLiveJob(address agw, uint256 liveJobId)` |
| `ERC8183HookErrors` | `CallerIsNotKernel(address caller)`, `ZeroAddress()` |
