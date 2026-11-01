// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IERC8183Hook
/// @notice ERC-8183 hook interface: callbacks around each hooked kernel action.
/// @dev - Same selectors as the EIP's `IACPHook` and the official `IERC8183Hook`, so the
///        ERC-165 id (`0x7ff6bc9e`) is compatible with both.
///      - `data` encoding per selector is fixed by the kernel (PRD §4.1.5).
interface IERC8183Hook is IERC165 {
    /// @notice Called before the kernel applies an action.
    /// @dev - May revert to block the action.
    /// @param jobId The job the action targets.
    /// @param selector The kernel function's selector.
    /// @param data ABI-encoded action arguments, caller first.
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;

    /// @notice Called after the kernel applied an action.
    /// @dev - A revert rolls back the whole kernel call.
    /// @param jobId The job the action targeted.
    /// @param selector The kernel function's selector.
    /// @param data ABI-encoded action arguments, caller first.
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}
