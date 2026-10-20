// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Answers `isPermissionEnabled` from a settable map.
contract MockSmartSession {
    mapping(bytes32 => mapping(address => bool)) internal enabled;

    function setPermission(bytes32 permissionId, address account, bool status) external {
        enabled[permissionId][account] = status;
    }

    function isPermissionEnabled(bytes32 permissionId, address account) external view returns (bool) {
        return enabled[permissionId][account];
    }
}
