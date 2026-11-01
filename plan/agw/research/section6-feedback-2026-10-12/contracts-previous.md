# 1. AGW Contract Changes (nomenclature standard + change set)

<aside>
🔧

**Where we are going.** AGW contracts at their permanent Donut addresses, named like the rest of the Push codebase, with everything the marketplace and 8183 need from the wallet built in: signature-authorized deploy, grant and execute; checkpoints; a job reference on every grant; a versioned rules envelope; a Solana rulebook. One change set, one audit, then the permanent deployment.

**What this page is.** The naming standard AGW adopts from core and gateway, the decisions taken, the rename map, and the contract surface as a diff.

**Read first.** Section 0. AGW will break when the gateway is upgraded unless the URP change ships with it.

</aside>

# 0. Before the naming: AGW will break when the gateway is upgraded

**What happened.** The gateway team changed the outbound request struct on GitHub main. Two fields are gone (`gasPrice`, `maxPCForGas`). AGW copied the old struct into its own repo and URP checks one of the removed fields (gate 9: `maxPCForGas` must be non-zero).

**Why it still works today.** Donut is still running the old gateway (implementation `0x1e41...a659` has the old eight fields).

**What breaks.** The day the new gateway is deployed on Donut, every cross-chain rule set stops working: URP rejects every request.

**Fix, two rules.**

1. AGW never copies a gateway or core struct. It imports them from the gateway and core packages, so a change upstream fails the build instead of failing on-chain.
2. The URP upgrade and the gateway upgrade go out together, not separately.

Same rule for the selector: derive `sendUniversalTxOutbound.selector` from the interface, do not hardcode `0x77b86bec`.

# 1. How core and gateway name things (the standard AGW follows)

These conventions already exist in `push-chain-core-contracts` and `push-chain-gateway-contracts`. AGW adopts them as is. Where the two repos disagree, the AGW column says which one wins.

| Area | Convention | Example | AGW |
| --- | --- | --- | --- |
| Contract names | Chain-agnostic components spell out Universal. Push-side variants add PC. Accounts are 3-letter acronyms. | `UniversalCore`, `UniversalGatewayPC`, `UEA`, `CEAFactory` | `AGW`, `AGWFactory`, `UniversalRulesPolicy` |
| Errors | One `libraries/Errors.sol` per repo, one error library per contract, PascalCase, arguments only when the caller needs them. Caller checks are `CallerIsNotX`. | `UEAErrors.InvalidCall()`, `CommonErrors.ZeroAddress()`, `CallerIsNotUEModule()` | `AGWErrors`, `AGWFactoryErrors`, `UniversalRulesPolicyErrors` |
| Types and constants | One `libraries/Types.sol`, plain file-level structs, `UPPER_SNAKE` constants, selectors derived not hardcoded. | `struct Multicall`, `MULTICALL_SELECTOR = bytes4(keccak256("UEA_MULTICALL"))` | `libraries/Types.sol`; gateway and core structs imported, never copied |
| Request shape | One `XRequest` struct as the single argument; the contract infers the kind. Users never state a type. | `sendUniversalTxOutbound(UniversalOutboundTxRequest req)` infers `TX_TYPE` | `grantRules(Session)` infers `NATIVE` vs `UNIVERSAL` from `chainNamespace` |
| Interface sections | Tag plus number banners, events first, NatSpec on everything. | `UGPC_1: EVENTS`, `UGPC_2: OUTBOUND TX`, `UGPC_3: VIEW FUNCTIONS` | `AGW_1: EVENTS` ... `AGW_5: VIEWS`, `URP_1` ... `URP_3` |
| Functions | `setX`, `getX`, `isX`. Set-once wiring is read through `UPPER_CASE()` getters. | `isSupportedToken()`, `UNIVERSAL_CORE()` | `SESSION_ENGINE()`, `RULES_POLICY()`, `UNIVERSAL_GATEWAY_PC()` |
| Storage | Internal state is underscore-prefixed. | `_walletCount` | `_` everywhere; drop URP's `$` prefix |
| Roles | `UPPER_SNAKE_ROLE`. | `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE`, `TSS_ROLE` | same; `PAUSER` and `OPERATOR` split kept, documented |
| Chain identity | Full CAIP-2 string, field named `chainNamespace`. | `"eip155:1"` | envelope field renamed `chain` to `chainNamespace` |
| Events | No consistent rule upstream. | `SetChainMeta` (imperative), `VaultPCUpdated` (past) | past tense: `RulesGranted`, `WalletDeployed` |
| Layout | `src/` with `interfaces/` and `libraries/`; numbered docs and tests; addresses per network; `CLAUDE.md` in every package. | `docs/1_PUSH_CHAIN.md`, `test/gateway/1_adminActions.t.sol`, `docs/addresses/sepolia.md` | same, see rename map |

