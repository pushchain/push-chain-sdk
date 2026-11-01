// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IActionPolicy } from "smartsessions/interfaces/IPolicy.sol";
import { ConfigId } from "smartsessions/DataTypes.sol";

import { RulesType, VmFamily, Config, ModeSlot, NativeConfig, SvmConfig } from "../libraries/Types.sol";

/**
 * @title  IUniversalRulesPolicy (IURP)
 * @notice The engine-facing functions (`initializeWithMultiplexer`, `checkAction`) and
 *         `supportsInterface` are INHERITED from upstream `IActionPolicy`, never repeated here.
 *         Duplicating a signature across a trust boundary is the drift this project removes.
 *
 * @dev    INHERITANCE SHAPE, verified by compiled probe. `IActionPolicy is IPolicy is IERC165`,
 *         so IERC165 already arrives transitively and listing it again as
 *         `is IActionPolicy, IERC165` fails with `Error (5005): Linearization of inheritance
 *         graph impossible` — C3 linearization requires the most-derived base first. Single
 *         inheritance is both correct and sufficient; do not "complete" it by adding IERC165.
 *
 * @dev    Errors live in `UniversalRulesPolicyErrors` (`libraries/Errors.sol`); the policy's types live
 *         in `libraries/Types.sol`.
 *
 * @dev    Revert data truncates to 32 bytes through the engine (`PolicyLib.sol:139-152`,
 *         `_maxCopy: 32`, surfacing as `PolicyCheckReverted(bytes32)`). The 4-byte selector
 *         survives; multi-argument custom errors do not round-trip to the caller. Errors below
 *         still carry their arguments because URP is also called directly (owner path,
 *         executor module) where they do survive.
 */
interface IUniversalRulesPolicy is IActionPolicy {
    // ═══════════════════════════════ URP_1: EVENTS ═══════════════════════════════

    /// @dev `mode`, `vm` and `chainHash` are all DERIVED from the envelope's chain string, not
    ///      declared. For a universal config `chainHash` has additionally been verified against EVERY
    ///      listed asset's own `SOURCE_CHAIN_NAMESPACE()`. `vm` was added with the SVM rulebook (1.1.0).
    event RulesConfigured(
        ConfigId indexed id,
        address indexed multiplexer,
        address indexed account,
        RulesType mode,
        VmFamily vm,
        bytes32 chainHash
    );
    /// @dev Emitted on every successful native check. Mirrors the effects: `value` and `amount` may
    ///      both be zero, and the event still fires, because `callsUsed` still moved.
    event NativeCallMetered(
        ConfigId indexed id, address indexed multiplexer, address indexed account, uint256 value, uint256 amount
    );
    /// @dev `token` is the PRC20 whose counter moved — one rules set meters each listed asset separately.
    event OutboundMetered(
        ConfigId indexed id, address indexed multiplexer, address indexed account, address token, uint256 amount
    );
    event RevertCredited(
        bytes32 indexed outboundTxId, ConfigId indexed id, address indexed account, address token, uint256 amountApplied
    );

    // ═══════════════════════════════ URP_2: POLICY ═══════════════════════════════

    /// @notice Exact-equality assertion on every per-asset spend counter — the change-flow race guard.
    /// @dev    `expectedSpent[i]` is the expected `spent` of `assets[i]`, in the order the rules set
    ///         listed them; the array must have exactly one entry per asset. Keyed on the SESSION_ENGINE
    ///         immutable; there is no multiplexer argument to get wrong.
    function assertSpent(ConfigId id, address account, uint256[] calldata expectedSpent) external view;

    /// @notice Credit a confirmed far-side failure back to one asset's spend counter.
    /// @dev    Executor-module-only, once per outboundTxId, saturating. `token` names the counter and
    ///         must be a listed asset. Ships inert — Push core's calling side is not yet landed.
    function creditRevert(ConfigId id, address account, bytes32 outboundTxId, address token, uint256 amount) external;

    /// @notice The native change-flow race guard: exact equality on all three counters.
    /// @dev    Reverts `WrongModeForCall(UNIVERSAL)` on a universal config and `NotInitialized` on a
    ///         ghost, for the same reason the universal overload does — this exists to catch stale
    ///         belief, so it must not have a silent-pass mode.
    function assertSpent(
        ConfigId id,
        address account,
        uint256 expectedValueSpent,
        uint256 expectedAmountSpent,
        uint32 expectedCalls
    ) external view;

    // ═══════════════════════════════ URP_3: VIEWS ═══════════════════════════════

    /// @notice The universal config. Reverts `WrongModeForCall(NATIVE)` on a native slot; returns a
    ///         zeroed struct on an EMPTY slot, exactly as it always has.
    function getConfig(ConfigId id, address account) external view returns (Config memory);

    /// @notice The native config. Reverts `WrongModeForCall(UNIVERSAL)` on a universal slot; returns
    ///         a zeroed struct on an empty slot.
    function getNativeConfig(ConfigId id, address account) external view returns (NativeConfig memory);

    /// @notice The SVM config. Reverts `WrongModeForCall(NATIVE)` on a native slot and
    ///         `WrongVmForCall(EVM)` on an EVM universal slot; returns a zeroed struct on an empty
    ///         slot, the same convention as the other two getters.
    function getSvmConfig(ConfigId id, address account) external view returns (SvmConfig memory);

    /// @notice The mode record. NEVER REVERTS — the documented first call for any integrator that
    ///         does not already know a rules set's mode. An empty slot returns
    ///         `(initialized: false, mode: UNIVERSAL, vm: EVM, chainHash: 0)`, where the mode and vm
    ///         values are meaningless. An initialised entry always carries its chain.
    function getMode(ConfigId id, address account) external view returns (ModeSlot memory);

    /// @notice The hash this URP derives NATIVE from: `keccak256("eip155:" ‖ decimal(block.chainid))`.
    /// @dev    Exposed so the deploy script asserts what URP will ACTUALLY derive rather than
    ///         recomputing the formula and agreeing with itself, and so an SDK can confirm the exact
    ///         native chain string it should emit. Computed, never stored.
    function pushChainHash() external view returns (bytes32);

    /// @notice Whether a Push-core outbound id has already been credited back.
    function isCredited(bytes32 outboundTxId) external view returns (bool);
}
