// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IERC165 } from "forge-std/interfaces/IERC165.sol";

import { ISmartSession } from "smartsessions/ISmartSession.sol";
import { Session, ActionData, PermissionId, ValidationData, SmartSessionMode } from "smartsessions/DataTypes.sol";
import { PackedUserOperation } from "account-abstraction/interfaces/PackedUserOperation.sol";
import { IModule as IERC7579Module } from "erc7579/interfaces/IERC7579Module.sol";

import { IAgentValidator } from "./interfaces/IAgentValidator.sol";
import { IAGW } from "./interfaces/IAGW.sol";
import { IAGWFactory } from "./interfaces/IAGWFactory.sol";
import { ISmartSessionConfigReader } from "./interfaces/ISmartSessionConfigReader.sol";
import { AGWErrors } from "./libraries/Errors.sol";
import { AgentConfigLib } from "./libraries/AgentConfigLib.sol";
import { PushChainLib } from "./libraries/PushChainLib.sol";
import { OwnerAuthLib } from "./libraries/OwnerAuthLib.sol";
import {
    OwnerIntent,
    OWNER_LANE_FLAG,
    SEND_OUTBOUND_SELECTOR,
    RulesType,
    CheckpointKind,
    MAX_LABEL_BYTES,
    ENGINE_FALLBACK_TARGET,
    ENGINE_FALLBACK_SELECTOR,
    ENGINE_FALLBACK_SELECTOR_SMARTSESSION
} from "./libraries/Types.sol";
import {
    ModeCode,
    CallType,
    ExecType,
    ModeLib,
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    EXECTYPE_DEFAULT
} from "./libraries/ModeLib.sol";
import { ExecutionLib, Execution } from "./libraries/ExecutionLib.sol";

/**
 * @title  AGW — Agentic Wallet
 * @notice The user's per-purpose agent wallet on Push Chain. It holds the budgeted funds and is
 *         `msg.sender` at the gateway, which is what binds it to its destination-chain account.
 *
 * @dev    - Push Chain has no ERC-4337 EntryPoint, so this wallet builds the operation and enforces
 *           the engine's verdict itself in `executeAsAgent`.
 *         - An ERC-7579 modular account restricted to validator modules; executor, fallback and
 *           hook modules are refused. A hook would run on the owner path and could block it.
 *         - `execute` is the owner door: no policy is ever consulted on it.
 *         - `executeAsAgent` is the agent door: callable only by the rules set's agent — a Push
 *           address (an EOA, or the UEA of an external key) — and every call is checked by the
 *           rules set's policy.
 *         - Deliberately near-stateless. A request exists only for the transaction that carries it.
 */