#### Where each convention was seen (open only if you want the receipts)

Core repo, folder layout:

```
src/
  Interfaces/     IUniversalCore.sol, IUEA.sol, ICEA.sol
  libraries/      Errors.sol, Types.sol, Utils.sol
  uea/            UEAFactory.sol, UEA_EVM.sol, UEA_SVM.sol
  cea/            CEAFactory.sol, CEA.sol
  UniversalCore.sol, PRC20.sol, WPC.sol
```

Gateway repo, folder layout:

```
contracts/evm-gateway/
  src/            UniversalGateway.sol, UniversalGatewayPC.sol, Vault.sol, VaultPC.sol
  src/interfaces/ IUniversalGatewayPC.sol, IVault.sol
  src/libraries/  Errors.sol, Types.sol, TypesUG.sol, TypesUGPC.sol
  docs/           1_PUSH_CHAIN.md, 2_UniversalGateway.md, 3_UniversalGatewayPC.md
  docs/addresses/ sepolia.md, bsc-testnet.md
  test/gateway/   1_adminActions.t.sol ... 14_gatewayPC.t.sol
  script/         1_DeployGatewayWithProxy.sol, 3_UpgradeGatewayNewImpl.sol
  CLAUDE.md
```

Errors (core, `libraries/Errors.sol`):

```solidity
library CommonErrors        { error ZeroAddress(); error Unauthorized(); error InvalidInput(); }
library UniversalCoreErrors { error CallerIsNotUEModule(); error GasLimitBelowBase(uint256 provided, uint256 minimum); }
library UEAErrors           { error InvalidCall(); error ExecutionFailed(); }
```

Types (core, `libraries/Types.sol`):

```solidity
struct UniversalAccountId { string chainNamespace; string chainId; bytes owner; }
struct Multicall          { address to; uint256 value; bytes data; }
bytes4 constant MULTICALL_SELECTOR = bytes4(keccak256("UEA_MULTICALL"));
```

Request shape (gateway, `TypesUGPC.sol` and `IUniversalGatewayPC.sol`):

```solidity
struct UniversalOutboundTxRequest { bytes recipient; address token; uint256 amount; uint256 gasLimit; bytes payload; address revertRecipient; }
function sendUniversalTxOutbound(UniversalOutboundTxRequest calldata req) external payable;   // TX_TYPE inferred inside
```

Interface sections and wiring getters (gateway, `IUniversalGatewayPC.sol`):

```solidity
// UGPC_1: EVENTS
// UGPC_2: OUTBOUND TX
// UGPC_3: VIEW FUNCTIONS
function UNIVERSAL_CORE() external view returns (address);
```

Events (both repos, no single rule):

```solidity
event SetChainMeta(...);          // core, imperative
event PauserRoleGranted(...);     // core, past tense
event UniversalTxOutbound(...);   // gateway, noun
event VaultPCUpdated(...);        // gateway, past tense
```

Chain identity, the same field name with two meanings:

```solidity
gasPriceByChainNamespace("eip155:1")                              // UniversalCore: full CAIP-2 string
UniversalAccountId({ chainNamespace: "eip155", chainId: "1" })    // Read State: split
```

# 2. Decisions

