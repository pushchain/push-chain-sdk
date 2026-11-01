// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC8183Hook} from "../../../src/agentic-commerce-8183/interfaces/IERC8183Hook.sol";

/// @notice Hook that reverts `HookSaysNo` in the flagged phase.
contract RevertingHook is IERC8183Hook {
    error HookSaysNo();

    bool public revertBefore;
    bool public revertAfter;

    function setRevertBefore(bool v) external {
        revertBefore = v;
    }

    function setRevertAfter(bool v) external {
        revertAfter = v;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external view {
        if (revertBefore) revert HookSaysNo();
    }

    function afterAction(uint256, bytes4, bytes calldata) external view {
        if (revertAfter) revert HookSaysNo();
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC8183Hook).interfaceId || id == type(IERC165).interfaceId;
    }
}
