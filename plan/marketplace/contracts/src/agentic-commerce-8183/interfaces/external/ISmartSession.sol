// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ISmartSession
/// @notice Read-only mirror of the SmartSession engine used by Push AGWs.
/// @dev - Source: the SmartSession fork `7dc20e4` vendored by AGW v6 (`push-agentic-wallets` commit `ffd567d`).
///      - `PermissionId` is a user-defined `bytes32`; the ABI is plain `bytes32`.
///      - The id comes FIRST here, unlike the engine's other views.
///      - The v6 engine address is a deploy-time input, never a constant.
interface ISmartSession {
    /// @notice Whether a rules set is live on an account.
    /// @param permissionId The rules set's id (the AGW's `rulesId`; the engine names it `permissionId`).
    /// @param account The wallet.
    /// @return Whether the permission is enabled.
    function isPermissionEnabled(bytes32 permissionId, address account) external view returns (bool);
}
