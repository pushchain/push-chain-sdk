// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UniversalRulesPolicyErrors } from "../libraries/Errors.sol";

import { VALIDATION_SUCCESS } from "erc7579/interfaces/IERC7579Module.sol";
import { ConfigId } from "smartsessions/DataTypes.sol";
import { IActionPolicy, IPolicy } from "smartsessions/interfaces/IPolicy.sol";
import { IERC165 } from "forge-std/interfaces/IERC165.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import { IUniversalRulesPolicy } from "../interfaces/IUniversalRulesPolicy.sol";
import { IPRC20Source } from "../interfaces/IPRC20Source.sol";
import { PushChainLib } from "../libraries/PushChainLib.sol";
import {
    AllowedCall,
    AllowedProgram,
    ArgPin,
    AssetCap,
    AssetCapState,
    Config,
    MAX_ASSETS,
    ENVELOPE_VERSION,
    MAX_PINS,
    ModeSlot,
    Multicall,
    MULTICALL_SELECTOR,
    NativeConfig,
    NativeTerms,
    RulesType,
    SEND_OUTBOUND_SELECTOR as GATEWAY_SEND_OUTBOUND_SELECTOR,
    SvmAccountPin,
    SvmConfig,
    SvmDataPin,
    SvmDataPinMode,
    SvmTerms,
    UniversalOutboundTxRequest,
    UniversalTerms,
    VALUE_SELECTOR,
    VmFamily
} from "../libraries/Types.sol";

// Cluster-independent Solana program ids, never targets. Decoded from their base58 ids by tooling and
// pinned by `test_svm_forbiddenProgramConstantsMatchBase58` — do not hand-edit a hex word. FILE-LEVEL,
// not inside the contract, so that test can import them without inheriting all of URP: a harness that
// did so grew past the 24,576-byte limit and failed `make sizes`. Inlined either way; no runtime cost.
/// @dev `11111111111111111111111111111111` — a system transfer with the CEA as funder drains it.
bytes32 constant SYSTEM_PROGRAM = bytes32(0);
/// @dev `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` — transfer/approve/close with CEA authority.
bytes32 constant SPL_TOKEN_PROGRAM = 0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;
/// @dev `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` — the same surface on Token-2022.
bytes32 constant TOKEN_2022_PROGRAM = 0x06ddf6e1ee758fde18425dbce46ccddab61afc4d83b90d27febdf928d8a18bfc;
/// @dev `Stake11111111111111111111111111111111111111` — withdraw with the CEA as authority.
bytes32 constant STAKE_PROGRAM = 0x06a1d8179137542a983437bdfe2a7ab2557f535c8a78722b68a49dc000000000;
/// @dev `BPFLoaderUpgradeab1e11111111111111111111111` — never a CEA action; refused outright.
bytes32 constant BPF_LOADER_UPGRADEABLE = 0x02a8f6914e88a1b0e210153ef763ae2b00c2b93d16c124d2c0537a1004800000;
/// @dev `AddressLookupTab1e1111111111111111111111111` — rent drain with the CEA as payer.
bytes32 constant ADDRESS_LOOKUP_TABLE = 0x0277a6af97339b7ac88d1892c90446f50002309266f62e53c118244982000000;

/**
 * @title  UniversalRulesPolicy (URP)
 * @notice The security boundary of the whole system: the only contract that ever inspects what an
 *         agent really does on the far chain. Everything else routes, stores, or signs.
 *
 * @dev    - The engine identifies actions by hashing the Push-side target and selector, and every
 *           agent action is the same Push-side call, so to the engine a trade, a deposit and a theft
 *           are identical. What the user actually authorised lives two decode levels down, inside
 *           the payload. This policy opens it.
 *         - It is the fail-closed anchor: the engine requires at least one action policy per action
 *           (`PolicyLib.check`), so removing this one does not weaken a rules set, it kills every
 *           request under it.
 *         - No owner, no setters, no pause. Its three trust anchors are written once, at
 *           initialisation, and there is no function that can change them afterwards.
 *         - It never makes an external call, and writes only after every gate has passed.
 *
 *         UPGRADEABLE, BEHIND A TRANSPARENT PROXY, AND THAT IS A DELIBERATE TRADE. This contract
 *         used to hold its trust anchors in immutables and describe itself as needing no trust at
 *         all. Immutables live in the implementation's bytecode, which a `delegatecall` never
 *         executes the constructor of, so upgradeability and immutables are mutually exclusive —
 *         they had to become storage. The consequence is worth stating plainly rather than
 *         discovering later: **URP's guarantees now hold subject to the proxy admin not being
 *         malicious.** An admin able to install new logic can rewrite every gate in this file.
 *
 *         What that means in practice, and what it does NOT mean:
 *         - No function here can move `SESSION_ENGINE`, the gateway or the executor module. The
 *           only route to changing them is a full implementation swap by the admin.
 *         - The admin cannot reach `_configs` or `_credited` directly; it can only replace the code
 *           that reads them. Existing rules sets keep their caps until an upgrade says otherwise.
 *         - Storage layout is therefore load-bearing FOREVER. See the layout note on `__gap`.
 *
 *         THE IMPLEMENTATION MUST NEVER BE INITIALISED DIRECTLY. Its constructor disables the
 *         initialiser for exactly that reason; an initialised implementation is a contract with a
 *         live config that the proxy does not know about.
 */
