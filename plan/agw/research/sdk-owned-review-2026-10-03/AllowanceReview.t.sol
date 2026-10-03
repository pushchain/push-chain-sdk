// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Review-only: copy into test/review of push-agentic-wallets@e704d5b.
// Real wallet/engine/policy; authored ERC20 and gateway pull/burn fixtures.
// This proves the owner approval mechanism, not production gateway/node settlement.
import { E2ETest } from "../integration/8_e2e.t.sol";
import { MockPRC20 } from "../mocks/MockUniversalGateway.sol";
import { UniversalOutboundTxRequest } from "../../src/libraries/Types.sol";
import { ExecutionLib } from "../../src/libraries/ExecutionLib.sol";
import { AGWErrors } from "../../src/libraries/Errors.sol";
import { ISmartSession } from "smartsessions/ISmartSession.sol";
import { PermissionId } from "smartsessions/DataTypes.sol";

contract ReviewPullToken is MockPRC20 {
    error InsufficientAllowance();
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance();
        if (balanceOf[from] < amount) revert InsufficientBalance();
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function burn(uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        return true;
    }
}

contract ReviewPullGateway {
    // Mirrors the transferFrom -> burn sequence at gateway bcbf7df,
    // UniversalGatewayPC.sol:430-434. Other gateway behavior is not modeled.
    function sendUniversalTxOutbound(UniversalOutboundTxRequest calldata req) external payable {
        ReviewPullToken token = ReviewPullToken(req.token);
        require(token.transferFrom(msg.sender, address(this), req.amount));
        require(token.burn(req.amount));
    }
}

contract AllowanceReviewTest is E2ETest {
    function _setupAllowance() internal {
        pUSDC = new ReviewPullToken();
        vm.etch(GATEWAY, type(ReviewPullGateway).runtimeCode);
        _deployAndGrant();
    }

    function _approval(uint256 amount) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(address(pUSDC), 0,
            abi.encodeCall(MockPRC20.approve, (GATEWAY, amount)));
    }

    function _ownerApprove(uint256 amount) internal {
        bytes memory call = _approval(amount);
        bytes32 mode = _singleMode();
        vm.prank(BOB_UEA);
        bobAgw.execute(mode, call);
    }

    function test_Allowance_MissingApprovalRevertsAndRollsBackSpend() public {
        _setupAllowance();
        bytes memory call = _executionCalldata(10e6, 0);
        bytes32 mode = _singleMode();
        uint64 beforeCount = bobAgw.checkpointCount();
        vm.prank(agentAddr);
        vm.expectRevert(ReviewPullToken.InsufficientAllowance.selector);
        bobAgw.executeAsAgent(permissionId, mode, call);
        assertEq(_spent(permissionId), 0);
        assertEq(pUSDC.balanceOf(address(bobAgw)), HUNDRED_USDC);
        assertEq(bobAgw.checkpointCount(), beforeCount);
    }

    function test_Allowance_OwnerApprovalEnablesPullBurnAndCanBeRemoved() public {
        _setupAllowance();
        uint64 beforeCount = bobAgw.checkpointCount();
        _ownerApprove(20e6);
        assertEq(bobAgw.checkpointCount(), beforeCount + 1);
        assertEq(pUSDC.allowance(address(bobAgw), GATEWAY), 20e6);
        _submitRequest(_executionCalldata(10e6, 0));
        assertEq(pUSDC.balanceOf(address(bobAgw)), 90e6);
        assertEq(pUSDC.balanceOf(GATEWAY), 0, "pulled tokens burned");
        assertEq(pUSDC.allowance(address(bobAgw), GATEWAY), 10e6);
        assertEq(_spent(permissionId), 10e6);
        assertEq(bobAgw.checkpointCount(), beforeCount + 1, "agent spend adds no checkpoint");
        _ownerApprove(0);
        assertEq(pUSDC.allowance(address(bobAgw), GATEWAY), 0);
        bytes memory call = _executionCalldata(1e6, 0);
        bytes32 mode = _singleMode();
        vm.prank(agentAddr);
        vm.expectRevert(ReviewPullToken.InsufficientAllowance.selector);
        bobAgw.executeAsAgent(permissionId, mode, call);
        assertEq(_spent(permissionId), 10e6);
        assertEq(pUSDC.balanceOf(address(bobAgw)), 90e6);
    }

    function test_Allowance_AgentCannotUseOwnerDoor() public {
        _setupAllowance();
        bytes memory call = _approval(20e6);
        bytes32 mode = _singleMode();
        vm.prank(agentAddr);
        vm.expectRevert(AGWErrors.CallerIsNotOwner.selector);
        bobAgw.execute(mode, call);
        assertEq(pUSDC.allowance(address(bobAgw), GATEWAY), 0);
    }

    function test_Allowance_UniversalRuleCannotApproveThroughAgentDoor() public {
        _setupAllowance();
        bytes memory call = _approval(20e6);
        bytes32 mode = _singleMode();
        vm.prank(agentAddr);
        vm.expectRevert(abi.encodeWithSelector(ISmartSession.NoPoliciesSet.selector,
            PermissionId.wrap(permissionId)));
        bobAgw.executeAsAgent(permissionId, mode, call);
        assertEq(pUSDC.allowance(address(bobAgw), GATEWAY), 0);
        assertEq(_spent(permissionId), 0);
    }
}