| # | Decision | Outcome |
| --- | --- | --- |
| D1 | Wallet contract name | **AGW.sol** (account acronym like UEA, CEA). Full form "Agentic Wallet" in the NatSpec title only. Factory stays `AGWFactory.sol`. |
| D2 | Policy contract name | **UniversalRulesPolicy.sol**. `URP` stays as the short form in comments, events and the SDK constant, the way `UGPC` stands for `UniversalGatewayPC`. |
| D3 | Validator contract name | PROPOSED 2026-09-29: **no validator.** The agent is a Push address: a native key is its own EOA, any external key (EVM, Solana, anything) is its UEA, deterministic from (chain, owner). Cross-VM signature verification already happens inside the UEA, so the agent door checks `msg.sender == rules.agent` and hands the calls to URP. `PushSessionValidator.sol` is removed rather than renamed. Pending one check against the v3 branch: how deep SmartSession's signature path is wired into the engine calls URP relies on, and whether the policy engine can be driven from a sender check without forking it. |
| D4 | Vocabulary for the granted object | **rules, one word everywhere.** On-chain: `grantRules`, `revokeRules`, `revokeAllRules`, `rulesId`, `RulesGranted`, `RulesRevoked`, `RulesActionAuthorized`. Layer: Universal Rules. SDK: `client.agentic.rules`. `permissionId` remains the SmartSession-internal name and is exposed as `rulesId`. `mandate` is retired from code, docs and copy.
**Rename boundary (2026-09-29).** Three vocabularies live in the fork; only ours is renamed. ERC-7579 names stay (`execute(mode, executionCalldata)`, `ModeCode`, module types, `installModule`). SmartSession names stay inside the engine and on the interfaces URP implements (`Session`, `permissionId`, `PolicyData`, `ActionData`, `ConfigId`, `enableSessions`, `isPermissionEnabled`, `IPolicy.checkAction`, `initializeWithMultiplexer`): audit history and upstream diffs attach to those names. Push's own words (`mandate`, `PushAgentWallet`, our events, envelope, docs, SDK) become rules. The seam is the AGW ABI: `rulesId` is computed by the engine's `getPermissionId(Session)` and the NatSpec states `rulesId == permissionId`. If the engine is vendored with edits, it lives in `src/vendor/smartsession/` with a note naming the upstream commit and every local change. If D3 ends with the engine dropped, SmartSession vocabulary leaves with it. |
| D5 | Door functions | Keep `execute` (owner door). Agent door becomes `executeAsAgent(bytes32 rulesId, bytes32 mode, bytes executionCalldata)`, gated on `msg.sender == rules.agent`, replacing `executeWithSession` and its signature blob (follows D3). "Owner door" and "agent door" stay as NatSpec language. |
| D6 | Chain field in the envelope | Rename `chain` to `chainNamespace`, full CAIP-2 string, matching `UniversalCore` and gateway events. Read State keeps its split fields; the SDK converts. |
| D7 | Mode names | `NATIVE` and `UNIVERSAL` stay. The SVM rulebook is selected by the `solana` namespace inside `UNIVERSAL`; no new mode name. |

# 3. Rename map (current to proposed)

