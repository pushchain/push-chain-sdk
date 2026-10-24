// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC8183Hook} from "../../../src/agentic-commerce-8183/interfaces/IERC8183Hook.sol";
import {IAgenticCommerce} from "../../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";

/// @notice Observer hook: records every callback and the job status the kernel shows at that moment.
contract RecordingHook is IERC8183Hook {
    struct Call {
        bool isBefore;
        uint256 jobId;
        bytes4 selector;
        bytes data;
        uint8 statusSeen;
    }

    Call[] public calls;

    function count() external view returns (uint256) {
        return calls.length;
    }

    function getCall(uint256 i) external view returns (Call memory) {
        return calls[i];
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        _record(true, jobId, selector, data);
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        _record(false, jobId, selector, data);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC8183Hook).interfaceId || id == type(IERC165).interfaceId;
    }

    function _record(bool isBefore, uint256 jobId, bytes4 selector, bytes calldata data) internal {
        uint8 status = uint8(IAgenticCommerce(msg.sender).getJob(jobId).status);
        calls.push(Call(isBefore, jobId, selector, data, status));
    }
}