contract UniversalRulesPolicy is IUniversalRulesPolicy, Initializable {
    /// @dev Maximum inner calls in one request. Bounds the gate-13 loop.
    uint256 internal constant MAX_ACTIONS_PER_REQUEST = 10;

    /// @dev Maximum allow-list entries per config. Bounds the allow-list scan.
    uint256 internal constant MAX_ALLOWED_CALLS = 32;

    /// @notice The gateway selector every agent action must carry.
    /// @dev    Part of this contract's ABI, so it stays a public constant. The value comes from the
    ///         shared gateway constant, so this policy and the wallet's grant-shape check cannot
    ///         disagree.
    bytes4 public constant SEND_OUTBOUND_SELECTOR = GATEWAY_SEND_OUTBOUND_SELECTOR;

    /// @dev Smallest valid ABI encoding of a UniversalOutboundTxRequest argument list:
    ///      32 (outer offset) + 256 (eight head words) + 32 + 32 (length words for the two empty
    ///      bytes fields). Do not hand-maintain: a test pins this against abi.encode of an empty
    ///      request, so a new struct field fails the build rather than loosening gate 4c.
    uint256 internal constant MIN_OUTBOUND_BODY_LEN = 352;

    // ───────────────────────────── svm rulebook bounds ─────────────────────────────

    /// @dev Maximum allow-list entries per SVM config. Mirrors MAX_ALLOWED_CALLS.
    uint256 internal constant MAX_ALLOWED_PROGRAMS = 32;
    /// @dev Maximum account pins per SVM config. Bounds the S17 and S18 loops.
    uint256 internal constant MAX_SVM_PINS = 16;
    /// @dev Maximum ix_data pins per SVM config.
    uint256 internal constant MAX_SVM_DATA_PINS = 8;
    /// @dev Maximum CEA-controlled accounts an owner may list. Bounds the S18 loop. 16 = the CEA, one
    ///      token account per listed asset (MAX_ASSETS = 8) and up to 7 swap-output accounts. S18 gas
    ///      grows with the number actually listed, never with this bound.
    uint256 internal constant MAX_CEA_ACCOUNTS = 16;
    /// @dev Loop bound on a request's account list. Solana's transaction size limit bites first.
    uint256 internal constant MAX_SVM_ACCOUNTS = 64;
    /// @dev Loop bound on a request's instruction data.
    uint256 internal constant MAX_SVM_IX_DATA = 1024;

    // The SVM payload grammar — the node's `decodePayload`, byte for byte:
    //   [u32 BE count][count × (pubkey32 ‖ is_writable u8)][u32 BE len][ix_data][u8 id][target32]
    uint256 internal constant SVM_HEADER_LEN = 4;
    uint256 internal constant SVM_ACCOUNT_LEN = 33;
    uint256 internal constant SVM_LEN_FIELD = 4;
    uint256 internal constant SVM_TRAILER_LEN = 33;
    uint8 internal constant SVM_INSTRUCTION_EXECUTE = 2;

    // ───────────────────────────────── storage ─────────────────────────────────
    //
    // THE LAYOUT BELOW IS FROZEN. Behind a proxy, storage belongs to the proxy and outlives every
    // implementation, so a new version may only APPEND — never reorder, never remove, never change
    // a type. Doing so does not fail the build: it silently reinterprets live rules sets, which is
    // the worst failure mode this system has.
    //
    // slot 0  UNIVERSAL_GATEWAY_PC
    // slot 1  UNIVERSAL_EXECUTOR_MODULE
    // slot 2  SESSION_ENGINE
    // slot 3  _configs
    // slot 4  _credited
    // slot 5  _mode      APPENDED 2026-09-09 (native mode)
    // slot 6  _native    APPENDED 2026-09-09 (native mode)
    // slot 7  _svm       APPENDED 2026-09-30 (svm rulebook)
    // slots 8..49  __gap (uint256[42])
    //
    // THE 2026-09-09 APPEND, AND WHY IT IS SAFE. `_mode` and `_native` were added AFTER `_credited`
    // and `__gap` was shrunk 45 -> 43 in the same commit, so slots 0-4 are byte-identical to the
    // deployed layout and `__gap` still ends at slot 49. Nothing that holds data moved. The
    // alternative that was rejected — renaming `_configs` to `_universal` and inserting `_native`
    // beside it — would have shifted `_credited` and silently reinterpreted the live idempotency
    // set. Measured with `forge inspect` before the change, not assumed.
    //
    // `Initializable` adds nothing here: OZ 5.x keeps its initialisation flags in an ERC-7201
    // namespaced slot, not slot 0. A test pins this exact layout against solc's own output.

    /// @notice The one Push-side target any agent action may reach.
    /// @dev    Written once by `initialize`. No setter exists, here or anywhere.
    address public UNIVERSAL_GATEWAY_PC;

    /// @notice The sole caller permitted to credit a failed outbound.
    /// @dev    Address unconfirmed against a live deployment; confirm before mainnet. It is an
    ///         initialiser argument, so nothing about building or testing depends on the real one.
    address public UNIVERSAL_EXECUTOR_MODULE;

    /// @notice The multiplexer this contract trusts on every non-engine-driven path.
    /// @dev    Never accepted as a call argument: a wrong value would silently address an empty
    ///         slice. It is set once at initialisation and read from storage thereafter.
    address public SESSION_ENGINE;

    /// @dev configId => multiplexer (the engine) => account (the wallet) => config.
    /// @dev The configId already binds the account and the permission, so the middle level isolates
    ///      callers, not permissions.
    /// @dev On the two engine-driven entry points the multiplexer is msg.sender; every other
    ///      function keys on SESSION_ENGINE.
    mapping(ConfigId => mapping(address => mapping(address => Config))) internal _configs;

    /// @dev outbound tx id => credited already; idempotency for the refund path.
    mapping(bytes32 => bool) internal _credited;

    /// @dev configId => multiplexer => account => which rulebook this config uses.
    /// @dev THE MODE DISCRIMINATOR. Stored rather than derived from `_native[...].initialized`,
    ///      because a one-bit derived mode cannot grow: URP is upgradeable behind a proxy, and the
    ///      register's extensibility item points at MORE MODES. `ModeSlot.initialized` is
    ///      authoritative for emptiness; `mode` is meaningless when it is false.
    mapping(ConfigId => mapping(address => mapping(address => ModeSlot))) internal _mode;

    /// @dev configId => multiplexer => account => the native rulebook.
    /// @dev One entry per ACTION, not per rules set: a native rules set with eight actions writes eight
    ///      of these under eight distinct config ids.
    mapping(ConfigId => mapping(address => mapping(address => NativeConfig))) internal _native;

    /// @dev configId => multiplexer => account => the SVM rulebook.
    /// @dev APPENDED 2026-09-30 after `_native`; `__gap` shrunk 43 -> 42 in the same commit so it
    ///      still ends at slot 49. Slots 0-6 are byte-identical to the deployed layout. `ModeSlot`
    ///      gained a packed byte in the same change (see `ModeSlot.vm`); no member of any live
    ///      struct moved. Measured with the layout tests, not assumed.
    mapping(ConfigId => mapping(address => mapping(address => SvmConfig))) internal _svm;

    /**
     * @dev Reserved so a later version can add state without shifting anything above.
     *
     *      Adding a variable means DECREMENTING this by exactly the number of slots consumed, in
     *      the same commit. A mapping or dynamic array costs one slot; a struct costs its packed
     *      size. `Config` itself lives inside a mapping, so APPENDING a field to that struct is
     *      safe and costs nothing here — reordering or removing one is not.
     *
     *      Was `uint256[45]` before the 2026-09-09 native-mode append; `_mode` and `_native` took
     *      two slots, so it became 43. `_svm` took one more on 2026-09-30, so it is 42. `__gap`
     *      still ends at slot 49.
     */
    uint256[42] private __gap;

    /**
     * @notice Locks the implementation so it can never be initialised in its own context.
     *
     * @dev    An implementation left initialisable is a live contract holding a config the proxy
     *         has no knowledge of. This is the standard guard and it is not optional.
     */
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Pins the three addresses this policy trusts for its whole lifetime.
     *
     * @dev    Runs once, in the PROXY's context, immediately after deployment. Reverts with
     *         `ZeroAddress` if any argument is zero, and with `InvalidInitialization` on any
     *         second call.
     *
     *         Deploy and initialise atomically — pass this call as the TransparentUpgradeableProxy
     *         constructor's `_data`. A proxy deployed uninitialised is front-runnable: whoever
     *         calls `initialize` first chooses the engine this policy trusts.
     *
     * @param  universalGatewayPC        The one Push-side target agent actions may reach.
     * @param  universalExecutorModule   The only caller permitted to credit a failed outbound.
     * @param  sessionEngine             The multiplexer trusted on non-engine-driven paths.
     */
    function initialize(address universalGatewayPC, address universalExecutorModule, address sessionEngine)
        external
        initializer
    {
        if (universalGatewayPC == address(0)) revert UniversalRulesPolicyErrors.ZeroAddress();
        if (universalExecutorModule == address(0)) revert UniversalRulesPolicyErrors.ZeroAddress();
        if (sessionEngine == address(0)) revert UniversalRulesPolicyErrors.ZeroAddress();

        UNIVERSAL_GATEWAY_PC = universalGatewayPC;
        UNIVERSAL_EXECUTOR_MODULE = universalExecutorModule;
        SESSION_ENGINE = sessionEngine;
    }

    /**
     * @dev The mode of a config, from its `ModeSlot`, which every init writes. Read by every
     *      mode-sensitive entry point that is not `checkAction`.
     *
     * @return initialized  true once any rulebook has been written for this config
     * @return mode         the rulebook; meaningless when `initialized` is false
     */
    function _modeOf(ConfigId id, address mux, address account)
        internal
        view
        returns (bool initialized, RulesType mode)
    {
        ModeSlot storage slot = _mode[id][mux][account];
        return (slot.initialized, slot.mode);
    }

    /// @dev The family of a UNIVERSAL config. Meaningless for NATIVE and for empty slots; callers check
    ///      the mode first.
    function _vmOf(ConfigId id, address mux, address account) internal view returns (VmFamily) {
        return _mode[id][mux][account].vm;
    }

    /**
     * @notice Writes one permission's configuration. Reached inside `enableSessions` during the
     *         wallet's `grantRules`, where `msg.sender` becomes the multiplexer key.
     *
     * @dev    - Refuses re-initialisation, a deliberate deviation from the upstream policy
     *           interface, which says a repeat call must overwrite. Do not restore overwrite
     *           semantics for interface fidelity.
     *         - This cannot break a legitimate regrant: the wallet supplies a fresh salt on every
     *           grant, so a regranted rules set has a new permission id and therefore an untouched
     *           config slot. The refusal only ever fires on a path this system does not use.
     *         - Rejects an allow-list that is empty or longer than the cap, an expiry that is zero
     *           or already past, a zero expected destination account, and an asset list that is
     *           empty, longer than MAX_ASSETS, repeats a token, or names a token whose source chain
     *           is not the declared chain. An owner consent term has no meaningful silence, so
     *           "never expires" is written as the maximum value.
     *         - Deliberately does not validate cap values (zero and max are both legal, a zero
     *           per-call cap being a valid move-nothing entry), `beneficiaryOffset`, or
     *           allow-list contents. A wrong offset fails closed at validation time; it cannot widen
     *           a rules set, only break it. Offsets must be generated from each protocol's ABI by
     *           tooling rather than hand-typed, and each newly supported protocol must ship a test
     *           rejecting a wrong beneficiary and an oversized amount.
     *         - Anyone may call this with themselves as the multiplexer; that writes into their own
     *           keyed slice and the engine never reads it.
     *         - Writes the config, sets the initialised flag, and emits `RulesConfigured` and
     *           `PolicySet`.
     *
     *         - THE ENVELOPE. `initData` is `abi.encode(uint16 version, string chain, bytes body)` —
     *           IDENTICAL IN SHAPE FOR EVERY MODE, which is what lets the chain be read before the
     *           mode is known. Nobody declares the mode: URP derives it from the chain with
     *           `PushChainLib.deriveMode`, and the wallet derived the same value from the same bytes
     *           at grant. There is no mode byte and therefore no `InvalidPolicyMode`.
     *         - THE VERSION is read from the first word BEFORE anything else is decoded, and anything
     *           but `ENVELOPE_VERSION` is refused `UnsupportedEnvelopeVersion`. So a body layout can
     *           change later under a new version, and almost every malformed or pre-version blob is
     *           refused NAMED: a two-field `(string, bytes)` envelope reports version 64 (its string
     *           offset), a bare struct 32, a zeroed blob 0. Blobs shorter than one word, and a
     *           version-1 envelope whose body is the wrong `Terms` type, revert unnamed. Nothing
     *           mis-decodes into a live config — measured, one test per shape.
     *         - Re-initialisation is refused ACROSS MODES, and the guard runs BEFORE the decode, so
     *           a malformed blob aimed at a live config still gets a named `AlreadyInitialized`.
     *
     * @param  account   The wallet this config belongs to.
     * @param  configId  Engine-derived id binding the account and the permission.
     * @param  initData  `abi.encode(uint16 version, string chain, bytes body)`, body being
     *                   `abi.encode(UniversalTerms)`, `abi.encode(SvmTerms)` or `abi.encode(NativeTerms)`
     *                   according to the DERIVED mode and family.
     */
    function initializeWithMultiplexer(address account, ConfigId configId, bytes calldata initData) external {
        ModeSlot storage slot = _mode[configId][msg.sender][account];

        // Re-initialisation would let the owner door reset a spend counter or flip a mode.
        if (slot.initialized) revert UniversalRulesPolicyErrors.AlreadyInitialized(configId);

        // THE VERSION, from the first word, before anything else is decoded.
        uint256 envelopeVersion = uint256(bytes32(initData[0:32]));
        if (envelopeVersion != ENVELOPE_VERSION) {
            revert UniversalRulesPolicyErrors.UnsupportedEnvelopeVersion(envelopeVersion);
        }

        // THE ENVELOPE, decoded exactly as the wallet decoded it at grant — same expression, same
        // bytes. That identity is the whole consistency argument: there is no second author of the
        // discriminator, so there is nothing for the two contracts to disagree about.
        (, string memory chainNamespace, bytes memory body) = abi.decode(initData, (uint16, string, bytes));
        if (bytes(chainNamespace).length == 0) revert UniversalRulesPolicyErrors.EmptyChain();

        bytes32 chainHash = keccak256(bytes(chainNamespace));
        RulesType mode = PushChainLib.deriveMode(chainHash);

        // THE FAMILY, derived only for UNIVERSAL. A native string is `eip155:` too and would classify
        // EVM, but NATIVE has no family and must not carry a meaningless one. `deriveVm` refuses any
        // namespace without a rulebook, so a `cosmos:` grant fails here, named, instead of producing
        // a rules set that passes init and rejects every request.
        VmFamily vm = VmFamily.EVM;
        if (mode == RulesType.UNIVERSAL) {
            vm = PushChainLib.deriveVm(chainNamespace);
            if (vm == VmFamily.EVM) {
                _initUniversal(_configs[configId][msg.sender][account], body, chainHash);
            } else {
                _initSvm(_svm[configId][msg.sender][account], body, chainHash);
            }
        } else {
            _initNative(_native[configId][msg.sender][account], body);
        }

        slot.initialized = true;
        slot.mode = mode;
        slot.vm = vm;
        slot.chainHash = chainHash;

        emit RulesConfigured(configId, msg.sender, account, mode, vm, chainHash);
        emit PolicySet(configId, msg.sender, account);
    }

    /// @inheritdoc IUniversalRulesPolicy
    function pushChainHash() external view returns (bytes32) {
        return PushChainLib.selfChainHash();
    }

    /**
     * @dev The universal init guards — unchanged from the single-mode contract, only relocated.
     * @param cfg   Storage slot to write.
     * @param body  `abi.encode(Config)`.
     */
    function _initUniversal(Config storage cfg, bytes memory body, bytes32 chainHash) internal {
        UniversalTerms memory incoming = abi.decode(body, (UniversalTerms));

        uint256 listLength = incoming.allowedCalls.length;
        if (listLength == 0 || listLength > MAX_ALLOWED_CALLS) {
            revert UniversalRulesPolicyErrors.AllowListOutOfRange(listLength);
        }

        if (incoming.validUntil == 0 || incoming.validUntil <= block.timestamp) {
            revert UniversalRulesPolicyErrors.InvalidExpiry(incoming.validUntil);
        }
        if (incoming.expectedCEA == address(0)) revert UniversalRulesPolicyErrors.InvalidConfigField();

        // ─── THE TEETH ───
        //
        // After every decode and guard, before every write. Effects last, as everywhere else here.
        //
        // WHY THIS MAKES THE DECLARED CHAIN TRUE AT RUNTIME. `SOURCE_CHAIN_NAMESPACE()` is the exact
        // view the gateway reads on every outbound, through `UniversalCore.getOutboundTxGasAndFees`,
        // to decide where to route. Gate 5 pins `req.token` to a LISTED asset on every request, zero
        // amount included. So asserting it here, for EVERY listed asset, binds the owner's declared
        // chain to the chain the gateway will actually use — with no runtime change and no external
        // call in `checkAction`. It is also why the list may never be empty: an empty list would pin
        // no token, and the agent would choose the chain.
        //
        // WHY AN EXTERNAL CALL IS SAFE HERE AND NOWHERE ELSE: this runs at INIT, inside the owner's
        // own grant transaction, never in `checkAction` and never on a removal path. A failure
        // blocks a grant; it can never block a revocation or an execution. The `try/catch` is
        // permitted because the external call ALREADY EXISTS — do not extend that reasoning to
        // `checkAction`'s decode, which has no external call to hide behind.
        //
        // A `view` call compiles to STATICCALL, so the callee cannot write state: reentrancy from a
        // hostile asset is structurally impossible, not merely unreachable.
        //
        // ⚠️ THE `code.length` GUARD IS NOT REDUNDANT WITH THE `catch`. MEASURED:
        //      callee reverts                 -> catch fires     -> named InvalidAsset
        //      no code at the address, or EOA -> catch does NOT  -> UNNAMED, empty revert
        //      answers with a non-string      -> catch does NOT  -> UNNAMED, empty revert
        //    Since solc 0.8.10 the compiler omits the extcodesize check when return data is
        //    expected; the call to a codeless address then SUCCEEDS with empty returndata and the
        //    failure happens when THIS frame tries to ABI-decode it — outside the try/catch. Without
        //    this line a typo'd asset address, the likeliest real mistake, reverts unnamed.
        _requireAssets(incoming.assets, chainHash);

        _store(cfg, incoming);
        cfg.initialized = true;
    }

    /**
     * @dev The asset-list guards, shared by both universal families: 1..MAX_ASSETS entries, no token
     *      twice, and THE TEETH for every entry. A zero token fails the teeth as `InvalidAsset(0)`.
     *      O(n^2) duplicate check at n <= 8.
     */
    function _requireAssets(AssetCap[] memory assets, bytes32 chainHash) internal view {
        uint256 n = assets.length;
        if (n == 0 || n > MAX_ASSETS) revert UniversalRulesPolicyErrors.AssetListOutOfRange(n);
        for (uint256 i; i < n;) {
            address token = assets[i].token;
            for (uint256 j; j < i;) {
                if (assets[j].token == token) revert UniversalRulesPolicyErrors.DuplicateAsset(token);
                unchecked {
                    ++j;
                }
            }
            _requireAssetOnChain(token, chainHash);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev THE TEETH, shared by both universal families. Reverts `InvalidAsset` for a codeless
     *      address, a reverting callee or a non-string answer, and `ChainMismatch` when the asset's
     *      own `SOURCE_CHAIN_NAMESPACE()` hash differs from the declared chain. See the long note
     *      in `_initUniversal` for why this external call is safe at init and nowhere else.
     */
    function _requireAssetOnChain(address asset, bytes32 chainHash) internal view {
        if (asset.code.length == 0) revert UniversalRulesPolicyErrors.InvalidAsset(asset);

        try IPRC20Source(asset).SOURCE_CHAIN_NAMESPACE() returns (string memory ns) {
            bytes32 assetChain = keccak256(bytes(ns));
            if (assetChain != chainHash) revert UniversalRulesPolicyErrors.ChainMismatch(chainHash, assetChain);
        } catch {
            revert UniversalRulesPolicyErrors.InvalidAsset(asset);
        }
    }

    /**
     * @dev The native init guards.
     *
     *      - Refuses a zero target, and the GATEWAY as a target: the mirror of gate 3, and half of
     *        the consistency lock. A native config can never be written against the gateway.
     *      - Refuses a value-only config carrying pins or an amount rule. That combination can never
     *        authorise anything — every request under it would die at N7/N8 — so it is a
     *        misconfiguration the owner believes they granted, not a valid ascetic config. Same
     *        reasoning as the empty-allow-list refusal in universal mode.
     *      - Deliberately does NOT validate cap values (zero and max are both legal), pin offsets or
     *        `amount.offset` — they cannot be checked against calldata that does not exist yet, and a
     *        wrong offset fails closed at N7/N8 rather than widening anything. Nor the selector
     *        against the engine's fallback flags: the wallet refuses those at grant, and a
     *        stranger-slice config the engine never reads is harmless.
     *
     *      - MAKES NO EXTERNAL CALL. A native rules set has no asset, so there is nothing to verify the
     *        chain against — and nothing to verify: the chain IS this chain, which is what made the
     *        mode NATIVE in the first place. The universal branch's teeth have no native counterpart
     *        and must not acquire one.
     *
     * @param cfg   Storage slot to write.
     * @param body  `abi.encode(NativeTerms)`.
     */
    function _initNative(NativeConfig storage cfg, bytes memory body) internal {
        NativeTerms memory incoming = abi.decode(body, (NativeTerms));

        if (incoming.validUntil == 0 || incoming.validUntil <= block.timestamp) {
            revert UniversalRulesPolicyErrors.InvalidExpiry(incoming.validUntil);
        }
        if (incoming.target == address(0)) revert UniversalRulesPolicyErrors.NativeTargetZero();
        if (incoming.target == UNIVERSAL_GATEWAY_PC) {
            revert UniversalRulesPolicyErrors.NativeTargetIsGateway(incoming.target);
        }
        if (incoming.pins.length > MAX_PINS) revert UniversalRulesPolicyErrors.TooManyPins(incoming.pins.length);

        if (incoming.selector == VALUE_SELECTOR) {
            if (incoming.pins.length != 0) revert UniversalRulesPolicyErrors.ValueOnlyWithPins();
            if (incoming.amount.enabled) revert UniversalRulesPolicyErrors.ValueOnlyWithAmountRule();
        }

        _storeNative(cfg, incoming);
        cfg.initialized = true;
    }

    /**
     * @dev The SVM init guards — the `solana:*` counterpart of `_initUniversal`.
     *      - Shape bounds first, then expiry and the three identity fields, then the allow-list
     *        rules, then the pins, then the teeth. Same discipline as the universal branch: every
     *        decode and guard before any write.
     *      - The teeth are IDENTICAL to the universal branch and for the same reason: each listed
     *        asset's `SOURCE_CHAIN_NAMESPACE()` is what the gateway routes on, so binding the declared
     *        chain to every one of them here is what makes a `solana:` grant with an EVM asset impossible.
     * @param cfg        Storage slot to write.
     * @param body       `abi.encode(SvmTerms)`.
     * @param chainHash  keccak256 of the declared chain string, verified against every listed asset.
     */
    function _initSvm(SvmConfig storage cfg, bytes memory body, bytes32 chainHash) internal {
        SvmTerms memory incoming = abi.decode(body, (SvmTerms));

        uint256 ruleCount = incoming.programs.length;
        if (ruleCount == 0 || ruleCount > MAX_ALLOWED_PROGRAMS) {
            revert UniversalRulesPolicyErrors.ProgramListOutOfRange(ruleCount);
        }
        if (incoming.pins.length > MAX_SVM_PINS) {
            revert UniversalRulesPolicyErrors.TooManySvmPins(incoming.pins.length);
        }
        if (incoming.dataPins.length > MAX_SVM_DATA_PINS) {
            revert UniversalRulesPolicyErrors.TooManySvmDataPins(incoming.dataPins.length);
        }
        if (incoming.ceaAccounts.length > MAX_CEA_ACCOUNTS) {
            revert UniversalRulesPolicyErrors.TooManyCeaAccounts(incoming.ceaAccounts.length);
        }

        if (incoming.validUntil == 0 || incoming.validUntil <= block.timestamp) {
            revert UniversalRulesPolicyErrors.InvalidExpiry(incoming.validUntil);
        }
        if (incoming.expectedCEA == bytes32(0) || incoming.gatewayProgram == bytes32(0)) {
            revert UniversalRulesPolicyErrors.InvalidSvmConfigField();
        }

        _checkSvmRules(incoming);
        _checkSvmPinShapes(incoming);
        _checkCeaAccountList(incoming);

        _requireAssets(incoming.assets, chainHash);

        _storeSvm(cfg, incoming);
        cfg.initialized = true;
    }

    /**
     * @dev Allow-list rule guards: tag shape, forbidden programs, and pairwise exactness.
     *      - A rule is `dataless` XOR has a 1..8-byte tag.
     *      - A fixed account count, if set, is within the S13 bound.
     *      - A program the check path forbids as a target is refused here too; S15 is then defence
     *        in depth against state this guard makes unreachable.
     *      - Two rules on one program must not both match one request, or first-match makes the
     *        later rule dead and its pins never run. O(n^2) at n <= 32.
     */
    function _checkSvmRules(SvmTerms memory t) internal pure {
        uint256 n = t.programs.length;
        for (uint256 i; i < n;) {
            AllowedProgram memory r = t.programs[i];
            bool badLen = r.dataless ? r.discriminatorLen != 0 : (r.discriminatorLen == 0 || r.discriminatorLen > 8);
            if (badLen) revert UniversalRulesPolicyErrors.DiscriminatorLenOutOfRange(i, r.discriminatorLen);
            // A fixed count above the S13 loop bound can never be met: every request would fail
            // S13 or S16. Refused here so the owner never grants a rule that is dead on arrival.
            if (r.maxAccounts > MAX_SVM_ACCOUNTS) {
                revert UniversalRulesPolicyErrors.SvmMaxAccountsOutOfRange(i, r.maxAccounts);
            }
            if (_isForbiddenProgram(r.program, t.gatewayProgram, t.expectedCEA)) {
                revert UniversalRulesPolicyErrors.ForbiddenProgramInAllowList(i, r.program);
            }
            for (uint256 j; j < i;) {
                if (_rulesCollide(t.programs[j], r)) revert UniversalRulesPolicyErrors.AmbiguousRule(j, i);
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Two rules collide when a single request could match both: same program and either both
    ///      dataless, or neither dataless with one tag a prefix of the other. A dataless rule and a
    ///      tagged rule never collide — one needs empty ix_data, the other needs at least the tag.
    function _rulesCollide(AllowedProgram memory a, AllowedProgram memory b) internal pure returns (bool) {
        if (a.program != b.program) return false;
        if (a.dataless || b.dataless) return a.dataless && b.dataless;
        uint256 shorter = a.discriminatorLen < b.discriminatorLen ? a.discriminatorLen : b.discriminatorLen;
        bytes8 mask = _prefixMask8(shorter);
        return (a.discriminator & mask) == (b.discriminator & mask);
    }

    /**
     * @dev Pin shape guards, both kinds.
     *      - Account pins: rule in range; index below the loop bound and, when the rule fixes its
     *        account count, below that too. Every rule must own at least one — HYGIENE: an
     *        authority-only pin always passes, and which positions must be pinned is the compiler's
     *        responsibility, not this contract's.
     *        One pin per (rule, index).
     *      - Data pins: rule in range and not dataless; `len` 1..32 for EQ, 1..8 otherwise; from-end
     *        offsets must reach at least `len` back; every offset stays inside the ix_data bound;
     *        the comparison value must be one the field can actually be compared against
     *        (`_dataPinValueValid`).
     */
    function _checkSvmPinShapes(SvmTerms memory t) internal pure {
        uint256 ruleCount = t.programs.length;
        bool[] memory covered = new bool[](ruleCount); // rule i has at least one account pin

        uint256 n = t.pins.length;
        for (uint256 i; i < n;) {
            SvmAccountPin memory pin = t.pins[i];
            if (pin.ruleIndex >= ruleCount) revert UniversalRulesPolicyErrors.SvmPinRuleOutOfRange(i, pin.ruleIndex);
            uint8 cap = t.programs[pin.ruleIndex].maxAccounts;
            if (pin.accountIndex >= MAX_SVM_ACCOUNTS || (cap != 0 && pin.accountIndex >= cap)) {
                revert UniversalRulesPolicyErrors.SvmPinIndexOutOfRange(i, pin.accountIndex);
            }
            // One position, one pin. Two pins on a (rule, index) are either redundant or
            // contradictory, and a contradictory pair makes the rule unsatisfiable. O(n^2), n <= 16.
            for (uint256 j; j < i;) {
                if (t.pins[j].ruleIndex == pin.ruleIndex && t.pins[j].accountIndex == pin.accountIndex) {
                    revert UniversalRulesPolicyErrors.DuplicateSvmPin(j, i);
                }
                unchecked {
                    ++j;
                }
            }
            covered[pin.ruleIndex] = true;
            unchecked {
                ++i;
            }
        }
        for (uint256 r; r < ruleCount;) {
            if (!covered[r]) revert UniversalRulesPolicyErrors.RuleWithoutPin(r);
            unchecked {
                ++r;
            }
        }

        n = t.dataPins.length;
        for (uint256 i; i < n;) {
            SvmDataPin memory dp = t.dataPins[i];
            if (dp.ruleIndex >= ruleCount || t.programs[dp.ruleIndex].dataless) {
                revert UniversalRulesPolicyErrors.SvmDataPinInvalid(i);
            }
            uint256 maxLen = dp.mode == SvmDataPinMode.EQ ? 32 : 8;
            if (dp.len == 0 || dp.len > maxLen) revert UniversalRulesPolicyErrors.SvmDataPinInvalid(i);
            if (!_offsetValid(dp.fromEnd, dp.offset, dp.len)) revert UniversalRulesPolicyErrors.SvmDataPinInvalid(i);
            if (!_dataPinValueValid(dp)) revert UniversalRulesPolicyErrors.SvmDataPinInvalid(i);
            unchecked {
                ++i;
            }
        }
    }

    /// @dev A from-start field must end inside the bound; a from-end field must start at least `len`
    ///      back and no further back than the bound.
    function _offsetValid(bool fromEnd, uint16 offset, uint8 len) internal pure returns (bool) {
        if (fromEnd) return uint256(offset) >= len && uint256(offset) <= MAX_SVM_IX_DATA;
        return uint256(offset) + len <= MAX_SVM_IX_DATA;
    }

    /**
     * @dev Refuses a data pin whose comparison is vacuous or impossible, and the encoding mistake that
     *      would make it so. The two value encodings differ by mode — EQ compares LEFT-ALIGNED raw
     *      bytes, the integer modes compare a RIGHT-ALIGNED integer — and each mis-encoding of one
     *      as the other is caught here, at grant, instead of producing a pin that silently never
     *      fails (a ceiling above the field's range) or never passes.
     *      - EQ: every byte of `expected` past `len` must be zero (a right-aligned integer would
     *        leave its value there).
     *      - GTE / LTE: `expected` must fit in `len` bytes, i.e. `< 2^(8·len)`.
     *      - RATIO: `num` and `den` non-zero (`num == 0` makes `a·den >= 0` always true), and the
     *        second field's offset valid.
     */
    function _dataPinValueValid(SvmDataPin memory dp) internal pure returns (bool) {
        if (dp.mode == SvmDataPinMode.EQ) return dp.expected & ~_prefixMask32(dp.len) == bytes32(0);
        if (dp.mode == SvmDataPinMode.RATIO_GTE_LE) {
            return dp.num != 0 && dp.den != 0 && _offsetValid(dp.fromEnd, dp.offsetB, dp.len);
        }
        return uint256(dp.expected) >> (8 * uint256(dp.len)) == 0;
    }

    /**
     * @dev The CEA-controlled account list that S18 enforces.
     *      - Must contain `expectedCEA`. The CEA always holds value (it is the signer, and pSOL lands
     *        on it), so an empty or CEA-less list would silently switch the aliasing defence off.
     *      - No zero entry: `bytes32(0)` is the System program's id, present in most account lists,
     *        and would make every request fail.
     *      - No entry equal to an allow-listed program: Anchor passes the program's own account in
     *        many instructions, and listing it would make every such request fail.
     *      - No duplicates.
     *      All four fail closed at check time anyway; refusing them here means an owner never grants
     *      a rules set that can never be used.
     */
    function _checkCeaAccountList(SvmTerms memory t) internal pure {
        uint256 n = t.ceaAccounts.length;
        bool hasCea;
        for (uint256 i; i < n;) {
            bytes32 key = t.ceaAccounts[i];
            if (key == bytes32(0)) revert UniversalRulesPolicyErrors.InvalidCeaAccount(i);
            if (key == t.expectedCEA) hasCea = true;
            for (uint256 j; j < i;) {
                if (t.ceaAccounts[j] == key) revert UniversalRulesPolicyErrors.InvalidCeaAccount(i);
                unchecked {
                    ++j;
                }
            }
            uint256 rules = t.programs.length;
            for (uint256 r; r < rules;) {
                if (t.programs[r].program == key) revert UniversalRulesPolicyErrors.InvalidCeaAccount(i);
                unchecked {
                    ++r;
                }
            }
            unchecked {
                ++i;
            }
        }
        if (!hasCea) revert UniversalRulesPolicyErrors.CeaAccountsMissExpectedCEA();
    }

    /// @dev The programs an SVM rules set may never target, directly. Inner CPIs are the allow-listed
    ///      program's own business — this set guards the top level only.
    function _isForbiddenProgram(bytes32 program, bytes32 gatewayProgram, bytes32 cea) internal pure returns (bool) {
        return program == SYSTEM_PROGRAM || program == SPL_TOKEN_PROGRAM || program == TOKEN_2022_PROGRAM
            || program == STAKE_PROGRAM || program == BPF_LOADER_UPGRADEABLE || program == ADDRESS_LOOKUP_TABLE
            || program == gatewayProgram || program == cea;
    }

    /**
     * @notice Runs every gate a cross-chain agent request must pass. Order is fixed; any failure
     *         reverts with nothing written.
     *
     * @dev    - Not `view`: gate 7 accumulates spend, and the engine invokes this with a real call
     *           so the write persists.
     *         - Runs before the session signature is verified, on unauthenticated calldata from an
     *           arbitrary caller. It is safe because it makes no external call, applies all effects
     *           last, and reverts on every failure. Do not introduce an external call here.
     *         - Replayed signatures cannot burn budget through this door; they die at the wallet's
     *           nonce gate first.
     *
     *         The gates, in order:
     *         1.  the config is initialised
     *         2.  the rules set has not expired
     *         3.  the target is the gateway
     *         4.  calldata is at least four bytes; the selector is the outbound send; the body is at
     *             least the minimum encoded length
     *         5.  the token is one of the listed assets — on EVERY request, zero amount included,
     *             because the token is what the gateway routes by
     *         6.  the amount is within THAT asset's per-call cap
     *         7.  THAT asset's running total is within its lifetime cap
     *         8.  the Push-native value is within the per-call ceiling (`maxGasPerCall`)
     *         9.  the request does not ask for an uncapped gas swap
     *         10. the revert recipient is the wallet
     *         11. the recipient field is empty
     *         12. the payload is a multicall
     *         13. the inner call count is between one and the maximum
     *         14. no inner call targets the wallet, this policy, the gateway or the destination
     *             account
     *         15. each inner target and selector is allow-listed, and where the rule declares a
     *             beneficiary it matches the expected destination account
     *         16. each inner value is within its rule's allowance
     *
     *         - A zero amount passes gate 6 and writes nothing: zero-amount is the redeployment
     *           path, acting on capital already at the destination. There is no zero-amount gate and
     *           one must not be added.
     *         - `abi.decode` ignores trailing bytes, so gate 4c is a length floor and not a
     *           canonical-encoding check. There is no exploit: the whole execution calldata is bound
     *           into the wallet's operation hash, and the signature is verified last.
     *         - A body of correct length carrying malformed internal offsets reverts with a compiler
     *           panic rather than a named error. It cannot be given a named error without wrapping
     *           the decode in an external call, which this function must not have.
     *         - Spend accumulation is optimistic but atomic: it is written during validation and
     *           survives only because validation and dispatch share one transaction. Splitting them
     *           breaks the accounting silently.
     *         - Gate 14 runs before gate 15 on purpose, so a forbidden destination beats the
     *           allow-list: an owner who allow-listed their own destination account still cannot
     *           hand the agent direct control of it.
     *
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet. The engine passes its own caller through as this parameter, so it
     *                  is never the engine itself.
     * @param  target   Push-side call target; must be the gateway.
     * @param  value    Push-native value attached to the call.
     * @param  data     The gateway calldata, opened and walked by the gates above.
     * @return The engine's success sentinel.
     */
    function checkAction(ConfigId id, address account, address target, uint256 value, bytes calldata data)
        external
        returns (uint256)
    {
        // MODE ROUTING. An EMPTY slot falls through to the universal path, whose gate 1 reverts
        // `NotInitialized` — fail-closed either way. The `initialized &&` conjunction is what makes
        // that safe: `RulesType.UNIVERSAL` is the zero value, so testing `mode` alone could not
        // tell an empty slot from a real universal one.
        ModeSlot storage slot = _mode[id][msg.sender][account];
        if (slot.initialized) {
            if (slot.mode == RulesType.NATIVE) return _checkNative(id, account, target, value, data);
            // The family byte was never written by earlier implementations, so it reads 0 = EVM on
            // every pre-existing universal slot — those keep routing exactly where they always did.
            if (slot.vm == VmFamily.SVM) return _checkSvm(id, account, target, value, data);
        }
        return _checkUniversal(id, account, target, value, data);
    }

    /**
     * @dev The universal gauntlet — gates 1 to 16, unchanged from the single-mode contract. Only the
     *      function name and visibility changed; the body is byte-for-byte what `checkAction` was.
     *
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet.
     * @param  target   Push-side call target; must be the gateway.
     * @param  value    Push-native value attached to the call.
     * @param  data     The gateway calldata.
     * @return The engine's success sentinel.
     */
    function _checkUniversal(ConfigId id, address account, address target, uint256 value, bytes calldata data)
        internal
        returns (uint256)
    {
        Config storage cfg = _configs[id][msg.sender][account];

        if (!cfg.initialized) revert UniversalRulesPolicyErrors.NotInitialized(id, account);

        if (block.timestamp > cfg.validUntil) revert UniversalRulesPolicyErrors.RulesExpired(cfg.validUntil);

        if (target != UNIVERSAL_GATEWAY_PC) revert UniversalRulesPolicyErrors.InvalidTarget(target);

        if (data.length < 4) revert UniversalRulesPolicyErrors.CalldataTooShort(data.length);

        if (bytes4(data[0:4]) != SEND_OUTBOUND_SELECTOR) {
            revert UniversalRulesPolicyErrors.InvalidSelector(bytes4(data[0:4]));
        }

        if (data.length < 4 + MIN_OUTBOUND_BODY_LEN) {
            revert UniversalRulesPolicyErrors.MalformedOutboundRequest(data.length);
        }
        UniversalOutboundTxRequest memory req = abi.decode(data[4:], (UniversalOutboundTxRequest));

        AssetCapState storage cap = _assetFor(cfg.assets, req.token);

        if (req.amount > cap.maxPerCall) {
            revert UniversalRulesPolicyErrors.AmountExceedsCap(req.amount, cap.maxPerCall);
        }

        uint256 newSpent = cap.spent + req.amount;
        if (newSpent > cap.maxTotal) revert UniversalRulesPolicyErrors.TotalSpendCapExceeded(newSpent, cap.maxTotal);

        if (value > cfg.maxGasPerCall) revert UniversalRulesPolicyErrors.PCValueExceedsCap(value, cfg.maxGasPerCall);

        if (req.maxPCForGas == 0) revert UniversalRulesPolicyErrors.UncappedGasSwapRejected();

        if (req.revertRecipient != account) {
            revert UniversalRulesPolicyErrors.InvalidRevertRecipient(account, req.revertRecipient);
        }

        if (req.recipient.length != 0) revert UniversalRulesPolicyErrors.RecipientMustBeEmpty();

        _checkInnerCalls(cfg, account, req.payload);

        if (req.amount > 0) {
            cap.spent = newSpent;
            emit OutboundMetered(id, msg.sender, account, req.token, req.amount);
        }

        return VALIDATION_SUCCESS;
    }

    /**
     * @dev The native gauntlet — gates N1 to N9, then effects. The same discipline as the universal
     *      path and for the same reason: this runs BEFORE the session signature is verified, on
     *      unauthenticated calldata from an arbitrary caller.
     *
     *      - NO EXTERNAL CALLS. Pins and the metered amount are read by slicing `data` directly,
     *        never through `_slice` into memory and never through a helper that calls out.
     *      - ALL EFFECTS LAST. `newValueSpent` and `newAmountSpent` are computed at N6/N8 and
     *        assigned only after N9 passes, exactly as `_checkUniversal` handles `newSpent`. A
     *        request that fails at N7 leaves every counter untouched.
     *      - BOUNDS ARITHMETIC IS DONE IN `uint256`. `pin.offset` is `uint16`, so
     *        `uint256(offset) + 32` cannot wrap — but written as `uint16` arithmetic it would, and
     *        the check would pass on a crafted offset. Do not "simplify" the cast away.
     *      - `callsUsed` ALWAYS increments on success, including on a zero-value zero-amount call.
     *        A call is a use; mirroring universal's zero-amount rule (which writes nothing) would
     *        make `maxCalls` bypassable by zero-value calls, i.e. advisory. This is the one
     *        deliberate divergence between the two rulebooks.
     *      - Value-only configs carry no pins and no amount rule — init refuses that combination —
     *        so with `data.length == 0` the N7 loop does not execute and N8 is skipped.
     *
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet.
     * @param  target   Push-side call target; must be the configured native target.
     * @param  value    Push-native value attached to the call.
     * @param  data     The native calldata, read but never decoded as a structure.
     * @return The engine's success sentinel.
     */
    function _checkNative(ConfigId id, address account, address target, uint256 value, bytes calldata data)
        internal
        returns (uint256)
    {
        NativeConfig storage cfg = _native[id][msg.sender][account];

        // N1
        if (!cfg.initialized) revert UniversalRulesPolicyErrors.NotInitialized(id, account);

        // N2
        if (block.timestamp > cfg.validUntil) revert UniversalRulesPolicyErrors.RulesExpired(cfg.validUntil);

        // N3 — the consistency lock, mirror of universal gate 3. Init refuses a gateway target, so
        // this can only fire on state the wallet's grant check makes unreachable. It is defence in
        // depth against a mis-wired grant, not dead code.
        if (target == UNIVERSAL_GATEWAY_PC) revert UniversalRulesPolicyErrors.NativeTargetIsGateway(target);

        // N4
        if (target != cfg.target) revert UniversalRulesPolicyErrors.TargetMismatch(target, cfg.target);

        // N5 — under four bytes is the engine's value-only selector; four or more is a real one.
        bytes4 sel = data.length < 4 ? VALUE_SELECTOR : bytes4(data[0:4]);
        if (sel != cfg.selector) revert UniversalRulesPolicyErrors.SelectorMismatch(sel, cfg.selector);
        // Value-only means EMPTY calldata (register N-46). The engine buckets 1..3 bytes under the
        // same actionId, so URP is the layer that makes the documented meaning true.
        if (sel == VALUE_SELECTOR && data.length != 0) {
            revert UniversalRulesPolicyErrors.ValueOnlyCalldataNotEmpty(data.length);
        }

        // N6
        if (value > cfg.maxValuePerCall) revert UniversalRulesPolicyErrors.ValueExceedsCap(value, cfg.maxValuePerCall);
        uint256 newValueSpent = cfg.valueSpent + value;
        if (newValueSpent > cfg.maxValueTotal) {
            revert UniversalRulesPolicyErrors.TotalValueExceeded(newValueSpent, cfg.maxValueTotal);
        }

        // N7
        uint256 pinCount = cfg.pins.length;
        for (uint256 i; i < pinCount;) {
            ArgPin storage pin = cfg.pins[i];
            uint256 needed = uint256(pin.offset) + 32;
            if (data.length < needed) revert UniversalRulesPolicyErrors.CalldataTooShortForPin(data.length, i, needed);

            bytes32 actual = bytes32(data[pin.offset:needed]);
            if (actual != pin.expected) revert UniversalRulesPolicyErrors.ArgPinMismatch(actual, i, pin.expected);

            unchecked {
                ++i;
            }
        }

        // N8
        uint256 amt;
        uint256 newAmountSpent = cfg.amountSpent;
        if (cfg.amount.enabled) {
            uint256 neededAmt = uint256(cfg.amount.offset) + 32;
            if (data.length < neededAmt) {
                revert UniversalRulesPolicyErrors.CalldataTooShortForAmount(data.length, neededAmt);
            }

            amt = uint256(bytes32(data[cfg.amount.offset:neededAmt]));
            if (amt > cfg.amount.maxPerCall) {
                revert UniversalRulesPolicyErrors.NativeAmountExceedsCap(amt, cfg.amount.maxPerCall);
            }

            newAmountSpent = cfg.amountSpent + amt;
            if (newAmountSpent > cfg.amount.maxTotal) {
                revert UniversalRulesPolicyErrors.TotalNativeAmountExceeded(newAmountSpent, cfg.amount.maxTotal);
            }
        }

        // N9
        if (cfg.maxCalls != 0 && cfg.callsUsed >= cfg.maxCalls) {
            revert UniversalRulesPolicyErrors.CallLimitReached(cfg.callsUsed, cfg.maxCalls);
        }

        // Effects, last.
        cfg.valueSpent = newValueSpent;
        cfg.amountSpent = newAmountSpent;
        unchecked {
            // Bounded by N9 when maxCalls != 0; when it is 0 the counter is informational and a
            // uint32 overflow is unreachable at any realistic call volume.
            cfg.callsUsed = cfg.callsUsed + 1;
        }
        emit NativeCallMetered(id, msg.sender, account, value, amt);

        return VALIDATION_SUCCESS;
    }

    /**
     * @dev Implements gates 12 to 16 of `checkAction`'s list.
     *
     *      - Split out for stack depth only. It makes no external call and writes no storage, so the
     *        caller's effects-last property holds.
     *      - Gate 12 is not merely a format check: the destination account dispatches on the payload
     *        prefix, and only the multicall branch has entries that gates 13 to 16 can walk. Its
     *        other branches re-target the account itself or call an arbitrary target with the raw
     *        payload, bypassing the allow-list, the beneficiary pin and the per-entry value cap.
     *        Do not weaken this gate, or the agent picks its own branch.
     *      - A payload that is exactly the multicall selector, or the selector followed by malformed
     *        bytes, reverts inside the ABI decoder rather than with a named error. No minimum-length
     *        pre-check is added: unlike gate 4c, this decode sits behind eleven gates on an already
     *        constrained request, so a second hand-derived constant would be more surface than the
     *        named error is worth. It fails closed either way.
     *
     * @param cfg      Config to validate against.
     * @param account  The wallet, used as the forbidden self-target and the refund destination.
     * @param payload  The multicall payload carried by the outbound request.
     */
    function _checkInnerCalls(Config storage cfg, address account, bytes memory payload) internal view {
        if (payload.length < 4 || bytes4(_slice(payload, 0, 4)) != MULTICALL_SELECTOR) {
            revert UniversalRulesPolicyErrors.PayloadNotMulticall();
        }

        Multicall[] memory calls = abi.decode(_slice(payload, 4, payload.length - 4), (Multicall[]));

        uint256 count = calls.length;
        if (count == 0 || count > MAX_ACTIONS_PER_REQUEST) {
            revert UniversalRulesPolicyErrors.BatchSizeOutOfRange(count);
        }

        address expectedCEA = cfg.expectedCEA;

        for (uint256 i; i < count;) {
            Multicall memory entry = calls[i];

            if (
                entry.to == account || entry.to == address(this) || entry.to == UNIVERSAL_GATEWAY_PC
                    || entry.to == expectedCEA
            ) {
                revert UniversalRulesPolicyErrors.ForbiddenInnerTarget(entry.to);
            }
            if (entry.data.length < 4) revert UniversalRulesPolicyErrors.MalformedInnerCalldata();

            AllowedCall memory rule = _requireAllowed(cfg, entry.to, bytes4(_slice(entry.data, 0, 4)));
            if (rule.hasBeneficiary) {
                address beneficiary = _extractBeneficiary(entry.data, rule.beneficiaryOffset);
                if (beneficiary != expectedCEA) {
                    revert UniversalRulesPolicyErrors.BeneficiaryMismatch(expectedCEA, beneficiary);
                }
            }

            // Destination-chain native units, never the Push-side value: two assets on two chains.
            if (entry.value > rule.maxValue) {
                revert UniversalRulesPolicyErrors.InnerValueExceedsAllowance(i, entry.value, rule.maxValue);
            }

            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev The SVM gauntlet — S1 to S18, then effects. Same discipline as the other two: it runs
     *      BEFORE the session signature is verified, on unauthenticated calldata from an arbitrary
     *      caller, so it makes no external call, applies all effects last, and reverts on every
     *      failure.
     *
     *      S1-S10 are the universal gates 1-10 restated against `SvmConfig` — they are chain-
     *      independent. S6b is Solana's u64 amount. S11 onwards replace gates 11-16:
     *
     *      S11  the recipient is a 32-byte, non-zero pubkey (the target program)
     *      S12  the payload is non-empty and parses as the node's execute grammar, exactly
     *      S13  instruction_id is 2 (execute); account count and ix_data length are within bounds
     *      S14  the payload's target program equals the recipient
     *      S15  the target is not a forbidden program
     *      S16  a rule matches (program, tag) — first match — and its account count, if fixed, holds
     *      S17  every account pin and every data pin of that rule holds
     *      S18  every CEA-controlled account in the list sits only where that rule pins it
     *
     *      - A zero amount passes S6/S7 and writes nothing: on SVM that is a payload-only call
     *        acting on capital already at the destination, the analogue of the EVM redeploy path.
     *      - The forbidden-program check runs before the allow-list, as gate 14 runs before 15.
     */
    function _checkSvm(ConfigId id, address account, address target, uint256 value, bytes calldata data)
        internal
        returns (uint256)
    {
        SvmConfig storage cfg = _svm[id][msg.sender][account];

        if (!cfg.initialized) revert UniversalRulesPolicyErrors.NotInitialized(id, account);

        if (block.timestamp > cfg.validUntil) revert UniversalRulesPolicyErrors.RulesExpired(cfg.validUntil);

        if (target != UNIVERSAL_GATEWAY_PC) revert UniversalRulesPolicyErrors.InvalidTarget(target);

        if (data.length < 4) revert UniversalRulesPolicyErrors.CalldataTooShort(data.length);

        if (bytes4(data[0:4]) != SEND_OUTBOUND_SELECTOR) {
            revert UniversalRulesPolicyErrors.InvalidSelector(bytes4(data[0:4]));
        }

        if (data.length < 4 + MIN_OUTBOUND_BODY_LEN) {
            revert UniversalRulesPolicyErrors.MalformedOutboundRequest(data.length);
        }
        UniversalOutboundTxRequest memory req = abi.decode(data[4:], (UniversalOutboundTxRequest));

        AssetCapState storage cap = _assetFor(cfg.assets, req.token);

        if (req.amount > cap.maxPerCall) {
            revert UniversalRulesPolicyErrors.AmountExceedsCap(req.amount, cap.maxPerCall);
        }

        if (req.amount > type(uint64).max) revert UniversalRulesPolicyErrors.AmountExceedsU64(req.amount);

        uint256 newSpent = cap.spent + req.amount;
        if (newSpent > cap.maxTotal) revert UniversalRulesPolicyErrors.TotalSpendCapExceeded(newSpent, cap.maxTotal);

        if (value > cfg.maxGasPerCall) revert UniversalRulesPolicyErrors.PCValueExceedsCap(value, cfg.maxGasPerCall);

        if (req.maxPCForGas == 0) revert UniversalRulesPolicyErrors.UncappedGasSwapRejected();

        if (req.revertRecipient != account) {
            revert UniversalRulesPolicyErrors.InvalidRevertRecipient(account, req.revertRecipient);
        }

        // S11 — a zero pubkey is reported with the length it has (32): the shape is right, the value
        // is not, and both are "not a pubkey".
        if (req.recipient.length != 32) revert UniversalRulesPolicyErrors.RecipientNotPubkey(req.recipient.length);
        bytes32 recipient = _loadWord(req.recipient, 0);
        if (recipient == bytes32(0)) revert UniversalRulesPolicyErrors.RecipientNotPubkey(32);

        _checkSvmPayload(cfg, recipient, req.payload);

        if (req.amount > 0) {
            cap.spent = newSpent;
            emit OutboundMetered(id, msg.sender, account, req.token, req.amount);
        }

        return VALIDATION_SUCCESS;
    }

    /// @dev The parsed shape of an execute payload. Memory only; never stored.
    struct SvmPayloadView {
        uint256 count;
        uint256 ixOff;
        uint256 ixLen;
        bytes32 target;
    }

    /**
     * @dev S12 to S18. Split out for stack depth; makes no external call, writes no storage.
     * @param cfg        Config to validate against.
     * @param recipient  The request's recipient, already proven to be a non-zero pubkey.
     * @param payload    The execute payload carried by the outbound request.
     */
    function _checkSvmPayload(SvmConfig storage cfg, bytes32 recipient, bytes memory payload) internal view {
        SvmPayloadView memory v = _parseSvmPayload(payload);

        if (v.target != recipient) revert UniversalRulesPolicyErrors.RecipientTargetMismatch(recipient, v.target);

        if (_isForbiddenProgram(v.target, cfg.gatewayProgram, cfg.expectedCEA)) {
            revert UniversalRulesPolicyErrors.ForbiddenTargetProgram(v.target);
        }

        uint256 rule = _matchSvmRule(cfg, payload, v);

        _checkSvmAccountPins(cfg, payload, v, rule);
        _checkSvmDataPins(cfg, payload, v, rule);
        _checkCeaAccounts(cfg, payload, v, rule);
    }

    /**
     * @dev S12/S13 — the node's `decodePayload` grammar, byte for byte, including "consumed exactly":
     *      `[u32 BE count][count × (pubkey32 ‖ writable u8)][u32 BE len][ix_data][u8 id][target32]`.
     *      Every length is checked before the read it guards. `is_writable` bytes are read past,
     *      never judged — a wrong flag fails on Solana, not here.
     */
    function _parseSvmPayload(bytes memory p) internal pure returns (SvmPayloadView memory v) {
        if (p.length == 0) revert UniversalRulesPolicyErrors.SvmPayloadEmpty();
        if (p.length < SVM_HEADER_LEN + SVM_LEN_FIELD + SVM_TRAILER_LEN) {
            revert UniversalRulesPolicyErrors.MalformedSvmPayload(1);
        }

        v.count = _u32be(p, 0);
        if (v.count > MAX_SVM_ACCOUNTS) revert UniversalRulesPolicyErrors.SvmAccountsOutOfRange(v.count);

        uint256 lenOff = SVM_HEADER_LEN + v.count * SVM_ACCOUNT_LEN;
        if (p.length < lenOff + SVM_LEN_FIELD) revert UniversalRulesPolicyErrors.MalformedSvmPayload(2);

        v.ixLen = _u32be(p, lenOff);
        if (v.ixLen > MAX_SVM_IX_DATA) revert UniversalRulesPolicyErrors.SvmIxDataTooLong(v.ixLen);
        v.ixOff = lenOff + SVM_LEN_FIELD;

        uint256 expected = v.ixOff + v.ixLen + SVM_TRAILER_LEN;
        if (p.length < expected) revert UniversalRulesPolicyErrors.MalformedSvmPayload(3);
        if (p.length > expected) revert UniversalRulesPolicyErrors.MalformedSvmPayload(4);

        uint8 id = uint8(p[v.ixOff + v.ixLen]);
        if (id != SVM_INSTRUCTION_EXECUTE) revert UniversalRulesPolicyErrors.SvmInstructionNotExecute(id);

        v.target = _loadWord(p, v.ixOff + v.ixLen + 1);
    }

    /**
     * @dev S16 — first rule whose program equals the target and whose tag matches: a dataless rule
     *      matches only empty ix_data; a tagged rule needs at least `discriminatorLen` bytes and a
     *      prefix-equal tag. Init guarantees at most one rule can match, so first-match is exact.
     *      Then the rule's fixed account count, if any.
     */
    function _matchSvmRule(SvmConfig storage cfg, bytes memory p, SvmPayloadView memory v)
        internal
        view
        returns (uint256)
    {
        uint256 n = cfg.programs.length;
        for (uint256 i; i < n;) {
            AllowedProgram storage r = cfg.programs[i];
            if (r.program == v.target && _tagMatches(r, p, v)) {
                uint8 cap = r.maxAccounts;
                if (cap != 0 && v.count != cap) {
                    revert UniversalRulesPolicyErrors.SvmAccountCountMismatch(v.count, cap);
                }
                return i;
            }
            unchecked {
                ++i;
            }
        }
        uint256 shown = v.ixLen < 8 ? v.ixLen : 8;
        revert UniversalRulesPolicyErrors.ProgramNotAllowed(
            v.target, bytes8(_loadWord(p, v.ixOff)) & _prefixMask8(shown)
        );
    }

    function _tagMatches(AllowedProgram storage r, bytes memory p, SvmPayloadView memory v)
        internal
        view
        returns (bool)
    {
        if (r.dataless) return v.ixLen == 0;
        uint8 len = r.discriminatorLen;
        if (v.ixLen < len) return false;
        bytes8 mask = _prefixMask8(len);
        return (bytes8(_loadWord(p, v.ixOff)) & mask) == (r.discriminator & mask);
    }

    /// @dev S17, account half: every pin of the matched rule names an index that exists and holds
    ///      the expected key.
    function _checkSvmAccountPins(SvmConfig storage cfg, bytes memory p, SvmPayloadView memory v, uint256 rule)
        internal
        view
    {
        uint256 n = cfg.pins.length;
        for (uint256 i; i < n;) {
            SvmAccountPin storage pin = cfg.pins[i];
            if (pin.ruleIndex == rule) {
                if (v.count <= pin.accountIndex) {
                    revert UniversalRulesPolicyErrors.SvmAccountCountBelowPin(i, v.count, pin.accountIndex);
                }
                bytes32 actual = _svmAccount(p, pin.accountIndex);
                if (actual != pin.expected) {
                    revert UniversalRulesPolicyErrors.SvmAccountPinMismatch(i, pin.accountIndex, pin.expected, actual);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev S17, data half. Offsets resolve from the start or the end of ix_data; init proved the
    ///      from-end shape reaches at least `len` back, so only the length floor is checked here.
    ///      Integer reads are little-endian, `len` bytes; the ratio is computed in uint256 and cannot
    ///      overflow (both operands are at most 64 bits wide).
    function _checkSvmDataPins(SvmConfig storage cfg, bytes memory p, SvmPayloadView memory v, uint256 rule)
        internal
        view
    {
        uint256 n = cfg.dataPins.length;
        for (uint256 i; i < n;) {
            SvmDataPin storage dp = cfg.dataPins[i];
            if (dp.ruleIndex == rule) _checkOneDataPin(dp, p, v, i);
            unchecked {
                ++i;
            }
        }
    }

    function _checkOneDataPin(SvmDataPin storage dp, bytes memory p, SvmPayloadView memory v, uint256 i) internal view {
        uint256 off = _resolveOffset(dp.fromEnd, dp.offset, dp.len, v.ixLen, i);
        uint256 at = v.ixOff + off;
        SvmDataPinMode mode = dp.mode;

        if (mode == SvmDataPinMode.EQ) {
            bytes32 mask = _prefixMask32(dp.len);
            bytes32 actual = _loadWord(p, at) & mask;
            bytes32 want = dp.expected & mask;
            if (actual != want) revert UniversalRulesPolicyErrors.SvmDataPinMismatch(i, want, actual);
            return;
        }

        uint256 a = _uintLE(p, at, dp.len);
        if (mode == SvmDataPinMode.GTE_LE) {
            if (a < uint256(dp.expected)) {
                revert UniversalRulesPolicyErrors.SvmDataFloorNotMet(i, a, uint256(dp.expected));
            }
        } else if (mode == SvmDataPinMode.LTE_LE) {
            if (a > uint256(dp.expected)) {
                revert UniversalRulesPolicyErrors.SvmDataCeilingExceeded(i, a, uint256(dp.expected));
            }
        } else {
            uint256 offB = _resolveOffset(dp.fromEnd, dp.offsetB, dp.len, v.ixLen, i);
            uint256 b = _uintLE(p, v.ixOff + offB, dp.len);
            if (a * dp.den < b * dp.num) revert UniversalRulesPolicyErrors.SvmDataRatioNotMet(i, a, b, dp.num, dp.den);
        }
    }

    /// @dev The field's start relative to ix_data, or `SvmDataTooShortForPin` if ix_data cannot hold it.
    function _resolveOffset(bool fromEnd, uint16 offset, uint8 len, uint256 ixLen, uint256 pin)
        internal
        pure
        returns (uint256)
    {
        if (fromEnd) {
            if (ixLen < offset) revert UniversalRulesPolicyErrors.SvmDataTooShortForPin(pin, ixLen);
            return ixLen - offset;
        }
        if (ixLen < uint256(offset) + len) revert UniversalRulesPolicyErrors.SvmDataTooShortForPin(pin, ixLen);
        return offset;
    }

    /**
     * @dev S18 — a CEA-controlled account may appear only where the matched rule pins it. Any other
     *      occurrence hands a program, running with the CEA's signature, an account it was not
     *      granted. Accounts absent from `ceaAccounts` are not judged: the list is the owner's
     *      statement of what holds value. O(count × |ceaAccounts| × |pins|), all bounded.
     */
    function _checkCeaAccounts(SvmConfig storage cfg, bytes memory p, SvmPayloadView memory v, uint256 rule)
        internal
        view
    {
        // Never empty: init requires `expectedCEA` in the list (`_checkCeaAccountList`).
        uint256 listed = cfg.ceaAccounts.length;
        for (uint256 i; i < v.count;) {
            bytes32 key = _svmAccount(p, i);
            for (uint256 c; c < listed;) {
                if (cfg.ceaAccounts[c] == key && !_pinnedAt(cfg, rule, i)) {
                    revert UniversalRulesPolicyErrors.CeaAccountAtUnpinnedIndex(i, key);
                }
                unchecked {
                    ++c;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Whether the matched rule pins `index` at all. S17 has already proved that every pinned
    ///      position holds its expected key, so "pinned" and "pinned to this key" are the same fact
    ///      here and the key is not re-compared.
    function _pinnedAt(SvmConfig storage cfg, uint256 rule, uint256 index) internal view returns (bool) {
        uint256 n = cfg.pins.length;
        for (uint256 i; i < n;) {
            SvmAccountPin storage pin = cfg.pins[i];
            if (pin.ruleIndex == rule && pin.accountIndex == index) return true;
            unchecked {
                ++i;
            }
        }
        return false;
    }

    // ───────────────────────── svm byte helpers (pure, memory only) ─────────────────────────

    /// @dev The pubkey of account `i` in a parsed payload. Callers bound `i` by the parsed count.
    function _svmAccount(bytes memory p, uint256 i) internal pure returns (bytes32) {
        return _loadWord(p, SVM_HEADER_LEN + i * SVM_ACCOUNT_LEN);
    }

    /// @dev Loads 32 bytes at `off`. Every caller has already proved the bytes it USES are inside
    ///      `b`; bytes past the end are masked away by the caller, never compared.
    function _loadWord(bytes memory b, uint256 off) internal pure returns (bytes32 w) {
        // solhint-disable-next-line no-inline-assembly
        assembly ("memory-safe") {
            w := mload(add(add(b, 0x20), off))
        }
    }

    function _u32be(bytes memory b, uint256 off) internal pure returns (uint256) {
        return uint256(uint32(bytes4(_loadWord(b, off))));
    }

    /// @dev Little-endian unsigned integer of `len` bytes (1..8) starting at `off`.
    function _uintLE(bytes memory b, uint256 off, uint256 len) internal pure returns (uint256 v) {
        bytes32 w = _loadWord(b, off);
        for (uint256 i; i < len;) {
            v |= uint256(uint8(w[i])) << (8 * i);
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Keeps the top `len` bytes of a bytes8. `len` 8 keeps all (a shift by >= 64 is zero).
    function _prefixMask8(uint256 len) internal pure returns (bytes8) {
        return bytes8(~(type(uint64).max >> (8 * len)));
    }

    /// @dev Keeps the top `len` bytes of a bytes32. `len` 32 keeps all.
    function _prefixMask32(uint256 len) internal pure returns (bytes32) {
        return bytes32(~(type(uint256).max >> (8 * len)));
    }

    /**
     * @notice Exact-equality assertion on every per-asset spend counter; the change-flow race guard.
     *
     * @dev    - Intended as the first entry of the owner's atomic change batch: assert, revoke,
     *           grant. A mismatch reverts the whole change.
     *         - Reverts if the config is not initialised. Reading zero from a ghost config is
     *           indistinguishable from reading zero from a real unused rules set, and this function
     *           exists to catch stale belief, so it must not have a silent-pass mode.
     *         - One expected value per listed asset, in list order; a different count reverts
     *           `SpentLengthMismatch` rather than checking a prefix.
     *         - Exact equality in both directions, so a credit landing between read and submit also
     *           forces recomposition.
     *         - Callable by anyone; it is a pure read.
     *
     * @param  id             Config id identifying the rules set.
     * @param  account        The wallet the rules set belongs to.
     * @param  expectedSpent  The per-asset spend totals the caller composed its change against.
     */
    function assertSpent(ConfigId id, address account, uint256[] calldata expectedSpent) external view {
        (bool init, RulesType mode) = _modeOf(id, SESSION_ENGINE, account);
        if (init && mode == RulesType.NATIVE) revert UniversalRulesPolicyErrors.WrongModeForCall(RulesType.NATIVE);

        AssetCapState[] storage assets = _universalAssets(id, account);

        uint256 n = assets.length;
        if (expectedSpent.length != n) revert UniversalRulesPolicyErrors.SpentLengthMismatch(n, expectedSpent.length);
        for (uint256 i; i < n;) {
            AssetCapState storage a = assets[i];
            if (a.spent != expectedSpent[i]) {
                revert UniversalRulesPolicyErrors.AssetSpentMismatch(a.token, expectedSpent[i], a.spent);
            }
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @notice The native change-flow race guard: exact equality on all three counters.
     *
     * @dev    - The native counterpart of the universal `assertSpent`, and the same intent: the
     *           first entry of the owner's atomic change batch — assert, revoke, grant.
     *         - Reverts `WrongModeForCall(UNIVERSAL)` on a universal config and `NotInitialized` on
     *           a ghost. It must not have a silent-pass mode: reading zero from a ghost config is
     *           indistinguishable from reading zero from a real unused rules set, and this function
     *           exists to catch stale belief.
     *         - Exact equality on every counter, in both directions.
     *         - Callable by anyone; it is a pure read.
     *
     * @param  id                   Config id identifying the rules set.
     * @param  account              The wallet the rules set belongs to.
     * @param  expectedValueSpent   Native value total the caller composed against.
     * @param  expectedAmountSpent  Metered calldata-amount total the caller composed against.
     * @param  expectedCalls        Call count the caller composed against.
     */
    function assertSpent(
        ConfigId id,
        address account,
        uint256 expectedValueSpent,
        uint256 expectedAmountSpent,
        uint32 expectedCalls
    ) external view {
        (bool init, RulesType mode) = _modeOf(id, SESSION_ENGINE, account);

        if (!init) revert UniversalRulesPolicyErrors.NotInitialized(id, account);
        if (mode != RulesType.NATIVE) revert UniversalRulesPolicyErrors.WrongModeForCall(RulesType.UNIVERSAL);

        NativeConfig storage cfg = _native[id][SESSION_ENGINE][account];

        if (cfg.valueSpent != expectedValueSpent) {
            revert UniversalRulesPolicyErrors.SpentMismatch(expectedValueSpent, cfg.valueSpent);
        }
        if (cfg.amountSpent != expectedAmountSpent) {
            revert UniversalRulesPolicyErrors.SpentMismatch(expectedAmountSpent, cfg.amountSpent);
        }
        if (cfg.callsUsed != expectedCalls) {
            revert UniversalRulesPolicyErrors.SpentMismatch(expectedCalls, cfg.callsUsed);
        }
    }

    /**
     * @notice Credits a confirmed far-side failure back to one asset's spend counter.
     *
     * @dev    - Callable only by the executor module; nobody else can fabricate a failure.
     *         - A ghost config reverts `NotInitialized` and an unlisted token `AssetNotAllowed`; the
     *           revert rolls the idempotency flag back, so a misrouted credit stays retryable. Both are
     *           resolved BEFORE the flag is checked, so an already-credited id sent with an unlisted
     *           token reports the token, the actionable mistake.
     *         - Reverts if the id was already credited.
     *         - Subtracts saturating, since the amount is trusted from Push core and cannot be
     *           verified here. Idempotency and saturation bound a wrong value, PER ASSET: a credit
     *           can never lower another token's counter.
     *         - `token` is trusted from the caller as much as `amount` is: URP never learns the
     *           outbound id at check time, so it cannot map an id to the token it metered.
     *         - Emits the amount actually applied, not the amount claimed, so monitoring can detect
     *           divergence between the two.
     *         - Not yet functional: the executor module does not yet call this on outbound failure,
     *           so until that lands a failed far leg leaves `spent` inflated and the remedy is
     *           revoke-and-regrant.
     *         - There is no gas counter and this path must never introduce one, because gas consumed
     *           on a failed outbound was genuinely consumed.
     *
     * @param  id            Config id identifying the rules set.
     * @param  account       The wallet the rules set belongs to.
     * @param  outboundTxId  Push-core transaction id, the idempotency key.
     * @param  token         The listed asset whose counter is credited.
     * @param  amount        Amount claimed as failed, credited saturating.
     */
    function creditRevert(ConfigId id, address account, bytes32 outboundTxId, address token, uint256 amount) external {
        if (msg.sender != UNIVERSAL_EXECUTOR_MODULE) revert UniversalRulesPolicyErrors.CallerIsNotUEModule(msg.sender);

        AssetCapState storage cap = _assetFor(_universalAssets(id, account), token);

        if (_credited[outboundTxId]) revert UniversalRulesPolicyErrors.AlreadyCredited(outboundTxId);
        _credited[outboundTxId] = true;

        uint256 applied = cap.spent > amount ? amount : cap.spent;
        cap.spent -= applied;

        emit RevertCredited(outboundTxId, id, account, token, applied);
    }

    /**
     * @dev The engine-keyed asset list of a UNIVERSAL config, either family. Reverts `NotInitialized`
     *      on an empty EVM slot; an SVM family byte is only ever written together with an initialised
     *      `SvmConfig`, so that branch needs no check. Shared by `assertSpent` and `creditRevert`.
     */
    function _universalAssets(ConfigId id, address account) internal view returns (AssetCapState[] storage) {
        if (_vmOf(id, SESSION_ENGINE, account) == VmFamily.SVM) return _svm[id][SESSION_ENGINE][account].assets;

        Config storage cfg = _configs[id][SESSION_ENGINE][account];
        if (!cfg.initialized) revert UniversalRulesPolicyErrors.NotInitialized(id, account);
        return cfg.assets;
    }

    /**
     * @dev Gate 5: the entry for `token` in a listed-asset array, or `AssetNotAllowed`. A linear scan
     *      at n <= MAX_ASSETS, so up to eight cold reads on a miss. Makes no external call.
     */
    function _assetFor(AssetCapState[] storage assets, address token) internal view returns (AssetCapState storage) {
        uint256 n = assets.length;
        for (uint256 i; i < n;) {
            AssetCapState storage a = assets[i];
            if (a.token == token) return a;
            unchecked {
                ++i;
            }
        }
        revert UniversalRulesPolicyErrors.AssetNotAllowed(token);
    }

    /**
     * @notice The full universal config including the allow-list, keyed on the session engine.
     *
     * @dev    Reverts `WrongModeForCall(NATIVE)` on a native slot. An EMPTY slot returns the zeroed
     *         struct exactly as it always has — an empty slot is a STATE, a wrong-mode read is a
     *         CALLER BUG, and only the second is worth a revert. `getMode` is the documented first
     *         call for anything that does not already know a rules set's mode.
     *
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet the rules set belongs to.
     * @return The stored config.
     */
    function getConfig(ConfigId id, address account) external view returns (Config memory) {
        (bool init, RulesType mode) = _modeOf(id, SESSION_ENGINE, account);
        if (init && mode == RulesType.NATIVE) revert UniversalRulesPolicyErrors.WrongModeForCall(RulesType.NATIVE);
        if (init && _vmOf(id, SESSION_ENGINE, account) == VmFamily.SVM) {
            revert UniversalRulesPolicyErrors.WrongVmForCall(VmFamily.SVM);
        }

        return _configs[id][SESSION_ENGINE][account];
    }

    /**
     * @notice The full SVM config including its rules and pins, keyed on the session engine.
     * @dev    Reverts `WrongModeForCall(NATIVE)` on a native slot and `WrongVmForCall(EVM)` on an EVM
     *         universal slot; an empty slot returns the zeroed struct. See `getConfig`.
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet the rules set belongs to.
     * @return The stored SVM config.
     */
    function getSvmConfig(ConfigId id, address account) external view returns (SvmConfig memory) {
        (bool init, RulesType mode) = _modeOf(id, SESSION_ENGINE, account);
        if (init && mode == RulesType.NATIVE) revert UniversalRulesPolicyErrors.WrongModeForCall(RulesType.NATIVE);
        if (init && _vmOf(id, SESSION_ENGINE, account) == VmFamily.EVM) {
            revert UniversalRulesPolicyErrors.WrongVmForCall(VmFamily.EVM);
        }

        return _svm[id][SESSION_ENGINE][account];
    }

    /**
     * @notice The full native config including its pins, keyed on the session engine.
     * @dev    Reverts `WrongModeForCall(UNIVERSAL)` on a universal slot; an empty slot returns the
     *         zeroed struct. See `getConfig`.
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet the rules set belongs to.
     * @return The stored native config.
     */
    function getNativeConfig(ConfigId id, address account) external view returns (NativeConfig memory) {
        (bool init, RulesType mode) = _modeOf(id, SESSION_ENGINE, account);
        if (init && mode == RulesType.UNIVERSAL) {
            revert UniversalRulesPolicyErrors.WrongModeForCall(RulesType.UNIVERSAL);
        }

        return _native[id][SESSION_ENGINE][account];
    }

    /**
     * @notice Which rulebook a config uses, and which chain it was granted for. NEVER REVERTS.
     * @dev    The documented first call for any integrator that does not already know a rules set's
     *         mode. An empty slot returns `(initialized: false, mode: UNIVERSAL, chainHash: 0)` — and
     *         the mode value is MEANINGLESS when `initialized` is false, because `UNIVERSAL` is the
     *         enum's zero value. Read `initialized` first, always.
     *
     *         `chainHash` is the rules set's chain, recorded at init (and, for a universal rules set,
     *         verified against every listed asset). It is THE chain record; there is no other.
     * @param  id       Config id identifying the rules set.
     * @param  account  The wallet the rules set belongs to.
     * @return The stored mode record.
     */
    function getMode(ConfigId id, address account) external view returns (ModeSlot memory) {
        return _mode[id][SESSION_ENGINE][account];
    }

    /**
     * @notice Exposes the idempotency set for monitoring.
     * @param  outboundTxId  Push-core transaction id to query.
     * @return Whether that id has already been credited.
     */
    function isCredited(bytes32 outboundTxId) external view returns (bool) {
        return _credited[outboundTxId];
    }

    /**
     * @notice The implementation's version, readable THROUGH the proxy.
     *
     * @dev    The proxy has no version of its own — it delegates, so this answers with whichever
     *         implementation is currently installed. That makes it the cheapest possible check that
     *         an upgrade actually took effect: read it before, upgrade, read it again.
     *
     *         A `constant` in bytecode, deliberately not storage: it must change with the CODE, and
     *         a storage value could drift from the logic it claims to describe.
     *
     *         BUMP THIS IN THE SAME COMMIT AS ANY LOGIC CHANGE.
     */
    function version() external pure returns (string memory) {
        return "3.1.0";
    }

    /**
     * @notice ERC-165 support check.
     * @param  iid  Interface id to query.
     * @return True for the action-policy, policy and ERC-165 interfaces.
     */
    function supportsInterface(bytes4 iid) external pure returns (bool) {
        return
            iid == type(IActionPolicy).interfaceId || iid == type(IPolicy).interfaceId
                || iid == type(IERC165).interfaceId;
    }

    /**
     * @dev Reads the 32-byte word at `offset` and returns its low 20 bytes. Bounds-checked because
     *      reading past the end of a short blob would return adjacent memory, which could be
     *      manipulated to pass the beneficiary check.
     *
     * @param  data    Inner call calldata to read from.
     * @param  offset  Byte offset of the beneficiary word, taken from config and never the request.
     * @return The address encoded at that offset.
     */
    function _extractBeneficiary(bytes memory data, uint16 offset) internal pure returns (address) {
        if (uint256(offset) + 32 > data.length) revert UniversalRulesPolicyErrors.MalformedInnerCalldata();
        bytes32 word;
        assembly {
            word := mload(add(add(data, 0x20), offset))
        }
        return address(uint160(uint256(word)));
    }

    /**
     * @dev The target and selector pair must appear in the allow-list.
     * @param  cfg       Config whose allow-list is scanned.
     * @param  to        Inner call target.
     * @param  selector  Inner call selector.
     * @return The matching rule; reverts with `CallNotAllowed` if there is none.
     */
    function _requireAllowed(Config storage cfg, address to, bytes4 selector)
        internal
        view
        returns (AllowedCall memory)
    {
        uint256 len = cfg.allowedCalls.length;
        for (uint256 i; i < len;) {
            AllowedCall storage rule = cfg.allowedCalls[i];
            if (rule.target == to && rule.selector == selector) {
                return
                    AllowedCall(rule.target, rule.selector, rule.beneficiaryOffset, rule.hasBeneficiary, rule.maxValue);
            }
            unchecked {
                ++i;
            }
        }
        revert UniversalRulesPolicyErrors.CallNotAllowed(to, selector);
    }

    /**
     * @dev Memory slice helper. The bounds branch is unreachable from the three call sites, which
     *      are all length-guarded by gates 12 and 14, and is expected to show as uncovered. It stays
     *      because this is a `pure` helper whose safety must not depend on every future caller.
     *
     * @param  data   Blob to slice.
     * @param  start  Byte offset to start at.
     * @param  len    Number of bytes to copy.
     * @return out    The requested slice.
     */
    function _slice(bytes memory data, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        if (start + len > data.length) revert UniversalRulesPolicyErrors.MalformedInnerCalldata();
        out = new bytes(len);
        // MCOPY requires evm_version = "cancun"; lowering the EVM target breaks this silently at
        // deploy time rather than loudly at compile time.
        assembly ("memory-safe") {
            mcopy(add(out, 0x20), add(add(data, 0x20), start), len)
        }
    }

    /**
     * @dev Copies decoded WIRE terms into the STORAGE config. The two are deliberately different
     *      types: the wire shape is free to change, the storage layout is frozen forever
     *      (see the layout note on `__gap`).
     *
     *      - Forces every asset's `spent` to zero. It is not a wire field at all — URP owns it.
     *      - Stores no chain: the chain of every rules set lives on `ModeSlot.chainHash`, where it has
     *        been verified against every listed asset.
     *      - Clears and repopulates the allow-list.
     *      - Does not set `initialized`; the caller does, immediately after this returns.
     *
     * @param cfg       Storage slot to write into.
     * @param incoming  Decoded wire terms to copy from.
     */
    function _store(Config storage cfg, UniversalTerms memory incoming) internal {
        cfg.validUntil = incoming.validUntil;
        cfg.expectedCEA = incoming.expectedCEA;
        cfg.maxGasPerCall = incoming.maxGasPerCall;
        delete cfg.assets;
        _storeAssets(cfg.assets, incoming.assets);

        // Re-initialisation is refused, so in production this array is always empty here. The
        // delete is kept for the stranger-slice path and for tests.
        delete cfg.allowedCalls;
        uint256 len = incoming.allowedCalls.length;
        for (uint256 i; i < len;) {
            cfg.allowedCalls.push(incoming.allowedCalls[i]);
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Wire asset caps into storage, element by element, every `spent` forced to zero. Shared by
    ///      both universal families. The caller deletes `dst` first, as for every other array.
    function _storeAssets(AssetCapState[] storage dst, AssetCap[] memory src) internal {
        uint256 len = src.length;
        for (uint256 i; i < len;) {
            dst.push(
                AssetCapState({
                    token: src[i].token, maxPerCall: src[i].maxPerCall, maxTotal: src[i].maxTotal, spent: 0
                })
            );
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Copies a decoded native config into storage. The native counterpart of `_store`.
     *
     *      - Forces `valueSpent`, `amountSpent` and `callsUsed` to zero, ignoring anything the
     *        caller supplied. A caller-set counter would be a granted head start on every cap.
     *      - `amount` is a value struct with no dynamic members, so it assigns wholesale.
     *      - `pins` must be copied ELEMENT BY ELEMENT: Solidity cannot assign a memory dynamic array
     *        into a storage struct field. Same shape as `allowedCalls` above, same reason.
     *      - Does not set `initialized`; the caller does, immediately after this returns.
     *
     * @param cfg       Storage slot to write into.
     * @param incoming  Decoded native wire terms to copy from.
     */
    function _storeNative(NativeConfig storage cfg, NativeTerms memory incoming) internal {
        cfg.validUntil = incoming.validUntil;
        cfg.target = incoming.target;
        cfg.selector = incoming.selector;
        cfg.maxValuePerCall = incoming.maxValuePerCall;
        cfg.maxValueTotal = incoming.maxValueTotal;
        cfg.valueSpent = 0;
        cfg.amount = incoming.amount;
        cfg.amountSpent = 0;
        cfg.maxCalls = incoming.maxCalls;
        cfg.callsUsed = 0;

        // Re-initialisation is refused, so in production this array is always empty here. The
        // delete is kept for the stranger-slice path and for tests.
        delete cfg.pins;
        uint256 len = incoming.pins.length;
        for (uint256 i; i < len;) {
            cfg.pins.push(incoming.pins[i]);
            unchecked {
                ++i;
            }
        }
    }

    /**
     * @dev Copies decoded SVM wire terms into storage. The SVM counterpart of `_store`.
     *      - Forces every asset's `spent` to zero; URP owns it.
     *      - Every dynamic member is copied ELEMENT BY ELEMENT, same shape and same reason as
     *        `allowedCalls` and `pins`.
     *      - Does not set `initialized`; the caller does, immediately after this returns.
     */
    function _storeSvm(SvmConfig storage cfg, SvmTerms memory incoming) internal {
        cfg.validUntil = incoming.validUntil;
        cfg.expectedCEA = incoming.expectedCEA;
        cfg.gatewayProgram = incoming.gatewayProgram;
        cfg.maxGasPerCall = incoming.maxGasPerCall;
        delete cfg.assets;
        _storeAssets(cfg.assets, incoming.assets);

        delete cfg.ceaAccounts;
        uint256 len = incoming.ceaAccounts.length;
        for (uint256 i; i < len;) {
            cfg.ceaAccounts.push(incoming.ceaAccounts[i]);
            unchecked {
                ++i;
            }
        }

        delete cfg.programs;
        len = incoming.programs.length;
        for (uint256 i; i < len;) {
            cfg.programs.push(incoming.programs[i]);
            unchecked {
                ++i;
            }
        }

        delete cfg.pins;
        len = incoming.pins.length;
        for (uint256 i; i < len;) {
            cfg.pins.push(incoming.pins[i]);
            unchecked {
                ++i;
            }
        }

        delete cfg.dataPins;
        len = incoming.dataPins.length;
        for (uint256 i; i < len;) {
            cfg.dataPins.push(incoming.dataPins[i]);
            unchecked {
                ++i;
            }
        }
    }
}
