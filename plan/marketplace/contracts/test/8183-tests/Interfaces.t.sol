// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC8183Hook} from "../../src/agentic-commerce-8183/interfaces/IERC8183Hook.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";

/// @notice Phase 1 — interface ids and the hooked selectors the hook base routes on.
contract InterfacesTest is Test {
    function test_hookInterfaceId_isXorOfBothSelectors() public pure {
        bytes4 expected = IERC8183Hook.beforeAction.selector ^ IERC8183Hook.afterAction.selector;
        assertEq(type(IERC8183Hook).interfaceId, expected);
        assertEq(type(IERC8183Hook).interfaceId, bytes4(0x7ff6bc9e));
    }

    function test_hookSelectors_matchStandard() public pure {
        assertEq(IERC8183Hook.beforeAction.selector, bytes4(keccak256("beforeAction(uint256,bytes4,bytes)")));
        assertEq(IERC8183Hook.afterAction.selector, bytes4(keccak256("afterAction(uint256,bytes4,bytes)")));
    }

    /// @dev Pins every hooked selector. K-04 moves setProvider to the 3-argument form.
    function test_hookedKernelSelectors() public pure {
        assertEq(IAgenticCommerce.setProvider.selector, bytes4(0xc9a84bb9));
        assertEq(IAgenticCommerce.setBudget.selector, bytes4(0xdd4ae9d4));
        assertEq(IAgenticCommerce.fund.selector, bytes4(0xd2e13f50));
        assertEq(IAgenticCommerce.submit.selector, bytes4(0x9e63798d));
        assertEq(IAgenticCommerce.complete.selector, bytes4(0xd75bbdf3));
        assertEq(IAgenticCommerce.reject.selector, bytes4(0x41dd26f5));
    }

    function test_createJob_keepsFiveArgumentShape() public pure {
        assertEq(
            IAgenticCommerce.createJob.selector, bytes4(keccak256("createJob(address,address,uint256,string,address)"))
        );
    }
}
