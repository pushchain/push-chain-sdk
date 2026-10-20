// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerIntent} from "@push-agw/libraries/Types.sol";

/// @title IAGW — the SmartSession `Session` mirror and the Push Agentic Wallet (AGW) functions the marketplace needs.
/// @dev - Source: AGW v6, `push-agentic-wallets` commit `ffd567d` (submodule `lib/push-agentic-wallets`).
///      - The AGW's own types (`OwnerIntent`, `AllowedCall`, `UniversalTerms`, `AssetCap`, `ArgPin`, ...) are
///        IMPORTED from `@push-agw/libraries/Types.sol`, never copied: a struct change there fails this build.
///      - `Session` and its parts stay a MIRROR of the vendor SmartSession types
///        (`lib/smartsessions/contracts/DataTypes.sol` in the AGW repo, fork `7dc20e4`; field order verified
///        identical): the vendor tree pulls remappings and an EVM target this repo cannot compile. The fork test
///        (`UniversalMarketplace.fork.t.sol`) pins it — a wrong mirror changes `keccak256(abi.encode(session))`, and
///        the real wallet's `grantRulesWithSig` reverts `IntentSessionMismatch`.
///      - `Session.sessionValidator` is `ISessionValidator` upstream; a contract type is `address` in the ABI.
///      - `rulesId` is the AGW's name for the engine's `permissionId`; the two are the same value.
///      - Agent identity: the AGW's `AgentValidator` requires `sessionValidatorInitData == abi.encode(agent)`,
///        exactly 32 bytes, agent non-zero.
///      - `IAGW` below: signatures verified identical to v6 `src/interfaces/IAGW.sol`.

// ─────────────────────────────── SmartSession ───────────────────────────────

struct PolicyData {
    address policy;
    bytes initData;
}

struct ActionData {
    bytes4 actionTargetSelector;
    address actionTarget;
    PolicyData[] actionPolicies;
}

struct ERC7739Context {
    bytes32 appDomainSeparator;
    string[] contentNames;
}

struct ERC7739Data {
    ERC7739Context[] allowedERC7739Content;
    PolicyData[] erc1271Policies;
}

struct Session {
    address sessionValidator;
    bytes sessionValidatorInitData;
    bytes32 salt;
    PolicyData[] userOpPolicies;
    ERC7739Data erc7739Policies;
    ActionData[] actions;
    bool permitERC4337Paymaster;
}

// ─────────────────────────────── the wallet ───────────────────────────────

/// @title IAGW — the wallet functions the marketplace calls.
interface IAGW {
    /// @notice `grantRules`, authorised by the owner's signed OwnerIntent.
    function grantRulesWithSig(Session calldata session, OwnerIntent calldata intent, bytes calldata sig)
        external
        returns (bytes32 rulesId);

    /// @notice The owner door, authorised by the owner's signed OwnerIntent.
    function executeWithSig(
        bytes32 mode,
        bytes calldata executionCalldata,
        OwnerIntent calldata intent,
        bytes calldata sig
    ) external;

    /// @notice Next expected sequence number in a replay lane.
    function getNonce(uint192 nonceKey) external view returns (uint64);

    /// @notice The grant nonce the next grant will consume.
    function grantNonce() external view returns (uint64);
}