contract AGW is IAGW, ReentrancyGuardTransient {
    using ModeLib for ModeCode;

    /// @dev ERC-7579 account id, in vendor.account.semver form.
    string internal constant ACCOUNT_ID = "push.agw.1.0.0";

    /// @dev The only ERC-7579 module type this account supports.
    uint256 internal constant MODULE_TYPE_VALIDATOR = 1;

    /// @dev Gas stipend for a module's uninstall callback.
    uint256 internal constant UNINSTALL_CALLBACK_GAS_STIPEND = 100_000;

    /// @dev Gas cap on the pre-uninstall state probe of the session engine.
    uint256 internal constant ENGINE_STATE_PROBE_GAS = 30_000;

    /**
     * @dev Maximum actions in one NATIVE rules set. `UNIVERSAL` is always exactly one.
     *
     *      A SANITY BOUND, NOT A GAS BOUND — measured, a maximal 8x8 grant sits far inside the
     *      budget. It caps the O(n^2) duplicate scan below, the per-rules-set audit and UI surface a
     *      human has to reason about, and `revokeRules`'s engine-side cleanup cost.
     *
     *      Lives HERE, not in `Types.sol`, because it is a wallet policy number that URP never
     *      reads — unlike the engine mirrors, which are shared. Do not confuse it with URP's
     *      `MAX_ACTIONS_PER_REQUEST` (10): that bounds multicall ENTRIES inside one universal
     *      payload, two layers down. Different layers, different numbers, never conflated.
     */
    uint256 internal constant MAX_NATIVE_ACTIONS = 8;

    // The four wiring addresses, read through their UPPER_CASE() auto-getters. Resolved from the
    // implementation's runtime bytecode, so every clone reads them correctly through delegatecall.

    /// @notice The permission engine this wallet installs as its default validator.
    address public immutable SESSION_ENGINE;

    /// @notice The canonical action policy (URP) every rules set on this wallet must name.
    address public immutable RULES_POLICY;

    /// @notice The canonical session validator every rules set on this wallet must name — the sender
    ///         validator that confirms the caller is the rules set's agent.
    address public immutable SESSION_VALIDATOR;

    /// @notice The Push-side outbound gateway, the only target a universal agent action may reach.
    address public immutable UNIVERSAL_GATEWAY_PC;

    /// @dev One-shot latch for initializeAccount.
    bool private _initialized;

    /// @dev Monotonic salt source for permission ids; never reused.
    uint64 private _grantNonce;

    /// @dev Owner-side checkpoints so far; also the `seq` of the latest `Checkpointed`. Packed in slot 0.
    uint64 private _checkpointCount;

    /// @dev `block.number` of the latest checkpoint; zero before the first. Packed in slot 0.
    uint64 private _lastCheckpointBlock;

    /// @dev The account's entire module registry.
    mapping(address => bool) private _installedValidators;

    /// @dev Owner replay lanes for `executeWithSig`: lane key => next expected sequence number.
    mapping(uint192 => uint64) private _nonces;

    /// @dev The owner's label for this wallet; empty means the default `AGW <index + 1>`.
    string private _label;

    /**
     * @notice Sets the wallet's permanent wiring and locks the implementation itself.
     *
     * @dev    - Reverts with `InvalidModuleAddress` if any of the four addresses is zero.
     *         - Sets the initialised latch, so the implementation can never be initialised or
     *           driven directly; only clones of it can.
     *
     * @param  sessionEngine_       Permission engine installed as the default validator.
     * @param  rulesPolicy_        Canonical action policy every rules set must name.
     * @param  sessionValidator_    Canonical session validator every rules set must name.
     * @param  universalGatewayPC_  Push-side outbound gateway.
     */
    constructor(address sessionEngine_, address rulesPolicy_, address sessionValidator_, address universalGatewayPC_) {
        if (
            sessionEngine_ == address(0) || rulesPolicy_ == address(0) || sessionValidator_ == address(0)
                || universalGatewayPC_ == address(0)
        ) {
            revert AGWErrors.InvalidModuleAddress();
        }
        SESSION_ENGINE = sessionEngine_;
        RULES_POLICY = rulesPolicy_;
        SESSION_VALIDATOR = sessionValidator_;
        UNIVERSAL_GATEWAY_PC = universalGatewayPC_;

        _initialized = true;
    }

    /// @dev Reverts unless the caller is the clone's immutable-args owner.
    modifier onlyOwner() {
        if (msg.sender != _owner()) revert AGWErrors.CallerIsNotOwner();
        _;
    }

    /**
     * @dev Reverts unless the caller is the owner or the wallet itself. Applied to the three
     *      lifecycle functions and `setLabel` only.
     *
     *      - A batch entry targeting the wallet arrives with `msg.sender == address(this)`, so
     *        without this the owner's own one-signature change batch reverts against itself.
     *      - Widening to self is safe because self is reachable only through the owner door. From
     *        the agent door it is refused FOUR ways, in the order they fire:
     *          (a) at grant time, by `_requireGrantableTarget` — the wallet is never a grantable
     *              native action target;
     *          (b) at dispatch time, by the guard in `_gateAndDispatch` — which holds even for a
     *              session the owner enabled on the engine directly through the owner door,
     *              bypassing `grantRules` entirely;
     *          (c) by the engine's `NoPoliciesSet`, because (a) guarantees the wallet is never a
     *              configured action — true regardless of how many actions a rules set holds;
     *          (d) by the engine's `InvalidSelfCall`, for the `execute` selector specifically.
     *        (a) and (b) are never-delete tests.
     *      - Not applied to installModule or uninstallModule; nothing needs them batched.
     */
    modifier onlyOwnerOrSelf() {
        if (msg.sender != _owner() && msg.sender != address(this)) revert AGWErrors.CallerIsNotOwner();
        _;
    }

    /**
     * @dev Reads the owner out of the clone's immutable args.
     *
     *      - Clone args are 40 bytes: owner at 0-19, factory at 20-39.
     *      - Read from bytecode on every call and never cached; a storage mirror of an immutable is
     *        drift surface.
     *      - Meaningful only on a clone. `Clones.fetchCloneArgs` is undefined on a non-clone, and on
     *        the implementation it returns a slice of that contract's own runtime bytecode.
     *      - No guard is added for the implementation case: every door on the implementation is
     *        already inert for an independent reason.
     *
     * @return The clone's owner.
     */
    function _owner() internal view returns (address) {
        return address(bytes20(Clones.fetchCloneArgs(address(this))));
    }

    /**
     * @dev Reads the deploying factory out of the clone's immutable args.
     * @return The factory recorded at clone creation.
     */
    function _factory() internal view returns (address) {
        bytes memory args = Clones.fetchCloneArgs(address(this));
        return address(bytes20(_slice20(args, 20)));
    }

    /**
     * @dev Reads 20 bytes at `start` out of a memory blob, without assuming a length. The
     *      short-blob branch is unreachable from the single call site and is expected to show as
     *      uncovered.
     *
     * @param  data   Blob to read from.
     * @param  start  Byte offset to read at.
     * @return out    The 20 bytes at `start`, or zero if the blob is too short.
     */
    function _slice20(bytes memory data, uint256 start) private pure returns (bytes20 out) {
        if (data.length < start + 20) return bytes20(0);
        assembly {
            out := mload(add(add(data, 0x20), start))
        }
    }

    /**
     * @notice Factory-only, callable exactly once. Installs the session engine as the account's
     *         sole validator.
     *
     * @dev    - Reverts with `CallerIsNotFactory` unless the caller is the clone's recorded factory.
     *         - Reverts with `AlreadyInitialized` if the latch is already set.
     *         - Sets the latch, marks the engine installed, then calls `onInstall("")` with full gas
     *           and bubbles any revert, so the factory's deploy transaction unwinds atomically.
     *         - Emits `ModuleInstalled`, then `AccountInitialized`.
     *         - Session data is never passed here; grants travel only through `grantRules`.
     *         - Stores `label_` when it is non-empty; an empty label costs no write and reads as the
     *           default. An over-long label reverts `LabelTooLong` and unwinds the whole deploy.
     *
     * @param  label_  The deploy-time label; empty for the default `AGW <index + 1>`.
     */
    function initializeAccount(string calldata label_) external {
        if (msg.sender != _factory()) revert AGWErrors.CallerIsNotFactory();
        if (_initialized) revert AGWErrors.AlreadyInitialized();

        _initialized = true;
        if (bytes(label_).length != 0) _setLabel(label_);
        _installedValidators[SESSION_ENGINE] = true;

        IERC7579Module(SESSION_ENGINE).onInstall("");

        emit ModuleInstalled(MODULE_TYPE_VALIDATOR, SESSION_ENGINE);
        emit AccountInitialized(_owner(), SESSION_ENGINE);
    }

    /**
     * @notice The owner door. Executes a single call or a batch on the owner's behalf; no policy is
     *         ever consulted.
     *
     * @dev    - Reverts unless the caller is the owner; reentrancy-guarded.
     *         - Reverts on any execution type other than default, and on any call type other than
     *           single or batch.
     *         - Reads no module, policy or engine state — only the immutable-args owner, its calldata,
     *           and the wallet's own checkpoint slot — so the door still works with the engine
     *           uninstalled, with a hostile validator installed, or in ghost-rules state.
     *         - Records one checkpoint per call, before the call (`_checkpointOwnerCall`). The write
     *           cannot revert.
     *         - The signature is frozen at `execute(bytes32,bytes)`: the session engine branches on
     *           this exact selector, and any other shape routes validation down a path where the
     *           action policy sees a hardcoded zero value instead of the real one.
     *         - Batch is required product surface: the permission-change flow is one owner signature
     *           batching a spend assertion, a revoke and a grant.
     *         - Dispatches through `_execute` and emits `OwnerExecuted`.
     *         - There is no separate withdraw function; withdrawal, revocation escort and incident
     *           response all run through this door.
     *
     * @param  mode              ERC-7579 mode word; call type and execution type are decoded from it.
     * @param  executionCalldata Encoded execution, single or batch according to `mode`.
     */
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable onlyOwner nonReentrant {
        ModeCode m = ModeCode.wrap(mode);
        (CallType callType, ExecType execType,,) = m.decode();

        if (execType != EXECTYPE_DEFAULT) revert AGWErrors.UnsupportedExecutionMode();
        if (callType == CALLTYPE_SINGLE) {
            (address target, uint256 value, bytes calldata callData) = ExecutionLib.decodeSingle(executionCalldata);
            _checkpointOwnerCall(target, value, callData);
            _execute(target, value, callData);
        } else if (callType == CALLTYPE_BATCH) {
            Execution[] calldata execs = ExecutionLib.decodeBatch(executionCalldata);
            uint256 len = execs.length;
            for (uint256 i; i < len;) {
                _checkpointOwnerCall(execs[i].target, execs[i].value, execs[i].callData);
                _execute(execs[i].target, execs[i].value, execs[i].callData);
                unchecked {
                    ++i;
                }
            }
        } else {
            revert AGWErrors.UnsupportedExecutionMode();
        }

        emit OwnerExecuted(mode, keccak256(executionCalldata));
    }

    /**
     * @dev Plain call, bubbling the callee's revert data verbatim. Shared by both doors so the agent
     *      path executes the exact validated bytes.
     *
     * @param target    Address to call.
     * @param value     Native PC to send with the call.
     * @param callData  Calldata to pass, forwarded unchanged.
     */
    function _execute(address target, uint256 value, bytes calldata callData) internal {
        (bool ok, bytes memory ret) = target.call{ value: value }(callData);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    /**
     * @dev Records one owner-side change: advances the counter, stamps the block, emits `Checkpointed`.
     *
     *      - CANNOT REVERT except by running out of gas: an unchecked increment of a uint64 that cannot
     *        realistically reach 2^64, one write to the wallet's own slot 0, one event. No external call.
     *        That is what lets it sit on the owner doors and on the revocation path.
     *      - NEVER called from `_execute` or anywhere the agent door reaches. A checkpoint means "the
     *        owner side touched this wallet"; an agent that could tick it could always fake owner
     *        interference.
     *
     * @param kind  What changed.
     * @param ref   Per-kind reference (see `IAGW.Checkpointed`).
     */
    function _checkpoint(CheckpointKind kind, bytes32 ref) private {
        uint64 seq;
        unchecked {
            seq = _checkpointCount + 1;
        }
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 blockNumber = uint64(block.number); // a block number does not exceed 2^64 in practice
        _checkpointCount = seq;
        _lastCheckpointBlock = blockNumber;
        emit Checkpointed(seq, kind, ref, blockNumber);
    }

    /**
     * @dev The owner-door tick for one call, taken BEFORE the call runs, so a consumer snapshotting the
     *      counter during that call already sees it, and any later call in the same batch moves it again.
     *
     * @param target    The call's target.
     * @param value     The call's native value.
     * @param callData  The call's calldata.
     */
    function _checkpointOwnerCall(address target, uint256 value, bytes calldata callData) private {
        _checkpoint(CheckpointKind.OWNER_ACTION, keccak256(abi.encode(target, value, callData)));
    }

    /**
     * @notice The owner door, authorised by a signed OwnerIntent instead of `msg.sender`. Relayable.
     *
     * @dev    - A THIRD door, separate from `execute`. `execute` reads no module, policy or engine
     *           state — only the immutable-args owner, its calldata and its own checkpoint slot — and
     *           remains the unblockable fallback. This door reads storage (the nonce lane) and may
     *           therefore fail where `execute` cannot.
     *         - The mode switch below is DUPLICATED from `execute`, not shared with it, so that no
     *           refactor can ever add a check to `execute`.
     *         - Checks, in order: deadline · `intent.wallet == this` · owner · presenter is
     *           `intent.executor` · owner lane · `mode` and a non-zero `execCalldataHash` match ·
     *           nonce (consumed before the signature check; any revert unwinds it) · the owner's
     *           signature under the FACTORY's domain.
     *         - Single or batch, default exec type. No dispatch guard: this is owner authority, so a
     *           batch may call the wallet's own lifecycle functions through `onlyOwnerOrSelf`.
     *         - Records one checkpoint per call, before the call, exactly as `execute` does.
     *         - Emits `OwnerExecutedWithSig`.
     *
     * @param  mode               ERC-7579 mode word; must equal `intent.mode`.
     * @param  executionCalldata  Encoded execution; its hash must equal `intent.execCalldataHash`.
     * @param  intent             The owner's intent; the grant fields are ignored here.
     * @param  sig                The owner's signature over `intent`.
     */
    function executeWithSig(
        bytes32 mode,
        bytes calldata executionCalldata,
        OwnerIntent calldata intent,
        bytes calldata sig
    ) external nonReentrant {
        address owner_ = _requireIntentPresenter(intent);

        uint192 nonceKey = intent.nonceKey;
        if (nonceKey & OWNER_LANE_FLAG == 0) revert AGWErrors.OwnerLaneRequired(nonceKey);

        bytes32 calldataHash = keccak256(executionCalldata);
        if (intent.execCalldataHash == bytes32(0) || intent.execCalldataHash != calldataHash || intent.mode != mode) {
            revert AGWErrors.IntentExecMismatch(calldataHash);
        }

        uint64 expected = _nonces[nonceKey];
        if (intent.nonceSeq != expected) revert AGWErrors.InvalidNonce(nonceKey, expected, intent.nonceSeq);
        _nonces[nonceKey] = expected + 1;

        _requireOwnerSig(owner_, intent, sig);

        (CallType callType, ExecType execType,,) = ModeCode.wrap(mode).decode();
        if (execType != EXECTYPE_DEFAULT) revert AGWErrors.UnsupportedExecutionMode();
        if (callType == CALLTYPE_SINGLE) {
            (address target, uint256 value, bytes calldata callData) = ExecutionLib.decodeSingle(executionCalldata);
            _checkpointOwnerCall(target, value, callData);
            _execute(target, value, callData);
        } else if (callType == CALLTYPE_BATCH) {
            Execution[] calldata execs = ExecutionLib.decodeBatch(executionCalldata);
            uint256 len = execs.length;
            for (uint256 i; i < len;) {
                _checkpointOwnerCall(execs[i].target, execs[i].value, execs[i].callData);
                _execute(execs[i].target, execs[i].value, execs[i].callData);
                unchecked {
                    ++i;
                }
            }
        } else {
            revert AGWErrors.UnsupportedExecutionMode();
        }

        emit OwnerExecutedWithSig(mode, calldataHash, nonceKey, intent.nonceSeq);
    }

    /**
     * @dev The checks every intent door shares, in order: deadline, wallet, owner, presenter.
     *      Returns the owner so the caller does not re-read the immutable args.
     */
    function _requireIntentPresenter(OwnerIntent calldata intent) internal view returns (address owner_) {
        if (block.timestamp > intent.deadline) revert AGWErrors.OwnerSigExpired(intent.deadline);
        if (intent.wallet != address(this)) {
            revert AGWErrors.IntentWalletMismatch(address(this), intent.wallet);
        }
        owner_ = _owner();
        if (intent.owner != owner_) revert AGWErrors.CallerIsNotOwner();
        if (intent.executor == address(0) || msg.sender != intent.executor) {
            revert AGWErrors.ExecutorMismatch(intent.executor, msg.sender);
        }
    }

    /// @dev The owner's signature over `intent`, under the factory's domain. Last check before effects.
    function _requireOwnerSig(address owner_, OwnerIntent calldata intent, bytes calldata sig) internal view {
        if (!OwnerAuthLib.isOwnerSig(owner_, OwnerAuthLib.intentDigest(_factory(), intent), sig)) {
            revert AGWErrors.InvalidOwnerSignature();
        }
    }

    /**
     * @notice Sets the wallet's label. `""` resets it to the default `AGW <index + 1>`.
     *
     * @dev    - Reverts unless the caller is the owner or the wallet itself, so a UEA owner can rename
     *           through `executeWithSig`. The agent door never reaches it: its dispatch guard refuses
     *           the wallet as a target.
     *         - Reverts `LabelTooLong` above `MAX_LABEL_BYTES` bytes.
     *         - Cosmetic metadata: writes NO checkpoint (a rename sent through `execute` still ticks
     *           once, for the owner-door call itself). Makes no external call.
     *         - Emits `LabelSet` with the label as passed.
     *
     * @param  label_  The new label, or `""` for the default.
     */
    function setLabel(string calldata label_) external onlyOwnerOrSelf {
        _setLabel(label_);
        emit LabelSet(label_);
    }

    /// @dev The one place the label is written and its length checked; the deploy path and `setLabel`
    ///      both come through here, so the cap cannot diverge between them.
    function _setLabel(string calldata label_) private {
        uint256 length = bytes(label_).length;
        if (length > MAX_LABEL_BYTES) revert AGWErrors.LabelTooLong(length);
        _label = label_;
    }

    /**
     * @notice Grants one rules set to an agent. One of exactly two lifecycle operations.
     *
     * @dev    - Reverts unless the caller is the owner or the wallet itself.
     *         - Rejects any session that is not the one shape this wallet permits, all with
     *           `MalformedSessionShape`: any user-op policy present, any ERC-7739 content or policy,
     *           the ERC-4337 paymaster permit set, an action count other than one, an action whose
     *           target is not the gateway or whose selector is not the outbound send, an action
     *           policy set that is not exactly the canonical policy, or a session validator that is
     *           not the canonical one.
     *         - Rejects an agent config the session validator does not accept — anything but
     *           `abi.encode(address agent)` with a non-zero agent. The canonical validator's check
     *           never reverts; the call is still wrapped in a bare catch rather than a typed one, so a
     *           future validator's revert or compiler panic is absorbed as a refusal. Wrapping is
     *           correct here only because the external call already exists; the action policy's own
     *           decode is deliberately not wrapped, since there it would introduce one.
     *         - Refusing the paymaster permit keeps dead surface dead: setting it would write a live
     *           permit row into engine storage, and that row decides whether a non-empty
     *           `paymasterAndData` is rejected outright or instead requires a user-op policy to run,
     *           which this shape forbids.
     *         - Overwrites the caller's salt with the wallet's monotonic grant counter, so identical
     *           terms granted twice yield distinct permission ids and a replaced id never recurs.
     *           That is what makes a request built for a revoked rules set die on regrant.
     *         - Enables the session on the engine and emits `RulesGranted`.
     *         - Records a checkpoint (`RULES_GRANTED`).
     *         - Validates the session's shape only. The caps, allow-list and expiry inside the policy
     *           config are the policy's own concern; do not extend this into term validation.
     *         - Carries no reentrancy guard: the guard would trip on the owner's own change batch,
     *           and the engine's enable path never calls back into the account.
     *
     *         - TAKES NO MANDATE TYPE. The kind of a rules set is DERIVED, not declared: each action's
     *           URP policy envelope is `abi.encode(uint16 version, string chain, bytes body)`, and the chain decides
     *           the rulebook — this chain means a Push-side call (NATIVE), any other means a call
     *           through the gateway (UNIVERSAL). The owner states a chain once, where they were
     *           already stating the terms; nobody states a mode anywhere. Every action must name the
     *           same chain, which is what makes a mixed rules set unrepresentable rather than merely
     *           forbidden.
     *         - The envelope is NOT REWRITTEN. The wallet reads one field and passes the caller's
     *           bytes to the engine untouched, so what URP validates is exactly what the owner
     *           reviewed.
     *
     * @param  session       The session to enable. Its `salt` field is ignored and overwritten.
     * @return rulesId  The engine's id for the newly enabled rules set.
     *
     *         `rulesId` is the engine's `permissionId`.
     */
    function grantRules(Session calldata session) external onlyOwnerOrSelf returns (bytes32 rulesId) {
        return _grantRules(session);
    }

    /**
     * @notice `grantRules`, authorised by the owner's signed OwnerIntent instead of `msg.sender`.
     *
     * @dev    - Checks, in order: deadline · `intent.wallet == this` · `intent.owner` is this wallet's
     *           owner · presenter is `intent.executor` (non-zero) · `sessionHash` is non-zero and is the
     *           hash of `session` · `grantNonce` is the current `_grantNonce` · the owner's signature under
     *           the FACTORY's domain. Then the entire `grantRules` body, unchanged.
     *         - `_grantNonce` advances on every grant, so an intent grants at most once and dies on any
     *           other grant. No new storage.
     *         - `sessionHash` covers the session AS SUPPLIED, salt included; the salt is then overwritten
     *           with the grant nonce exactly as on the owner path.
     *         - Unreachable from the agent door: the wallet is never a grantable action target, and the
     *           dispatch guard refuses `address(this)` whatever the selector.
     *         - No reentrancy guard, for the same reason `grantRules` has none.
     *
     * @param  session  The session to enable.
     * @param  intent   The owner's intent; the exec fields are ignored here.
     * @param  sig      The owner's signature over `intent`.
     * @return rulesId  The engine's id for the newly enabled rules set.
     *
     *         `rulesId` is the engine's `permissionId`.
     */
    function grantRulesWithSig(Session calldata session, OwnerIntent calldata intent, bytes calldata sig)
        external
        returns (bytes32 rulesId)
    {
        address owner_ = _requireIntentPresenter(intent);

        bytes32 sessionHash = keccak256(abi.encode(session));
        if (intent.sessionHash == bytes32(0) || intent.sessionHash != sessionHash) {
            revert AGWErrors.IntentSessionMismatch(sessionHash);
        }
        if (intent.grantNonce != _grantNonce) {
            revert AGWErrors.IntentGrantNonceMismatch(_grantNonce, intent.grantNonce);
        }
        _requireOwnerSig(owner_, intent, sig);

        return _grantRules(session);
    }

    /**
     * @dev The entire body `grantRules` always had, moved here unchanged so both entry points run the
     *      same checks in the same order with the same errors. See `grantRules` for the rules.
     */
    function _grantRules(Session calldata session) internal returns (bytes32 rulesId) {
        // ─── rules COMMON to both types, first ───

        if (session.userOpPolicies.length != 0) revert AGWErrors.MalformedSessionShape();

        if (
            session.erc7739Policies.allowedERC7739Content.length != 0
                || session.erc7739Policies.erc1271Policies.length != 0
        ) revert AGWErrors.MalformedSessionShape();

        if (session.permitERC4337Paymaster) revert AGWErrors.MalformedSessionShape();

        uint256 n = session.actions.length;

        // BEFORE THE DECODE, AND FOR BOTH MODES. The mode is derived from action 0's envelope, so
        // action 0 must exist before anything can be derived: with no actions there is no envelope,
        // no chain, and therefore no mode to report. A universal session with zero actions
        // consequently reports `TooManyActions(0)`, not `MalformedSessionShape`.
        if (n == 0) revert AGWErrors.TooManyActions(0);

        // THE POLICY-SHAPE CHECK RUNS BEFORE THE DECODE, ALWAYS. Decoding first would read an
        // arbitrary policy's `initData` as though it were URP's. This ordering is load-bearing.
        _requirePolicyShape(session.actions[0]);
        (string memory chain, bytes32 chainHash) = _chainNamespaceOf(session.actions[0]);

        // ─── THE ENTIRE MODE DECISION. Nobody declared it. ───
        RulesType mode = PushChainLib.deriveMode(chainHash);

        // THE INVARIANT, STATED ONCE: a wrong POLICY is always `MalformedSessionShape`; a target
        // wrong FOR THE DERIVED TYPE is always `RulesTypeMismatch`. Between the two branches
        // there is no shape in which a gateway call reaches a native config, and none in which a
        // native call reaches a universal one — which, with URP's N3 and gate 3 at runtime, is the
        // whole consistency argument. One chain per rules set makes mixed rules sets unrepresentable.

        if (mode == RulesType.UNIVERSAL) {
            // `n != 1` BEFORE the target check, as before. A malformed chain string on a
            // multi-action session therefore reports `MalformedSessionShape`, not a type mismatch.
            if (n != 1) revert AGWErrors.MalformedSessionShape();

            ActionData calldata a = session.actions[0];
            if (a.actionTarget != UNIVERSAL_GATEWAY_PC || a.actionTargetSelector != SEND_OUTBOUND_SELECTOR) {
                revert AGWErrors.RulesTypeMismatch(mode, 0, a.actionTarget);
            }
        } else {
            if (n > MAX_NATIVE_ACTIONS) revert AGWErrors.TooManyActions(n);

            // Hoisted: `_factory()` does an extcodecopy of the clone's own bytecode on every call.
            address factoryAddr = _factory();

            for (uint256 i; i < n;) {
                ActionData calldata a = session.actions[i];

                _requireGrantableTarget(a.actionTarget, factoryAddr, i);
                _requireGrantableSelector(a.actionTargetSelector);

                // Action 0's shape and chain were read above; re-reading would waste ~900 gas.
                // EVERY action must name the same chain — that is what makes "one rules set, one
                // mode" true by construction rather than by a rule.
                if (i != 0) {
                    _requirePolicyShape(a);
                    (, bytes32 h) = _chainNamespaceOf(a);
                    if (h != chainHash) revert AGWErrors.InconsistentChain(i);
                }

                // O(n^2) by design: 28 comparisons at the n=8 ceiling, which beats a mapping and its
                // clear-down. Two identical (target, selector) pairs would hash to one actionId.
                for (uint256 j; j < i;) {
                    if (
                        session.actions[j].actionTarget == a.actionTarget
                            && session.actions[j].actionTargetSelector == a.actionTargetSelector
                    ) {
                        revert AGWErrors.DuplicateAction(a.actionTarget, a.actionTargetSelector);
                    }
                    unchecked {
                        ++j;
                    }
                }

                unchecked {
                    ++i;
                }
            }
        }

        if (address(session.sessionValidator) != SESSION_VALIDATOR) {
            revert AGWErrors.MalformedSessionShape();
        }

        try IAgentValidator(SESSION_VALIDATOR).validateConfig(session.sessionValidatorInitData) returns (bool ok) {
            if (!ok) revert AGWErrors.MalformedSessionShape();
        } catch {
            revert AGWErrors.MalformedSessionShape();
        }

        Session memory sessionMem = session;
        sessionMem.salt = bytes32(uint256(_grantNonce));
        // Checked on purpose: a wrapping counter would mean silent salt reuse.
        _grantNonce++;

        Session[] memory sessions = new Session[](1);
        sessions[0] = sessionMem;
        PermissionId[] memory ids = ISmartSession(SESSION_ENGINE).enableSessions(sessions);

        rulesId = PermissionId.unwrap(ids[0]);
        _checkpoint(CheckpointKind.RULES_GRANTED, rulesId);
        emit RulesGranted(rulesId, mode, chainHash, chain);
    }

    /**
     * @dev The policy-shape rule, hoisted so it can run before each envelope decode.
     *
     *      A SHAPE rule, so it raises `MalformedSessionShape` like every other shape rule. It is
     *      also the precondition for `_chainNamespaceOf`: without it, the decode below would be reading an
     *      arbitrary policy's `initData` as though URP had authored it.
     *
     * @param a  The action whose policy slot is vetted.
     */
    function _requirePolicyShape(ActionData calldata a) internal view {
        if (a.actionPolicies.length != 1 || a.actionPolicies[0].policy != RULES_POLICY) {
            revert AGWErrors.MalformedSessionShape();
        }
    }

    /**
     * @dev Reads ONE field of the policy envelope — the bounded exception to "the skeleton, not the
     *      organs".
     *
     *      WHAT THIS IS NOT: it is not term validation. The wallet does not check caps, expiry,
     *      allow-list contents or anything else inside the body, and must never start. It reads the
     *      label on the jar: the one field that decides WHICH RULEBOOK the action belongs to, which
     *      is the wallet's own business because the wallet's target rules depend on it. URP
     *      re-derives the same value from the same bytes and remains the sole judge of the terms.
     *
     *      CALLER MUST HAVE RUN `_requirePolicyShape` FIRST.
     *
     *      Same decoder as URP's, deliberately (`abi.decode(initData, (uint16, string, bytes))`):
     *      two different readers of one security-relevant field is the drift this design exists to
     *      prevent. A malformed envelope reverts here, unnamed, and fails closed. The version is
     *      URP's to judge: it refuses anything but `ENVELOPE_VERSION` at init, inside this grant.
     *
     * @param  a          The action to read.
     * @return chain      The declared CAIP-2 string, e.g. `"eip155:11155111"`.
     * @return chainHash  Its keccak256, the value everything downstream compares.
     */
    function _chainNamespaceOf(ActionData calldata a) internal pure returns (string memory chain, bytes32 chainHash) {
        (, chain,) = abi.decode(a.actionPolicies[0].initData, (uint16, string, bytes));
        if (bytes(chain).length == 0) revert AGWErrors.EmptyChain();
        chainHash = keccak256(bytes(chain));
    }

    /**
     * @dev Every grant-time target rule for a NATIVE action, in one place.
     *
     *      TWO RULES, TWO ERRORS, AND THE DISTINCTION IS THE POINT:
     *
     *      - **The gateway → `RulesTypeMismatch`.** The session is well-formed; the CHAIN the
     *        envelope declares is this chain, and a gateway call is not a Push-side call. A gateway
     *        target is perfectly grantable — under a foreign chain, as `UNIVERSAL`. Carries the
     *        action index, because with up to eight actions "something was wrong" is not a usable
     *        diagnostic. This is one half of the consistency lock; URP's N3 is the runtime mirror.
     *      - **The other seven → `ForbiddenActionTarget`.** Never grantable, under any type.
     *
     *      Of those seven the severe pair is the wallet and the engine: from the agent door,
     *      `_execute(wallet, 0, grantRules(...))` would arrive with `msg.sender == address(this)`,
     *      pass `onlyOwnerOrSelf`, and the agent would have granted itself a rules set of its own
     *      design. `revokeAllRules` is the mirror.
     *
     *      LAYER CREDIT, so nobody deletes the wrong one as redundant: the engine independently
     *      refuses `address(0)` and ITSELF at enable time (`ConfigLib.sol:139-143`), but it does NOT
     *      refuse `address(1)` there — only at check time. **This is the only grant-time layer for
     *      the fallback flag.**
     *
     *      The action-policy check is deliberately NOT here. That is a SHAPE rule — it raises
     *      `MalformedSessionShape`, and the UNIVERSAL branch and the common rules raise the same
     *      error for the same class of defect. It belongs with them, not inside a target helper.
     *
     * @param t            Action target to vet.
     * @param factoryAddr  The clone's factory, hoisted by the caller so the loop reads it once.
     *                     `_factory()` does an extcodecopy of the clone's own bytecode; the other
     *                     six comparands are immutables and are free to read here.
     * @param index        Index of this action, reported by `RulesTypeMismatch`.
     */
    function _requireGrantableTarget(address t, address factoryAddr, uint256 index) internal view {
        if (t == UNIVERSAL_GATEWAY_PC) {
            revert AGWErrors.RulesTypeMismatch(RulesType.NATIVE, index, t);
        }
        if (
            t == address(0) || t == ENGINE_FALLBACK_TARGET || t == address(this) || t == SESSION_ENGINE
                || t == RULES_POLICY || t == SESSION_VALIDATOR || t == factoryAddr
        ) {
            revert AGWErrors.ForbiddenActionTarget(t);
        }
    }

    /**
     * @dev The grant-time forbidden-selector list for NATIVE actions.
     *
     *      Refuses the engine's two fallback selectors by name. `0xFFFFFFFF` (value-only) is
     *      PERMITTED and is deliberately not on this list.
     *
     * @param s  Action selector to vet.
     */
    function _requireGrantableSelector(bytes4 s) internal pure {
        if (s == ENGINE_FALLBACK_SELECTOR || s == ENGINE_FALLBACK_SELECTOR_SMARTSESSION) {
            revert AGWErrors.ForbiddenActionSelector(s);
        }
    }

    /**
     * @notice Revoke one rules set. The other lifecycle operation, and the emergency lever.
     *
     * @dev    - Reverts unless the caller is the owner or the wallet itself.
     *         - Reverts with `UnknownPermission` if the id is not enabled, because the upstream
     *           removal silently no-ops on a ghost id and an operator must never read "revoked"
     *           while the rules set lives.
     *         - Removes the session and emits `RulesRevoked`. Revocation is immediate: removal clears
     *           the agent, so any request under the id fails `CallerIsNotAgent`.
     *         - Deliberately carries no reentrancy guard and no health probe: nothing that can fail
     *           belongs on the stop path, since blockable removal is the one regression this
     *           function can develop. It records a checkpoint (`RULES_REVOKED`) per removed id; that
     *           write cannot revert.
     *
     * @param  rulesId  The rules set to revoke.
     *
     *         `rulesId` is the engine's `permissionId`.
     */
    function revokeRules(bytes32 rulesId) external onlyOwnerOrSelf {
        if (!ISmartSession(SESSION_ENGINE).isPermissionEnabled(PermissionId.wrap(rulesId), address(this))) {
            revert AGWErrors.UnknownPermission(rulesId);
        }

        ISmartSession(SESSION_ENGINE).removeSession(PermissionId.wrap(rulesId));

        _checkpoint(CheckpointKind.RULES_REVOKED, rulesId);
        emit RulesRevoked(rulesId);
    }

    /**
     * @notice Revokes every rules set on this wallet in one call. The incident-response lever.
     *
     * @dev    - Reverts unless the caller is the owner or the wallet itself.
     *         - Snapshots the permission ids, removes each by id, and emits `RulesRevoked` per id.
     *           Removal is by id, so engine-side array shifting cannot disturb the snapshot.
     *         - Deliberately carries no reentrancy guard and no health probe, for the same reason as
     *           `revokeRules`. It records a checkpoint (`RULES_REVOKED`) per removed id; that write
     *           cannot revert.
     *         - Gas grows with permission count; wallets hold few permissions by design.
     */
    function revokeAllRules() external onlyOwnerOrSelf {
        PermissionId[] memory ids = ISmartSession(SESSION_ENGINE).getPermissionIDs(address(this));

        uint256 len = ids.length;
        for (uint256 i; i < len;) {
            ISmartSession(SESSION_ENGINE).removeSession(ids[i]);
            _checkpoint(CheckpointKind.RULES_REVOKED, PermissionId.unwrap(ids[i]));
            emit RulesRevoked(PermissionId.unwrap(ids[i]));
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice The agent door. Callable only by the rules set's agent; every call is checked by the
     *         rules set's policy before it runs.
     *
     * @dev    This chain has no EntryPoint, so this function does the EntryPoint's work, in order:
     *         1. reject if the session engine is no longer installed
     *         2. reject unless `msg.sender` is the agent `rulesId` names on this wallet
     *         3. build the operation, validate it through the engine, and enforce the verdict
     *         4. reject any mode other than single and default, and the two forbidden targets
     *         5. dispatch the exact validated bytes
     *         6. emit `RulesActionAuthorized`
     *
     *         - The agent is a Push address. An external key (EVM, Solana, anything) acts through its
     *           UEA, which verifies that key before calling here; this wallet verifies no signature.
     *         - Replay protection is the sender's own transaction nonce (an EOA's nonce, or the UEA
     *           payload's nonce). Expiry is the rules set's own (policy gate 2 / N2 / S2); an EOA
     *           transaction carries no per-request expiry, a UEA payload carries its `deadline`.
     *         - A request against a revoked rules set fails at step 2: removal clears the agent.
     *         - Not payable, but a validated request does move PC out of the wallet's own balance,
     *           bounded by the policy's per-call ceiling.
     *         - Any revert unwinds the whole transaction, including the policy's counters; dispatch
     *           is never wrapped in try/catch.
     *         - Mode is single-only here: batching lives inside the multicall payload, bounded by the
     *           policy.
     *
     * @param  rulesId            The rules set this call acts under. `rulesId` is the engine's
     *                            `permissionId`.
     * @param  mode               ERC-7579 mode word; must decode to single and default.
     * @param  executionCalldata  Encoded single execution, dispatched byte-for-byte once validated.
     */
    function executeAsAgent(bytes32 rulesId, bytes32 mode, bytes calldata executionCalldata) external nonReentrant {
        if (!_installedValidators[SESSION_ENGINE]) {
            revert AGWErrors.ValidatorNotInstalled(SESSION_ENGINE);
        }

        if (msg.sender != _agentOf(rulesId)) revert AGWErrors.CallerIsNotAgent(rulesId, msg.sender);

        bytes32 callsHash = keccak256(executionCalldata);

        _validate(rulesId, mode, executionCalldata, callsHash);

        _gateAndDispatch(mode, executionCalldata);

        emit RulesActionAuthorized(rulesId, msg.sender, callsHash);
    }

    /**
     * @dev Gates the mode to single and default, then dispatches the validated execution unchanged.
     *
     *      - The agent path never batches at the ERC-7579 layer; batching lives inside the multicall
     *        payload instead, bounded by the policy.
     *      - Split out for stack depth only. Inlined, this does not compile with the optimizer off,
     *        which is the configuration `forge coverage` uses.
     *
     * @param mode              ERC-7579 mode word.
     * @param executionCalldata Encoded single execution to dispatch.
     */
    function _gateAndDispatch(bytes32 mode, bytes calldata executionCalldata) internal {
        (CallType callType, ExecType execType,,) = ModeCode.wrap(mode).decode();
        if (callType != CALLTYPE_SINGLE || execType != EXECTYPE_DEFAULT) {
            revert AGWErrors.UnsupportedExecutionMode();
        }
        (address target, uint256 value, bytes calldata callData) = ExecutionLib.decodeSingle(executionCalldata);

        // ⚠️ THE DISPATCH GUARD — never-delete, and it belongs HERE, after validation.
        //
        // Two comparisons, no storage, no module or policy state. It holds regardless of how the
        // session was enabled — including a session the owner enabled on the engine DIRECTLY
        // through the owner door, bypassing `grantRules` and its forbidden-target list entirely.
        // That path exists today and is legitimate; this is what stops it reaching the wallet's own
        // lifecycle functions from the agent side.
        //
        // DO NOT MOVE IT BEFORE `_validate`. Placed earlier it would pre-empt the engine's own
        // refusals and change which error surfaces, and the engine-target case only ever reaches
        // this point through the fallback sentinel, which validation has to run to resolve.
        if (target == address(this) || target == SESSION_ENGINE) {
            revert AGWErrors.ForbiddenDispatchTarget(target);
        }

        _execute(target, value, callData);
    }

    /**
     * @dev Builds the operation, validates it through the engine, and enforces the verdict.
     *
     *      - Builds a `PackedUserOperation` for its ABI shape only, since there is no EntryPoint. The
     *        engine requires `sender` to equal `msg.sender` (the wallet); that is what makes the
     *        signature field below unforgeable.
     *      - The callData selector must be `execute(bytes32,bytes)`, because that is the only engine
     *        branch that decodes the mode and forwards the real decoded value to the action policy.
     *        Every other selector reaches the policy with the account as target and a hardcoded zero
     *        value, which would make the policy's value gate compare against nothing.
     *      - The signature field is `USE ‖ rulesId ‖ msg.sender`, written here and nowhere else. The
     *        session validator accepts it only when those 20 bytes are the rules set's agent.
     *      - `callsHash` is passed as the operation hash. Nothing verifies a signature over it; it is
     *        what the engine forwards to the validator, which ignores it.
     *      - Gas fields are zero and `paymasterAndData` must stay empty, or the engine's paymaster
     *        permit check reverts. The nonce field is zero: replay protection is the sender's own.
     *      - Enforces the returned authorizer and time window itself — the EntryPoint's job, and what
     *        makes the policy's expiry gate real rather than decorative.
     *      - The engine runs the action policy before it consults the session validator, so policies
     *        still see calldata the engine has not yet authenticated; the wallet's own agent check
     *        has already run by then.
     *      - Performs exactly one external call, to the engine. Split out for stack depth.
     *
     * @param rulesId            The rules set, written into the signature field.
     * @param mode               ERC-7579 mode word, re-encoded into the operation's calldata.
     * @param executionCalldata  Execution calldata, re-encoded into the operation's calldata.
     * @param callsHash          `keccak256(executionCalldata)`, passed as the operation hash.
     */
    function _validate(bytes32 rulesId, bytes32 mode, bytes calldata executionCalldata, bytes32 callsHash) internal {
        PackedUserOperation memory op;
        op.sender = address(this);
        op.nonce = 0;
        op.initCode = "";
        op.callData = abi.encodeWithSelector(this.execute.selector, mode, executionCalldata);
        op.accountGasLimits = bytes32(0);
        op.preVerificationGas = 0;
        op.gasFees = bytes32(0);
        op.paymasterAndData = "";
        op.signature = abi.encodePacked(SmartSessionMode.USE, rulesId, msg.sender);

        uint256 vd = ValidationData.unwrap(ISmartSession(SESSION_ENGINE).validateUserOp(op, callsHash));

        address authorizer = address(uint160(vd));
        uint48 validUntil = uint48(vd >> 160); // 0 = unbounded
        uint48 validAfter = uint48(vd >> 208);

        if (authorizer != address(0)) revert AGWErrors.ValidationFailed(authorizer);
        if (block.timestamp < validAfter) revert AGWErrors.OutsideTimeWindow(validAfter, validUntil);
        if (validUntil != 0 && block.timestamp > validUntil) {
            revert AGWErrors.OutsideTimeWindow(validAfter, validUntil);
        }
    }

    /**
     * @dev The agent `rulesId` names on this wallet, or `address(0)` if it names none.
     *      Zero when the id is unknown or revoked (removal clears the config), when its session
     *      validator is not the canonical one, or when its config is malformed. One external view
     *      call to the engine; decodes through the same library the validator enforces with.
     * @param  rulesId  The rules set to look up.
     * @return The agent's Push address, or zero.
     */
    function _agentOf(bytes32 rulesId) internal view returns (address) {
        (address sessionValidator_, bytes memory config) = ISmartSessionConfigReader(SESSION_ENGINE)
            .getSessionValidatorAndConfig(address(this), PermissionId.wrap(rulesId));
        if (sessionValidator_ != SESSION_VALIDATOR) return address(0);
        return AgentConfigLib.decode(config);
    }

    /**
     * @notice Installs a validator module.
     *
     * @dev    - Reverts unless the caller is the owner; reentrancy-guarded.
     *         - Rejects any module type but validator, the zero address, an address with no code,
     *           and a module that is already installed.
     *         - Marks the module installed, calls `onInstall` with full gas and bubbles any revert,
     *           then emits `ModuleInstalled`.
     *         - Exists as the recovery lever: a corrected validator can be installed on an existing
     *           wallet without moving addresses or funds.
     *
     * @param  moduleTypeId  ERC-7579 module type; only the validator type is accepted.
     * @param  module        Module to install.
     * @param  initData      Opaque data forwarded to the module's `onInstall`.
     */
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData)
        external
        onlyOwner
        nonReentrant
    {
        if (moduleTypeId != MODULE_TYPE_VALIDATOR) {
            revert AGWErrors.UnsupportedModuleType(moduleTypeId);
        }
        if (module == address(0) || module.code.length == 0) revert AGWErrors.InvalidModuleAddress();
        if (_installedValidators[module]) revert AGWErrors.ModuleAlreadyInstalled(module);

        _installedValidators[module] = true;

        IERC7579Module(module).onInstall(initData);

        emit ModuleInstalled(moduleTypeId, module);
    }

    /**
     * @notice Uninstalls a validator module. Removal always proceeds.
     *
     * @dev    - Reverts unless the caller is the owner; reentrancy-guarded.
     *         - Rejects any module type but validator, and a module that is not installed.
     *         - If and only if the module is the session engine, probes its initialised state under
     *           a gas cap and refuses removal while it still holds permissions. Uninstalling the
     *           engine with live permissions would run its cleanup loop out of gas and leave rows it
     *           then refuses to reinstall over, so the guard forces a `revokeAllRules` first.
     *         - Unmarks the module before calling back, so a module can never block its own removal.
     *         - Calls `onUninstall` under a stipend inside try/catch, emitting
     *           `UninstallCallbackFailed` if it reverts or exhausts the stipend, then emits
     *           `ModuleUninstalled`.
     *         - The probe is scoped to the engine alone, so a hostile third-party validator can
     *           never block its own removal.
     *         - A probe that reverts or runs out of gas proceeds with removal: the guard exists to
     *           prevent an ordering mistake, not to make a broken engine permanent.
     *
     * @param  moduleTypeId  ERC-7579 module type; only the validator type is accepted.
     * @param  module        Module to uninstall.
     * @param  deInitData    Opaque data forwarded to the module's `onUninstall`.
     */
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData)
        external
        onlyOwner
        nonReentrant
    {
        if (moduleTypeId != MODULE_TYPE_VALIDATOR) {
            revert AGWErrors.UnsupportedModuleType(moduleTypeId);
        }
        if (!_installedValidators[module]) revert AGWErrors.ValidatorNotInstalled(module);

        if (module == SESSION_ENGINE) {
            (bool ok, bytes memory ret) = module.staticcall{ gas: ENGINE_STATE_PROBE_GAS }(
                abi.encodeCall(ISmartSession.isInitialized, (address(this)))
            );
            if (ok && ret.length >= 32 && abi.decode(ret, (bool))) {
                revert AGWErrors.EngineStillHoldsPermissions();
            }
        }

        _installedValidators[module] = false;

        try IERC7579Module(module).onUninstall{ gas: UNINSTALL_CALLBACK_GAS_STIPEND }(deInitData) { }
        catch {
            emit UninstallCallbackFailed(module);
        }

        emit ModuleUninstalled(moduleTypeId, module);
    }

    /**
     * @notice Whether `module` is installed under `moduleTypeId`.
     * @param  moduleTypeId  ERC-7579 module type to query.
     * @param  module        Module to query.
     * @return True only for an installed validator.
     */
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR && _installedValidators[module];
    }

    /**
     * @notice Whether this account supports an ERC-7579 module type.
     * @param  moduleTypeId  Module type to query.
     * @return True only for the validator type.
     */
    function supportsModule(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    /**
     * @notice Whether this account supports an ERC-7579 execution mode.
     * @dev    Answers for the account as a whole; the agent door additionally restricts itself to
     *         single calls.
     * @param  mode  ERC-7579 mode word to query.
     * @return True for default execution in single or batch call type.
     */
    function supportsExecutionMode(bytes32 mode) external pure returns (bool) {
        (CallType callType, ExecType execType,,) = ModeCode.wrap(mode).decode();
        if (execType != EXECTYPE_DEFAULT) return false;
        return callType == CALLTYPE_SINGLE || callType == CALLTYPE_BATCH;
    }

    /// @notice The wallet's owner, read from the clone's immutable args.
    function owner() external view returns (address) {
        return _owner();
    }

    /// @notice The factory that deployed this wallet.
    function factory() external view returns (address) {
        return _factory();
    }

    /**
     * @notice The wallet's label: the owner's, or `AGW <index + 1>` when none is set.
     * @dev    The default is computed, never stored, from the factory's per-owner index — so an
     *         owner's wallets read `AGW 1`, `AGW 2`, … A view only: no door ever calls it.
     * @return The label.
     */
    function label() external view returns (string memory) {
        if (bytes(_label).length != 0) return _label;
        return string.concat("AGW ", Strings.toString(IAGWFactory(_factory()).indexOf(address(this)) + 1));
    }

    /**
     * @notice Next expected sequence number in an owner lane (`OWNER_LANE_FLAG` set), consumed by
     *         `executeWithSig`. The agent door uses no nonce lanes.
     * @param  nonceKey  Replay lane to query.
     * @return The sequence number the next intent in that lane must carry.
     */
    function getNonce(uint192 nonceKey) external view returns (uint64) {
        return _nonces[nonceKey];
    }

    /// @notice The salt the next grant will use.
    function grantNonce() external view returns (uint64) {
        return _grantNonce;
    }

    /**
     * @notice The agent a rules set names on this wallet, or zero if it names none.
     * @dev    Zero for an unknown or revoked id, for a session the owner enabled on the engine
     *         directly with a non-canonical session validator, and for a malformed config. Such a
     *         rules set cannot be used through `executeAsAgent`.
     * @param  rulesId  The rules set to look up. `rulesId` is the engine's `permissionId`.
     * @return The agent's Push address, or zero.
     */
    function agentOf(bytes32 rulesId) external view returns (address) {
        return _agentOf(rulesId);
    }

    /**
     * @notice Owner-side checkpoints so far. Compare against a snapshot to learn whether the owner side
     *         touched this wallet since: any owner-door call, grant or revoke moves it; agent actions
     *         never do.
     * @return The number of checkpoints recorded.
     */
    function checkpointCount() external view returns (uint64) {
        return _checkpointCount;
    }

    /**
     * @notice `block.number` of the latest checkpoint, or zero if none. A convenience only: consumers
     *         must compare COUNTS, because several checkpoints can share a block with their snapshot.
     * @return The block number of the latest checkpoint.
     */
    function lastCheckpointBlock() external view returns (uint64) {
        return _lastCheckpointBlock;
    }

    /// @notice The OwnerIntent domain separator this wallet verifies against, for a signer on
    ///         `signerChainId`. Identical to the factory's: the factory is the verifying contract.
    function domainSeparator(uint256 signerChainId) external view returns (bytes32) {
        return OwnerAuthLib.domainSeparator(_factory(), signerChainId);
    }

    /// @notice The ERC-7579 account id, in vendor.account.semver form.
    function accountId() external pure returns (string memory) {
        return ACCOUNT_ID;
    }

    /// @dev Accepts PC with no logic; the wallet pays outbound gas swaps from its own balance and
    ///      refunds land here.
    receive() external payable { }

    /// @notice Accepts ERC-721 transfers, so destination-side refunds and NFTs can land.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /// @notice Accepts ERC-1155 transfers, so destination-side refunds and NFTs can land.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /// @notice Accepts batched ERC-1155 transfers, so destination-side refunds and NFTs can land.
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155BatchReceived.selector;
    }

    /**
     * @notice ERC-165 support check.
     *
     * @dev    - Reports ERC-165 and the two token-receiver interfaces only.
     *         - Deliberately does not report `IERC7579Account`: this account implements that
     *           interface partially, so advertising it would mislead the tooling that probes for it.
     *           Tooling detects the account through `accountId`, `supportsModule` and
     *           `supportsExecutionMode` instead.
     *
     * @param  interfaceId  Interface id to query.
     * @return True for the three supported interfaces.
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId // 0x01ffc9a7
            || interfaceId == 0x150b7a02 // IERC721Receiver
            || interfaceId == 0x4e2312e0; // IERC1155Receiver
    }

    /**
     * @notice Always invalid: the wallet never signs as an ERC-1271 party.
     * @dev    A constant return, with no logic and no future hook. This is also what makes the
     *         engine's enable-mode grant path dead on these wallets.
     * @return The ERC-1271 failure magic value.
     */
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xffffffff;
    }
}
