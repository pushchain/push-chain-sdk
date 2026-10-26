// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {KernelBase} from "./KernelBase.t.sol";

/// @notice Stateless fuzz over every function that moves funds.
contract AgenticCommerceFuzzTest is KernelBase {
    function testFuzz_fund_movesExactBudget(uint256 budget) public {
        budget = bound(budget, 0, 2 ** 96);
        token.mint(client, budget);
        uint256 jobId = _budgeted(address(0), budget);
        uint256 before = token.balanceOf(client);
        vm.prank(client);
        kernel.fund(jobId, budget, "");
        assertEq(before - token.balanceOf(client), budget);
        assertEq(kernel.totalEscrowed(), budget);
        assertEq(token.balanceOf(address(kernel)), budget);
    }

    function testFuzz_complete_conservesBudget(uint256 budget, uint256 pBP, uint256 eBP) public {
        budget = bound(budget, 0, 2 ** 96);
        pBP = bound(pBP, 0, 10_000);
        eBP = bound(eBP, 0, 10_000 - pBP);
        token.mint(client, budget);
        vm.startPrank(admin);
        kernel.setPlatformFee(pBP, treasury);
        kernel.setEvaluatorFee(eBP);
        vm.stopPrank();

        uint256 escrowBefore = kernel.totalEscrowed();
        uint256 jobId = _submitted(address(0), budget);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");

        uint256 paid = token.balanceOf(treasury) + token.balanceOf(evaluator) + token.balanceOf(provider);
        assertEq(paid, budget);
        assertEq(token.balanceOf(treasury), budget * pBP / 10_000);
        assertEq(token.balanceOf(evaluator), budget * eBP / 10_000);
        assertEq(kernel.totalEscrowed(), escrowBefore);
    }

    function testFuzz_reject_refundsClient(uint256 budget, bool submitFirst) public {
        budget = bound(budget, 0, 2 ** 96);
        token.mint(client, budget);
        uint256 jobId = submitFirst ? _submitted(address(0), budget) : _funded(address(0), budget);
        uint256 before = token.balanceOf(client);
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32(0), "");
        assertEq(token.balanceOf(client) - before, budget);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function testFuzz_claimRefund_refundsClient(uint256 budget, bool submitFirst) public {
        budget = bound(budget, 0, 2 ** 96);
        token.mint(client, budget);
        uint256 jobId = submitFirst ? _submitted(address(0), budget) : _funded(address(0), budget);
        vm.warp(block.timestamp + EXPIRY_OFFSET + kernel.EVALUATOR_GRACE_PERIOD());
        uint256 before = token.balanceOf(client);
        kernel.claimRefund(jobId);
        assertEq(token.balanceOf(client) - before, budget);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function testFuzz_emergencyWithdraw_bound(uint256 escrowed, uint256 extra, uint256 amount) public {
        escrowed = bound(escrowed, 0, 2 ** 96);
        extra = bound(extra, 0, 2 ** 96);
        amount = bound(amount, 0, 2 ** 97);
        token.mint(client, escrowed);
        _funded(address(0), escrowed);
        token.mint(address(kernel), extra);
        _pause();

        vm.prank(admin);
        if (amount > extra) {
            vm.expectRevert(
                abi.encodeWithSelector(IAgenticCommerce.InsufficientUnattributedBalance.selector, amount, extra)
            );
            kernel.emergencyWithdraw(address(token), admin, amount);
        } else {
            kernel.emergencyWithdraw(address(token), admin, amount);
            assertEq(token.balanceOf(admin), amount);
            assertGe(token.balanceOf(address(kernel)), kernel.totalEscrowed());
        }
    }
}
