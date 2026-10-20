// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice Answers ERC-165 for IERC165 only — not a valid hook.
contract ERC165Only is IERC165 {
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IERC165).interfaceId;
    }
}
