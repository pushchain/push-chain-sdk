// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Session } from "smartsessions/DataTypes.sol";

import { OwnerIntent, RulesType, CheckpointKind } from "../libraries/Types.sol";

/**
 * @title  IAGW — the Agentic Wallet's external surface.
 * @notice The wallet's complete external surface. `AGW is IAGW`, so the compiler rejects any function
 *         declared here that the contract does not implement with the identical signature — this file
 *         cannot drift from the contract. Errors live in `AGWErrors` (`libraries/Errors.sol`); types in
 *         `libraries/Types.sol`.
 *
 * @dev    `rulesId` is the engine's `permissionId`: `rulesId == permissionId` for every rules set this
 *         wallet grants. SmartSession's own vocabulary (`Session`, `PermissionId`) is kept at the engine
 *         boundary.
 *
 * @dev    The events are a CONSUMED WIRE FORMAT. Changing a name, a parameter type, or which parameters
 *         are indexed changes the topic hash and silently breaks every deployed indexer and monitoring
 *         rule reading the old one. Add events freely; alter an existing one only as a deliberate,
 *         announced break.
 */
interface IAGW {
    // ═══════════════════════════════ AGW_1: EVENTS ═══════════════════════════════

    /// @notice The one-shot factory initialisation completed; the wallet is live.
    event AccountInitialized(address indexed owner, address indexed engine);

    /// @notice The owner executed directly, with no policy consulted.
    /// @dev    The calldata is hashed rather than logged: an owner batch can be large, and the
    ///         hash is what an observer needs to tie the event to the transaction it came from.
    event OwnerExecuted(bytes32 indexed mode, bytes32 executionCalldataHash);

    /// @notice The owner executed through `executeWithSig`, authorised by a signed OwnerIntent.
    /// @dev    A separate event from `OwnerExecuted` so an indexer can tell a relayed owner action
    ///         from one the owner submitted directly. The lane position ties it to the intent.
    event OwnerExecutedWithSig(bytes32 indexed mode, bytes32 executionCalldataHash, uint192 nonceKey, uint64 nonceSeq);

    /// @notice A validator module was installed.
    event ModuleInstalled(uint256 moduleTypeId, address module);

    /// @notice A validator module was uninstalled.
    event ModuleUninstalled(uint256 moduleTypeId, address module);

    /// @notice A module's uninstall callback reverted or exhausted its gas stipend.
    /// @dev    THE MODULE WAS STILL REMOVED. This is the audit trail for a module that tried to
    ///         resist its own removal, not a failure of the uninstall.
    event UninstallCallbackFailed(address module);

    /// @notice A rules set was granted.
    /// @dev    `mode` and `chainHash` are DERIVED from the policy envelope's chain namespace, not
    ///         declared by anyone — nobody in this system states a rules set's kind. The hash is
    ///         INDEXED so an indexer can filter rules by chain without decoding; the string is carried
    ///         as data because the wallet already holds it in memory after the action-0 decode
    ///         (~200 gas) and it makes every explorer record human-readable.
    event RulesGranted(bytes32 indexed rulesId, RulesType mode, bytes32 indexed chainHash, string chainNamespace);

    /// @notice A rules set was revoked.
    event RulesRevoked(bytes32 indexed rulesId);

    /// @notice An agent request passed validation and was dispatched.
    /// @dev    Rules-level attribution on the Push side, without touching the gateway's own frozen
    ///         event. `agent` is the sender (always equal to the rules set's agent). `callsHash` is
    ///         `keccak256(executionCalldata)` — what ties this record to the exact call executed.
    ///         A deliberate wire-format break from the earlier `(rulesId, nonceKey, nonceSeq, opHash)`
    ///         shape; it ships with the new deployment.
    event RulesActionAuthorized(bytes32 indexed rulesId, address indexed agent, bytes32 callsHash);

    /// @notice The owner side of this wallet changed. The wallet's checkpoint counter is now `seq`.
    /// @dev    Emitted once per owner-door call (before the call runs), once per grant and once per
    ///         revoked id. Never emitted by the agent door. On-chain consumers compare
    ///         `checkpointCount()` against a snapshot; `kind` and `ref` are for indexers — `ref` is
    ///         `keccak256(abi.encode(target, value, callData))` for `OWNER_ACTION` and the `rulesId`
    ///         for `RULES_GRANTED` / `RULES_REVOKED`.
    event Checkpointed(uint64 indexed seq, CheckpointKind kind, bytes32 ref, uint64 blockNumber);

    /// @notice The owner renamed the wallet. Fired by `setLabel` only, with the label as passed.
    /// @dev    `""` means the label was reset to the default `AGW <index + 1>`. The label chosen at
    ///         deployment is carried by the factory's `WalletDeployed`, not by this event.
    event LabelSet(string label);

    // ═══════════════════════════════ AGW_2: OWNER DOOR ═══════════════════════════════

    /// @notice The owner door: executes a single call or a batch on the owner's behalf. No policy is
    ///         ever consulted. Owner only.
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable;

