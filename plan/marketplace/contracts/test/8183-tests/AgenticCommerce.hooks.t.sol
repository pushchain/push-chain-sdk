// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {RecordingHook} from "./mocks/RecordingHook.sol";
import {RevertingHook} from "./mocks/RevertingHook.sol";
import {ReentrantHook} from "./mocks/ReentrantHook.sol";

/// @notice Kernel ↔ hook behaviour: call order, rollback, blocking, reentrancy.
contract AgenticCommerceHooksTest is KernelBase {
    RecordingHook internal rec;
    RevertingHook internal rh;
    ReentrantHook internal re;

    function setUp() public override {
        super.setUp();
        rec = new RecordingHook();
        rh = new RevertingHook();
        re = new ReentrantHook();
        vm.startPrank(admin);
        kernel.setHookWhitelist(address(rec), true);
        kernel.setHookWhitelist(address(rh), true);
        kernel.setHookWhitelist(address(re), true);
        vm.stopPrank();
    }

    // ───────────── order: before sees pre-state, after sees post-state ─────────────

    function test_callOrder_fullLifecycle() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(address(0), evaluator, _expiry(), "", address(rec));
        vm.prank(client);
        kernel.setProvider(jobId, provider, "");
        vm.prank(provider);
        kernel.setBudget(jobId, BUDGET, "");
        vm.prank(client);
        kernel.fund(jobId, BUDGET, "");
        vm.prank(provider);
        kernel.submit(jobId, bytes32(0), "");
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");

        bytes4[6] memory sels = [
            IAgenticCommerce.setProvider.selector,
            IAgenticCommerce.setBudget.selector,
            IAgenticCommerce.fund.selector,
            IAgenticCommerce.submit.selector,
            IAgenticCommerce.complete.selector,
            bytes4(0)
        ];
        uint8[6] memory preStatus = [0, 0, 0, 1, 2, 0];
        uint8[6] memory postStatus = [0, 0, 1, 2, 3, 0];
        assertEq(rec.count(), 10);
        for (uint256 i = 0; i < 5; i++) {
            RecordingHook.Call memory b = rec.getCall(2 * i);
            RecordingHook.Call memory a = rec.getCall(2 * i + 1);
            assertTrue(b.isBefore);
            assertFalse(a.isBefore);
            assertEq(b.selector, sels[i]);
            assertEq(a.selector, sels[i]);
            assertEq(b.jobId, jobId);
            assertEq(b.statusSeen, preStatus[i]);
            assertEq(a.statusSeen, postStatus[i]);
        }
    }

    function test_reject_hookEncodingAndOrder() public {
        uint256 jobId = _funded(address(rec), BUDGET);
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32("r"), hex"77");
        RecordingHook.Call memory b = rec.getCall(4);
        RecordingHook.Call memory a = rec.getCall(5);
        assertEq(b.selector, IAgenticCommerce.reject.selector);
        assertEq(b.data, abi.encode(evaluator, bytes32("r"), hex"77"));
        assertEq(b.statusSeen, uint8(IAgenticCommerce.JobStatus.Funded));
        assertEq(a.statusSeen, uint8(IAgenticCommerce.JobStatus.Rejected));
    }

    function test_complete_hookEncoding() public {
        uint256 jobId = _submitted(address(rec), BUDGET);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32("c"), hex"55");
        assertEq(rec.getCall(6).data, abi.encode(evaluator, bytes32("c"), hex"55"));
    }

    // ───────────── afterAction revert rolls the whole call back ─────────────

    function test_afterRevert_rollsBackFund() public {
        uint256 jobId = _budgeted(address(rh), BUDGET);
        rh.setRevertAfter(true);
        uint256 before = token.balanceOf(client);
        vm.prank(client);
        vm.expectRevert(RevertingHook.HookSaysNo.selector);
        kernel.fund(jobId, BUDGET, "");
        assertEq(token.balanceOf(client), before);
        assertEq(kernel.totalEscrowed(), 0);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Open));
    }

    function test_afterRevert_rollsBackComplete() public {
        uint256 jobId = _submitted(address(rh), BUDGET);
        rh.setRevertAfter(true);
        vm.prank(evaluator);
        vm.expectRevert(RevertingHook.HookSaysNo.selector);
        kernel.complete(jobId, bytes32(0), "");
        assertEq(token.balanceOf(provider), 0);
        assertEq(kernel.totalEscrowed(), BUDGET);
    }

    // ───────────── a reverting hook blocks every hooked action, not claimRefund ─────────────

    function test_revertingBefore_blocksEveryHookedAction() public {
        vm.prank(client);
        uint256 noProv = kernel.createJob(address(0), evaluator, _expiry(), "", address(rh));
        uint256 open = _budgeted(address(rh), BUDGET);
        uint256 funded = _funded(address(rh), BUDGET);
        uint256 submitted = _submitted(address(rh), BUDGET);
        rh.setRevertBefore(true);
        bytes4 err = RevertingHook.HookSaysNo.selector;

        vm.prank(client);
        vm.expectRevert(err);
        kernel.setProvider(noProv, provider, "");
        vm.prank(provider);
        vm.expectRevert(err);
        kernel.setBudget(open, 1, "");
        vm.prank(client);
        vm.expectRevert(err);
        kernel.fund(open, BUDGET, "");
        vm.prank(provider);
        vm.expectRevert(err);
        kernel.submit(funded, bytes32(0), "");
        vm.prank(evaluator);
        vm.expectRevert(err);
        kernel.complete(submitted, bytes32(0), "");
        vm.prank(evaluator);
        vm.expectRevert(err);
        kernel.reject(funded, bytes32(0), "");

        vm.warp(block.timestamp + EXPIRY_OFFSET);
        kernel.claimRefund(funded);
        assertEq(uint8(_status(funded)), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    // ───────────── reentrancy ─────────────

    function _reentryPayloads() internal view returns (bytes[] memory p) {
        p = new bytes[](8);
        p[0] = abi.encodeCall(IAgenticCommerce.createJob, (provider, evaluator, _expiry(), "", address(0)));
        p[1] = abi.encodeCall(IAgenticCommerce.setProvider, (1, provider, ""));
        p[2] = abi.encodeCall(IAgenticCommerce.setBudget, (1, 1, ""));
        p[3] = abi.encodeCall(IAgenticCommerce.fund, (1, 1, ""));
        p[4] = abi.encodeCall(IAgenticCommerce.submit, (1, bytes32(0), ""));
        p[5] = abi.encodeCall(IAgenticCommerce.complete, (1, bytes32(0), ""));
        p[6] = abi.encodeCall(IAgenticCommerce.reject, (1, bytes32(0), ""));
        p[7] = abi.encodeCall(IAgenticCommerce.claimRefund, (1));
    }

    function test_reentrancy_fromBefore_blockedForEveryLifecycleCall() public {
        bytes[] memory payloads = _reentryPayloads();
        for (uint256 i = 0; i < payloads.length; i++) {
            uint256 jobId = _create(address(re));
            re.setInAfter(false);
            re.setPayload(payloads[i]);
            vm.prank(provider);
            vm.expectRevert(ReentrancyGuardUpgradeable.ReentrancyGuardReentrantCall.selector);
            kernel.setBudget(jobId, 1, "");
            re.setPayload("");
        }
    }

    function test_reentrancy_fromAfter_blocked() public {
        bytes[] memory payloads = _reentryPayloads();
        for (uint256 i = 0; i < payloads.length; i++) {
            uint256 jobId = _create(address(re));
            re.setInAfter(true);
            re.setPayload(payloads[i]);
            vm.prank(provider);
            vm.expectRevert(ReentrancyGuardUpgradeable.ReentrancyGuardReentrantCall.selector);
            kernel.setBudget(jobId, 1, "");
            re.setPayload("");
        }
    }
}
