// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC8183Hook} from "../../../src/agentic-commerce-8183/interfaces/IERC8183Hook.sol";

/// @notice Hook that calls back into the kernel with `payload` and bubbles the revert.
contract ReentrantHook is IERC8183Hook {
    bytes public payload;
    bool public inAfter;

    function setPayload(bytes calldata p) external {
        payload = p;
    }

    function setInAfter(bool v) external {
        inAfter = v;
    }

    function beforeAction(uint256, bytes4, bytes calldata) external {
        if (!inAfter) _reenter();
    }

    function afterAction(uint256, bytes4, bytes calldata) external {
        if (inAfter) _reenter();
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC8183Hook).interfaceId || id == type(IERC165).interfaceId;
    }

    function _reenter() internal {
        if (payload.length == 0) return;
        (bool ok, bytes memory ret) = msg.sender.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