| Area | Today | Proposed |
| --- | --- | --- |
| Inherited names (7579, SmartSession) | `execute(mode, executionCalldata)`, `Session`, `permissionId`, `PolicyData`, `ActionData`, `ConfigId`, `checkAction`, `initializeWithMultiplexer` | unchanged (see D4 rename boundary) |
| Wallet | `PushAgentWallet.sol` | `AGW.sol` |
| Factory | `AGWFactory.sol` | `AGWFactory.sol` (unchanged) |
| Policy | `policies/URP.sol` | `UniversalRulesPolicy.sol` |
| Validator | `validators/PushSessionValidator.sol` | removed (D3): agent identity is a Push address, verification lives in the UEA |
| Interfaces | `IPushAgentWallet`, `IURP`, `IPushSessionValidator`, local `IUniversalGatewayPC`, `IPRC20Source` | `IAGW`, `IUniversalRulesPolicy`; gateway and core interfaces imported (`IUEAFactory` for `computeUEA` in tests and tooling) |
| Errors | `libraries/PushWalletErrors.sol` plus errors declared in `IURP` and `IAGWFactory` | `libraries/Errors.sol` with `AGWErrors`, `AGWFactoryErrors`, `UniversalRulesPolicyErrors`; reuse `CommonErrors` names (`ZeroAddress`, `Unauthorized`, `AlreadyInitialized`); `AGWErrors.CallerIsNotAgent()` |
| Types | `libraries/PushWalletTypes.sol` re-declares `UniversalOutboundTxRequest`, `Multicall` | `libraries/Types.sol` with AGW-owned structs only (`RulesEnvelope`, `NativeTerms`, `UniversalTerms`, `AllowedCall`, `ArgPin`, `AmountRule`); gateway and core types imported |
| Grant / revoke | `grantMandate`, `stopMandate`, `stopAll` | `grantRules`, `revokeRules`, `revokeAllRules` |
| Events | `MandateGranted`, `MandateRevoked`, `MandateActionAuthorized`, `URPPolicySet` | `RulesGranted`, `RulesRevoked`, `RulesActionAuthorized`, `RulesConfigured` |
| Ids | `permissionId` in wallet ABI | `rulesId` in wallet ABI (engine keeps `permissionId` internally) |
| Wiring getters | `sessionEngine()`, `urp()`, `sessionValidator()`, `universalGateway()` | `SESSION_ENGINE()`, `RULES_POLICY()`, `UNIVERSAL_GATEWAY_PC()` (no validator getter, D3) |
| Storage prefix | `_` in wallet and factory, `$` in URP | `_` everywhere |
| Envelope | `abi.encode(string chain, bytes body)` | `abi.encode(uint16 version, string chainNamespace, bytes body)` |
| Interface banners | none | `AGW_1: EVENTS`, `AGW_2: OWNER DOOR`, `AGW_3: AGENT DOOR`, `AGW_4: RULES LIFECYCLE`, `AGW_5: VIEWS`; `URP_1: EVENTS`, `URP_2: POLICY`, `URP_3: VIEWS`; `AGWF_1: EVENTS`, `AGWF_2: DEPLOY`, `AGWF_3: VIEWS` |
| Selector constant | `SEND_OUTBOUND_SELECTOR = 0x77b86bec` | derived from `IUniversalGatewayPC` |
| Roles | `PAUSER_ROLE` pauses, `OPERATOR_ROLE` unpauses | keep the split, document it as a deliberate deviation from gateway |
| Event tense | past tense | past tense, written down as the rule |
| Docs | `docs/v3-architecture.md`, `agentic_wallet_flow.md`, `push_native_agentic_wallet_flow.md` | `docs/1_AGW.md`, `2_UniversalRulesPolicy.md`, `3_Universal_Flow.md`, `4_Native_Flow.md` |
| Addresses | `deployments/address-book-v3/ADDRESSES.md` | `docs/addresses/donut.md` |
| Tests | `test/unit/*.t.sol`, `test/integration/*.t.sol` | numbered by area: `1_factory`, `2_ownerDoor`, `3_rulesLifecycle`, `4_agentDoor`, `5_universalRulebook`, `6_nativeRulebook`, `7_externalAgentViaUEA`, `8_e2e` |

# 4. Structural changes that ride along with the rename

Agreed on 2026-09-28. Listed here so the rename and the additions land in one change set and one audit, before the permanent deployment.