    /// @notice The owner door, authorised by a signed OwnerIntent instead of `msg.sender`. Relayable by
    ///         `intent.executor` only.
    function executeWithSig(
        bytes32 mode,
        bytes calldata executionCalldata,
        OwnerIntent calldata intent,
        bytes calldata sig
    ) external;

    /// @notice Sets the wallet's label; `""` resets it to the default `AGW <index + 1>`. Owner or the
    ///         wallet itself. At most `MAX_LABEL_BYTES` bytes. Cosmetic: writes no checkpoint.
    function setLabel(string calldata label) external;

    // ═══════════════════════════════ AGW_3: AGENT DOOR ═══════════════════════════════

    /// @notice The agent door. Callable only by the agent `rulesId` names — a Push address (an EOA, or
    ///         the UEA of an external key); every call is checked by the rules set's policy.
    function executeAsAgent(bytes32 rulesId, bytes32 mode, bytes calldata executionCalldata) external;

    /// @notice The agent a rules set names on this wallet, or zero if it names none (unknown or
    ///         revoked id, non-canonical session validator, malformed config).
    function agentOf(bytes32 rulesId) external view returns (address);

    // ═══════════════════════════════ AGW_4: RULES LIFECYCLE ═══════════════════════════════

    /// @notice Grants one rules set to an agent. Owner or the wallet itself.
    /// @return rulesId  The engine's `permissionId` for the new rules set.
    function grantRules(Session calldata session) external returns (bytes32 rulesId);

    /// @notice `grantRules`, authorised by the owner's signed OwnerIntent.
    /// @return rulesId  The engine's `permissionId` for the new rules set.
    function grantRulesWithSig(Session calldata session, OwnerIntent calldata intent, bytes calldata sig)
        external
        returns (bytes32 rulesId);

    /// @notice Revokes one rules set. Owner or the wallet itself.
    function revokeRules(bytes32 rulesId) external;

    /// @notice Revokes every rules set on this wallet. Owner or the wallet itself.
    function revokeAllRules() external;

    /// @notice Factory-only, once: stores the deploy-time label (if any) and installs the session
    ///         engine as the account's sole validator.
    function initializeAccount(string calldata label) external;

    /// @notice Installs a validator module. Owner only.
    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external;

    /// @notice Uninstalls a validator module. Owner only; removal always proceeds.
    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external;

    // ═══════════════════════════════ AGW_5: VIEWS ═══════════════════════════════

    /// @notice Whether `module` is installed under `moduleTypeId`.
    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool);

    /// @notice Whether this account supports an ERC-7579 module type. True only for validators.
    function supportsModule(uint256 moduleTypeId) external pure returns (bool);

    /// @notice Whether this account supports an ERC-7579 execution mode.
    function supportsExecutionMode(bytes32 mode) external pure returns (bool);

    /// @notice The wallet's owner, read from the clone's immutable args.
    function owner() external view returns (address);

    /// @notice The wallet's label: the owner's, or `AGW <index + 1>` if none is set (the index is the
    ///         factory's per-owner index, so an owner's wallets read `AGW 1`, `AGW 2`, …).
    function label() external view returns (string memory);

    /// @notice The factory that deployed this wallet.
    function factory() external view returns (address);

    /// @notice Next expected sequence number in an owner lane (`OWNER_LANE_FLAG` set), consumed by
    ///         `executeWithSig`.
    function getNonce(uint192 nonceKey) external view returns (uint64);

    /// @notice The salt the next grant will use.
    function grantNonce() external view returns (uint64);

    /// @notice Owner-side checkpoints so far. Any owner-door call, grant or revoke moves it; agent
    ///         actions never do.
    function checkpointCount() external view returns (uint64);

    /// @notice `block.number` of the latest checkpoint, or zero if none. Consumers compare counts, not
    ///         blocks: several checkpoints can share a block.
    function lastCheckpointBlock() external view returns (uint64);

    /// @notice The OwnerIntent EIP-712 domain separator for a signer on `signerChainId`. Identical to
    ///         the factory's: the factory is the verifying contract.
    function domainSeparator(uint256 signerChainId) external view returns (bytes32);

    /// @notice The ERC-7579 account id, in vendor.account.semver form.
    function accountId() external pure returns (string memory);

    /// @notice The permission engine this wallet installs as its default validator.
    function SESSION_ENGINE() external view returns (address);

    /// @notice The canonical action policy (URP) every rules set on this wallet must name.
    function RULES_POLICY() external view returns (address);

    /// @notice The canonical session validator every rules set on this wallet must name — the sender
    ///         validator that confirms the caller is the rules set's agent.
    function SESSION_VALIDATOR() external view returns (address);

    /// @notice The Push-side gateway this wallet's agents send through.
    function UNIVERSAL_GATEWAY_PC() external view returns (address);

    /// @notice ERC-165 support check: ERC-165 and the two token-receiver interfaces only.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool);

    /// @notice Always the ERC-1271 failure value: the wallet never signs as an ERC-1271 party.
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4);

    /// @notice Accepts ERC-721 transfers.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4);

    /// @notice Accepts ERC-1155 transfers.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4);

    /// @notice Accepts batched ERC-1155 transfers.
    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4);
}