1. **Signature-authorized variants**: `deployWalletWithSig`, `grantRulesWithSig`, `executeWithSig`. One EIP-712 domain per contract. Digest includes chainid, contract, nonce (the wallet's grant nonce for grants; a per-owner nonce on the factory), deadline. Verify ECDSA, and ERC-1271 when the owner has code (a UEA).
2. **Checkpoints**: the wallet records owner-side changes an evaluator needs: principal moved out (owner-door value or token transfer out, and every outbound), rules granted, revoked or replaced, key changed. Per-wallet monotonic counter plus `Checkpointed(kind, ref, blockNumber)`, so an evaluator can ask "any checkpoint after block N" with one read.
3. **`bytes32 ref` on `grantRules`**, emitted in `RulesGranted`, so a job binds to a rules id and an indexer goes rules to job without the hook.
4. **Stop-only role: dropped for v1** (2026-10-01). A binder address that could call `revokeRules` and nothing else was considered so a job hook could end rules at job end. Not needed: rules expire by `validUntil`, which the fund hook requires to be at or after the job's `expiredAt`, caps bound the gap, and the hook keeps its own one-live-job slot. Additive to bring back later.
5. **Envelope version word**: `abi.encode(uint16 version, string chainNamespace, bytes body)`.
6. **`creditRevert` reachability**: wire the real executor module or replace the credit path. Today spend never decreases on Donut.
7. **SVM rulebook** in the policy, keyed by the `solana` namespace: 32-byte `expectedCEA` and targets, program plus instruction discriminator allow-list, beneficiary check over the accounts array, SVM payload gate.
8. **Import gateway and core types**, derive the outbound selector, sequence the URP upgrade with the gateway's struct change.
9. **Agent identity is a Push address** (2026-09-29). The rules name an address: an EOA, or the UEA of an external key. The agent door checks the sender instead of verifying a session signature; the validator contract goes. One identity for rules, card and 8183 provider, so the fund hook matches by equality. Sizing against the v3 branch pending (D3).
10. **Editable label** (2026-10-01). `setLabel(string label)` on AGW, owner only, emits `LabelSet(string label)`. Today the label is only passed at `deployWallet` and emitted in `WalletDeployed`. Not a checkpoint kind: cosmetic metadata, evaluators ignore it. SDK: `w.setLabel(label)` on page 5.

# 4b. Contract surface, as a diff

Read `+` as added, `-` as removed, `~` as changed in place, `=` as unchanged. Names are the post-rename names. Storage slots never move; renames are labels only.

**AGWFactory**

```diff
= deployWallet(string label) returns (address wallet)                     // caller is the owner
+ deployWalletWithSig(address owner, uint96 index, string label,
+                     uint48 deadline, bytes ownerSig) returns (address)  // EIP-712; index must equal walletCount(owner)
+                                                                          // ownerSig: ECDSA, or ERC-1271 when owner has code (UEA)
+ DOMAIN_SEPARATOR() view returns (bytes32)
= predictWallet(address owner, uint256 index) view returns (address, bool deployed)
= walletCount / ownerOf / isWallet / indexOf / walletImplementation
= pause() PAUSER_ROLE, unpause() OPERATOR_ROLE
= event WalletDeployed(owner, index, wallet, label)
```

**AGW** (was PushAgentWallet)

```diff
// owner door
= execute(bytes32 mode, bytes executionCalldata) payable                  // owner only, no policy
~ execute now emits Checkpointed(seq, OWNER_ACTION, keccak(calldata), block)
+ executeWithSig(bytes32 mode, bytes executionCalldata,
+                uint64 ownerNonce, uint48 deadline, bytes ownerSig)       // owner door by signature, same effects as execute
+ ownerNonce() view returns (uint64)
+ setLabel(string label)                                                 // owner only; emits LabelSet; not a checkpoint

// rules lifecycle
- grantMandate(Session) returns (bytes32 permissionId)
+ grantRules(Session session, bytes32 ref) returns (bytes32 rulesId)      // ref: job or card reference, emitted, not interpreted
+ grantRulesWithSig(Session session, bytes32 ref, uint48 deadline, bytes ownerSig) returns (bytes32 rulesId)
+                                                                          // digest includes grantNonce, so a signed grant cannot replay
- stopMandate(bytes32 permissionId)
+ revokeRules(bytes32 rulesId)                                            // owner or self
- stopAll()
+ revokeAllRules()                                                        // owner or self

// agent door (D3, D5)
- executeWithSession(address validator, bytes32 mode, bytes executionCalldata,
-                    bytes signature, uint192 nonceKey, uint64 nonceSeq, uint48 requestExpiry)
+ executeAsAgent(bytes32 rulesId, bytes32 mode, bytes executionCalldata)
+   requires msg.sender == agentOf(rulesId); replay and expiry come from the sender's own tx (EOA nonce, or the UEA's)
+   URP checks every call exactly as before; no signature blob, no validator address
+ agentOf(bytes32 rulesId) view returns (address)

// checkpoints
+ checkpointCount() view returns (uint64)
+ lastCheckpointBlock() view returns (uint64)
+ event Checkpointed(uint64 indexed seq, uint8 kind, bytes32 ref, uint64 blockNumber)
+   kind: 0 OWNER_ACTION (any owner-door execute), 1 RULES_GRANTED, 2 RULES_REVOKED
+   emitted from execute, executeWithSig, grantRules*, revokeRules, revokeAllRules

// views (wiring, renamed to UPPER_CASE)
- sessionEngine() urp() sessionValidator() universalGateway()
+ SESSION_ENGINE() RULES_POLICY() UNIVERSAL_GATEWAY_PC()
= owner() factory() grantNonce() getNonce(uint192) accountId()
+ DOMAIN_SEPARATOR() view returns (bytes32)

// events
- MandateGranted(permissionId, mandateType, chainHash, chain)
+ RulesGranted(bytes32 indexed rulesId, uint8 mode, bytes32 indexed chainHash, string chainNamespace, bytes32 ref)
- MandateRevoked(permissionId)
+ RulesRevoked(bytes32 indexed rulesId, address by)
- MandateActionAuthorized(permissionId, nonceKey, nonceSeq, opHash)
+ RulesActionAuthorized(bytes32 indexed rulesId, address indexed agent, bytes32 callsHash)
+ event LabelSet(string label)
```

**UniversalRulesPolicy** (was URP)

```diff
~ initializeWithMultiplexer(address account, ConfigId id, bytes initData)
~   initData = abi.encode(uint16 version, string chainNamespace, bytes body)   // was (string chain, bytes body)
~   rulebook chosen by namespace: this chain => native; eip155:* => universal EVM; solana:* => universal SVM
+ SVM rulebook
+   struct SvmTerms { uint48 validUntil; bytes32 expectedCEA; address asset; uint256 maxAmountPerCall;
+                     uint256 maxAmountTotal; uint256 maxPCPerCall; SvmAllowedCall[] allowedCalls; }
+   struct SvmAllowedCall { bytes32 program; bytes8 discriminator; uint8 beneficiaryAccountIndex; bool hasBeneficiary; uint64 maxLamports; }
+   gates mirror the EVM list; beneficiary checked in the accounts array, payload gate for the SVM outbound format
~ checkAction: UniversalOutboundTxRequest imported from the gateway package
~   gate 4c MIN_OUTBOUND_BODY_LEN recomputed from the imported struct
~   gate 9 (maxPCForGas != 0) removed when the six-field gateway struct lands; deploy in the same window
~ creditRevert(id, account, outboundTxId, amount): caller is the real executor module, set at initialize
=   or removed if the credit path is replaced (decision pending)
= assertSpent (both overloads), getConfig, getNativeConfig, getMode, pushChainHash, isCredited
+ getSvmConfig(ConfigId, address) view
- event URPPolicySet(...)
+ event RulesConfigured(bytes32 indexed configId, address indexed multiplexer, address indexed account, uint8 mode, bytes32 chainHash)
= OutboundMetered, NativeCallMetered, RevertCredited
~ storage variables renamed $configs, $credited, $mode, $native to _configs, _credited, _mode, _native (labels only, slots unchanged)
+ _svm mapping appended after _native; __gap shrinks by one
~ version() returns "2.0.0"
```

**PushSessionValidator**

```diff
- validateConfig(bytes keyConfig)
- validateSignatureWithData(bytes32 hash, bytes sig, bytes keyConfig)
- contract removed (D3). Session.sessionValidator and keyConfig are replaced by a single address in the rules: the agent.
```

**Not in this change set** (belongs to 8183, listed so nobody looks for it here): the fund hook's key-match and expiry checks, the marketplace, the evaluator.

# 4c. What the SDK rule shape changes in the contracts (PROPOSED 2026-10-02)

Page 5 (SDK: AGW) settled the shape of a cross-chain rule in `client.agentic.create`. Three of those SDK changes touch the contracts. Nothing else on page 5 does. Names are the post-rename names from section 3; struct changes are to the universal terms URP decodes from the rules envelope.

**1. One rule can move several tokens: `assets: AssetCap[]` replaces `asset`, `maxAmountPerCall`, `maxAmountTotal`.**

The SDK takes each asset as the token's address on the rule's chain (`MOVEABLE.TOKEN.<CHAIN>.<SYMBOL>` or the native marker) and resolves it to the PRC20 on Push before encoding, so the contract keeps storing PRC20 addresses. The spend counter becomes per asset.

```diff
// universal EVM terms (and SvmTerms, same change)
- address asset; uint256 maxAmountPerCall; uint256 maxAmountTotal;
+ AssetCap[] assets;                                        // 0..MAX_ASSETS; empty = call contracts, move nothing
+ struct AssetCap { address token; uint256 maxPerCall; uint256 maxTotal; }   // token: PRC20 on Push; maxTotal 0 = no total cap
+ uint8 constant MAX_ASSETS = 8;

// metering
~ amount gate: the token being moved must be one of assets[]; per-call and running total checked against that entry
~ _spent[configId] becomes per token: mapping(address token => uint256 spent)
~ assertSpent(configId, account) returns the per-token totals; the existing single-amount overload goes
~ OutboundMetered carries the token
```

**2. `maxGasPerCall` replaces `maxPCPerCall`.**

Rename only. Same meaning: the PC (wei) the wallet may pass as `msg.value` on one outbound for the destination leg. The gate that checks it does not change.

```diff
- uint256 maxPCPerCall;
+ uint256 maxGasPerCall;
```

**3. The struct, as it ends up.**

SDK side, what `create` takes per rule (page 5, 3.b). `agent` and `ref` go to `grantRules`, the rest is encoded into the rules envelope.

```tsx
interface UniversalRule {
  agent: Address;                       // Push address: EOA, or the UEA of an external key
  ref?: Hex;                            // emitted in RulesGranted, not interpreted
  chainNamespace: ForeignChainNamespace;
  assets: AssetCap[];                   // tokens the agent may move on chainNamespace; 0..8
  maxGasPerCall: bigint;                // PC (wei) per outbound for the destination leg
  validUntil: number;
  allowedCalls: AllowedCall[];
}

interface AssetCap {
  token: MoveableToken | Address;       // the other chain's token address (MOVEABLE.TOKEN.<CHAIN>.<SYMBOL>) or the native marker
  maxPerCall: bigint;
  maxTotal?: bigint;
}
```

Contract side, what URP decodes from the envelope body for an `eip155` namespace (`SvmTerms` takes the same `assets` and `maxGasPerCall` fields).

```solidity
struct AssetCap {
    address token;                      // PRC20 on Push, resolved by the SDK from the other chain's address
    uint256 maxPerCall;
    uint256 maxTotal;                   // 0 = no running cap
}

struct UniversalTerms {
    uint48        validUntil;
    bytes32       expectedCEA;
    AssetCap[]    assets;               // 0..MAX_ASSETS; empty = call contracts, move nothing
    uint256       maxGasPerCall;        // PC (wei) per outbound
    AllowedCall[] allowedCalls;         // unchanged
}

uint8 constant MAX_ASSETS = 8;
```

# 5. Open for review on this page

1. D3: removing the validator. Needs the v3 branch check on how SmartSession's engine is entered (signature path vs a sender-gated call into the same policy checks). If the engine cannot be entered without a signature, the fallback is a validator that accepts a trivial signature from the sender, which keeps the identity model and loses nothing but elegance.
2. Checkpoint kinds, since they are the evaluator's contract with the wallet.
3. `creditRevert`: wire the executor module, or replace the credit path.
4. Anything in the rename map or the diff that should stay as is.

The SDK surface lives on page 5 (SDK: AGW).