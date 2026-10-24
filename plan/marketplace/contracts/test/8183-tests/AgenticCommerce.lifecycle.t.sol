// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";

import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {RecordingHook} from "./mocks/RecordingHook.sol";
import {RevertingHook} from "./mocks/RevertingHook.sol";
import {ERC165Only} from "./mocks/ERC165Only.sol";

/// @notice Kernel lifecycle: every function, every revert in PRD order.
contract AgenticCommerceLifecycleTest is KernelBase {
    RecordingHook internal rec;

    function setUp() public override {
        super.setUp();
        rec = new RecordingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(rec), true);
    }

    // ═════════════════════════════ createJob ═════════════════════════════

    function test_createJob_happy_withProviderAndHook() public {
        uint256 exp = _expiry();
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobCreated(1, client, provider, evaluator, exp, address(rec));
        vm.prank(client);
        uint256 jobId = kernel.createJob(provider, evaluator, exp, "desc", address(rec));

        assertEq(jobId, 1);
        assertEq(kernel.jobCounter(), 1);
        IAgenticCommerce.Job memory j = kernel.getJob(jobId);
        assertEq(j.client, client);
        assertEq(j.provider, provider);
        assertEq(j.evaluator, evaluator);
        assertEq(j.hook, address(rec));
        assertEq(j.expiredAt, exp);
        assertEq(j.budget, 0);
        assertEq(j.description, "desc");
        assertEq(uint8(j.status), uint8(IAgenticCommerce.JobStatus.Open));
        assertEq(rec.count(), 0, "createJob is not hooked (K-10)");
    }

    function test_createJob_happy_noProvider_noHook_evaluatorIsClient() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(address(0), client, _expiry(), "", address(0));
        assertEq(kernel.getJob(jobId).provider, address(0));
        assertEq(kernel.getJob(jobId).evaluator, client);
    }

    function test_createJob_zeroEvaluator_reverts() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.createJob(provider, address(0), _expiry(), "", address(0));
    }

    /// @dev Two faults at once: the earlier check in PRD order must win (C-03).
    function test_createJob_precedence() public {
        vm.startPrank(client);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector); // zero evaluator AND short expiry
        kernel.createJob(provider, address(0), block.timestamp, "", address(0));
        vm.expectRevert(IAgenticCommerce.ExpiryTooShort.selector); // short expiry AND client == provider
        kernel.createJob(client, evaluator, block.timestamp, "", address(0));
        vm.expectRevert(IAgenticCommerce.ClientIsProvider.selector); // client == provider AND bad hook
        kernel.createJob(client, evaluator, _expiry(), "", makeAddr("nope"));
        vm.stopPrank();
    }

    function test_createJob_expiryBoundary() public {
        uint256 exact = block.timestamp + kernel.MIN_EXPIRY_WINDOW();
        vm.startPrank(client);
        vm.expectRevert(IAgenticCommerce.ExpiryTooShort.selector);
        kernel.createJob(provider, evaluator, exact, "", address(0));
        kernel.createJob(provider, evaluator, exact + 1, "", address(0));
        vm.stopPrank();
    }

    function test_createJob_expiryAboveUint48_reverts() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.ExpiryTooShort.selector);
        kernel.createJob(provider, evaluator, uint256(type(uint48).max) + 1, "", address(0));
    }

    function test_createJob_clientIsProvider_reverts() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.ClientIsProvider.selector);
        kernel.createJob(client, evaluator, _expiry(), "", address(0));
    }

    function test_createJob_evaluatorIsProvider_reverts() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.EvaluatorIsProvider.selector);
        kernel.createJob(provider, provider, _expiry(), "", address(0));
    }

    function test_createJob_hookNotWhitelisted_reverts() public {
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.HookNotWhitelisted.selector);
        kernel.createJob(provider, evaluator, _expiry(), "", makeAddr("nope"));
    }

    function test_createJob_invalidHook_eoa_reverts() public {
        address eoaHook = makeAddr("eoaHook");
        vm.prank(admin);
        kernel.setHookWhitelist(eoaHook, true);
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.InvalidHook.selector);
        kernel.createJob(provider, evaluator, _expiry(), "", eoaHook);
    }

    function test_createJob_invalidHook_erc165Only_reverts() public {
        ERC165Only h = new ERC165Only();
        vm.prank(admin);
        kernel.setHookWhitelist(address(h), true);
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.InvalidHook.selector);
        kernel.createJob(provider, evaluator, _expiry(), "", address(h));
    }

    function test_getJob_unknownIds_returnZeroStruct() public {
        _create(address(0));
        IAgenticCommerce.Job memory j0 = kernel.getJob(0);
        IAgenticCommerce.Job memory j2 = kernel.getJob(2);
        assertEq(j0.client, address(0));
        assertEq(j2.client, address(0));
        assertEq(j2.budget, 0);
    }

    // ═════════════════════════════ setProvider (K-04) ═════════════════════════════

    function test_setProvider_happy_hookedWithEncoding() public {
        uint256 jobId = _createNoProvider(address(rec));
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.ProviderSet(jobId, provider);
        vm.prank(client);
        kernel.setProvider(jobId, provider, hex"beef");

        assertEq(kernel.getJob(jobId).provider, provider);
        assertEq(rec.count(), 2);
        bytes memory expected = abi.encode(client, provider, hex"beef");
        RecordingHook.Call memory b = rec.getCall(0);
        RecordingHook.Call memory a = rec.getCall(1);
        assertTrue(b.isBefore);
        assertFalse(a.isBefore);
        assertEq(b.selector, IAgenticCommerce.setProvider.selector);
        assertEq(b.data, expected);
        assertEq(a.data, expected);
    }

    function test_setProvider_reverts_inOrder() public {
        uint256 jobId = _createNoProvider(address(0));

        vm.startPrank(client);
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.setProvider(0, provider, "");
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.setProvider(99, provider, "");
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.setProvider(jobId, provider, "");

        vm.startPrank(client);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.setProvider(jobId, address(0), "");
        vm.expectRevert(IAgenticCommerce.ClientIsProvider.selector);
        kernel.setProvider(jobId, client, "");
        vm.expectRevert(IAgenticCommerce.EvaluatorIsProvider.selector);
        kernel.setProvider(jobId, evaluator, "");
        kernel.setProvider(jobId, provider, "");
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector); // provider already set
        kernel.setProvider(jobId, makeAddr("p2"), "");
        vm.stopPrank();
    }

    function test_setProvider_notOpen_reverts() public {
        uint256 jobId = _createNoProvider(address(0));
        vm.prank(client);
        kernel.reject(jobId, bytes32(0), "");
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setProvider(jobId, provider, "");
    }

    function test_setProvider_expired_reverts() public {
        uint256 jobId = _createNoProvider(address(0));
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setProvider(jobId, provider, "");
    }

    function test_setProvider_revertingBeforeHook_blocks() public {
        RevertingHook rh = new RevertingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(rh), true);
        uint256 jobId = _createNoProvider(address(rh));
        rh.setRevertBefore(true);
        vm.prank(client);
        vm.expectRevert(RevertingHook.HookSaysNo.selector);
        kernel.setProvider(jobId, provider, "");
    }

    /// @dev Two faults at once: the earlier check in PRD order must win (C-03).
    function test_setProvider_precedence() public {
        uint256 expired = _createNoProvider(address(0));
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(stranger); // expired AND unauthorised
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setProvider(expired, provider, "");

        uint256 set = _create(address(0)); // provider already set
        vm.prank(client); // provider set AND zero address
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setProvider(set, address(0), "");
    }

    // ═════════════════════════════ setBudget ═════════════════════════════

    function test_setBudget_reQuotableWhileOpen_andEncoding() public {
        uint256 jobId = _create(address(rec));
        vm.startPrank(provider);
        kernel.setBudget(jobId, 5, hex"01");
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.BudgetSet(jobId, 7);
        kernel.setBudget(jobId, 7, hex"02");
        vm.stopPrank();
        assertEq(kernel.getJob(jobId).budget, 7);
        assertEq(rec.getCall(2).data, abi.encode(provider, uint256(7), hex"02"));
        assertEq(rec.getCall(2).selector, IAgenticCommerce.setBudget.selector);
    }

    function test_setBudget_reverts() public {
        uint256 jobId = _create(address(0));
        vm.startPrank(provider);
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.setBudget(0, 1, "");
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.setBudget(jobId, 1, "");

        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setBudget(jobId, 1, "");
    }

    function test_setBudget_afterFund_reverts() public {
        uint256 jobId = _funded(address(0), BUDGET);
        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.setBudget(jobId, 1, "");
    }

    // ═════════════════════════════ fund ═════════════════════════════

    function test_fund_happy() public {
        uint256 jobId = _budgeted(address(rec), BUDGET);
        uint256 before = token.balanceOf(client);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobFunded(jobId, client, BUDGET);
        vm.prank(client);
        kernel.fund(jobId, BUDGET, hex"abcd");

        assertEq(token.balanceOf(client), before - BUDGET);
        assertEq(token.balanceOf(address(kernel)), BUDGET);
        assertEq(kernel.totalEscrowed(), BUDGET);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Funded));

        RecordingHook.Call memory b = rec.getCall(2);
        assertEq(b.selector, IAgenticCommerce.fund.selector);
        assertEq(b.data, abi.encode(client, hex"abcd"));
        assertEq(b.statusSeen, uint8(IAgenticCommerce.JobStatus.Open), "before sees pre-state");
        assertEq(rec.getCall(3).statusSeen, uint8(IAgenticCommerce.JobStatus.Funded), "after sees post-state");
    }

    function test_fund_zeroBudget_noTransfer() public {
        uint256 jobId = _create(address(0));
        uint256 before = token.balanceOf(client);
        vm.prank(client);
        kernel.fund(jobId, 0, "");
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Funded));
        assertEq(token.balanceOf(client), before);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function test_fund_reverts_inOrder() public {
        uint256 noProv = _createNoProvider(address(0));
        uint256 jobId = _budgeted(address(0), BUDGET);

        vm.startPrank(client);
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.fund(0, BUDGET, "");
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.fund(jobId, BUDGET, "");

        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.ProviderNotSet.selector);
        kernel.fund(noProv, 0, "");

        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.BudgetMismatch.selector);
        kernel.fund(jobId, BUDGET - 1, "");

        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.fund(jobId, BUDGET, "");
    }

    /// @dev Two faults at once: the earlier check in PRD order must win (C-03).
    function test_fund_precedence() public {
        uint256 noProv = _createNoProvider(address(0));
        vm.prank(stranger); // unauthorised AND no provider
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.fund(noProv, 0, "");

        vm.prank(client); // no provider AND wrong budget
        vm.expectRevert(IAgenticCommerce.ProviderNotSet.selector);
        kernel.fund(noProv, 1, "");

        uint256 jobId = _budgeted(address(0), BUDGET);
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(client); // expired AND wrong budget
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.fund(jobId, BUDGET - 1, "");
    }

    function test_fund_frontRunReQuote_reverts() public {
        uint256 jobId = _budgeted(address(0), BUDGET);
        vm.prank(provider);
        kernel.setBudget(jobId, BUDGET * 100, "");
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.BudgetMismatch.selector);
        kernel.fund(jobId, BUDGET, "");
    }

    function test_fund_twice_reverts() public {
        uint256 jobId = _funded(address(0), BUDGET);
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.fund(jobId, BUDGET, "");
    }

    // ═════════════════════════════ submit (K-11) ═════════════════════════════

    function test_submit_happy() public {
        uint256 jobId = _funded(address(rec), BUDGET);
        bytes32 d = keccak256("d");
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobSubmitted(jobId, provider, d);
        vm.prank(provider);
        kernel.submit(jobId, d, hex"09");
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Submitted));
        assertEq(rec.getCall(4).data, abi.encode(provider, d, hex"09"));
    }

    function test_submit_openJob_reverts_evenZeroBudget() public {
        uint256 jobId = _create(address(0));
        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.submit(jobId, bytes32(0), "");
    }

    function test_submit_reverts() public {
        uint256 jobId = _funded(address(0), BUDGET);
        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.submit(0, bytes32(0), "");

        vm.prank(stranger);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.submit(jobId, bytes32(0), "");

        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.submit(jobId, bytes32(0), "");
    }

    // ═════════════════════════════ complete ═════════════════════════════

    function test_complete_feeSplit_rounding_andEventOrder() public {
        vm.startPrank(admin);
        kernel.setPlatformFee(500, treasury);
        kernel.setEvaluatorFee(250);
        vm.stopPrank();
        uint256 budget = 1_000_003;
        uint256 jobId = _submitted(address(0), budget);

        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.PlatformFeePaid(jobId, treasury, 50_000);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.EvaluatorFeePaid(jobId, evaluator, 25_000);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobCompleted(jobId, evaluator, bytes32("ok"));
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.PaymentReleased(jobId, provider, 925_003);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32("ok"), "");

        assertEq(token.balanceOf(treasury), 50_000);
        assertEq(token.balanceOf(evaluator), 25_000);
        assertEq(token.balanceOf(provider), 925_003);
        assertEq(kernel.totalEscrowed(), 0);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Completed));
    }

    function test_complete_zeroFees_providerGetsAll() public {
        uint256 jobId = _submitted(address(0), BUDGET);
        vm.recordLogs();
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");
        assertEq(token.balanceOf(provider), BUDGET);
        assertEq(token.balanceOf(treasury), 0);
        _assertNoLog(IAgenticCommerce.PlatformFeePaid.selector);
        _assertNoLog(IAgenticCommerce.EvaluatorFeePaid.selector);
    }

    function test_complete_fullFees_netZero_stillEmitsPaymentReleased() public {
        vm.prank(admin);
        kernel.setPlatformFee(10_000, treasury);
        uint256 jobId = _submitted(address(0), BUDGET);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.PaymentReleased(jobId, provider, 0);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");
        assertEq(token.balanceOf(treasury), BUDGET);
        assertEq(token.balanceOf(provider), 0);
    }

    function test_complete_zeroBudget() public {
        uint256 jobId = _submitted(address(0), 0);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.PaymentReleased(jobId, provider, 0);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");
    }

    function test_complete_allowedAfterExpiry() public {
        uint256 jobId = _submitted(address(0), BUDGET);
        vm.warp(block.timestamp + EXPIRY_OFFSET + 30 minutes);
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Completed));
    }

    function test_complete_reverts() public {
        uint256 funded = _funded(address(0), BUDGET);
        uint256 submitted = _submitted(address(0), BUDGET);

        vm.startPrank(evaluator);
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.complete(0, bytes32(0), "");
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.complete(funded, bytes32(0), "");
        vm.stopPrank();

        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.complete(submitted, bytes32(0), "");
    }

    // ═════════════════════════════ reject ═════════════════════════════

    function test_reject_open_byClient_and_byProvider() public {
        uint256 a = _create(address(0));
        uint256 b = _create(address(0));
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobRejected(a, client, bytes32("no"));
        vm.prank(client);
        kernel.reject(a, bytes32("no"), "");
        vm.prank(provider);
        kernel.reject(b, bytes32(0), "");
        assertEq(uint8(_status(a)), uint8(IAgenticCommerce.JobStatus.Rejected));
        assertEq(uint8(_status(b)), uint8(IAgenticCommerce.JobStatus.Rejected));
    }

    function test_reject_funded_byEvaluator_refunds() public {
        uint256 jobId = _funded(address(0), BUDGET);
        uint256 before = token.balanceOf(client);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.Refunded(jobId, client, BUDGET);
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32(0), "");
        assertEq(token.balanceOf(client), before + BUDGET);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function test_reject_submitted_byEvaluator_refunds() public {
        uint256 jobId = _submitted(address(0), BUDGET);
        uint256 before = token.balanceOf(client);
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32(0), "");
        assertEq(token.balanceOf(client), before + BUDGET);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function test_reject_fundedZeroBudget_noRefundEvent() public {
        uint256 jobId = _funded(address(0), 0);
        vm.recordLogs();
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32(0), "");
        _assertNoLog(IAgenticCommerce.Refunded.selector);
    }

    function test_reject_unauthorisedPerStatus() public {
        uint256 open = _create(address(0));
        uint256 funded = _funded(address(0), BUDGET);
        uint256 submitted = _submitted(address(0), BUDGET);

        vm.prank(evaluator);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.reject(open, bytes32(0), "");

        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.reject(funded, bytes32(0), "");

        vm.prank(provider);
        vm.expectRevert(IAgenticCommerce.Unauthorized.selector);
        kernel.reject(submitted, bytes32(0), "");
    }

    function test_reject_invalidAndTerminal_revert() public {
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.reject(0, bytes32(0), "");

        uint256 jobId = _create(address(0));
        vm.prank(client);
        kernel.reject(jobId, bytes32(0), "");
        vm.prank(client);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.reject(jobId, bytes32(0), "");
    }

    // ═════════════════════════════ claimRefund (K-05, K-06) ═════════════════════════════

    function test_claimRefund_funded_afterExpiry() public {
        uint256 jobId = _funded(address(0), BUDGET);
        uint256 before = token.balanceOf(client);
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.Refunded(jobId, client, BUDGET);
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.JobExpired(jobId);
        vm.prank(stranger);
        kernel.claimRefund(jobId);
        assertEq(token.balanceOf(client), before + BUDGET);
        assertEq(kernel.totalEscrowed(), 0);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    function test_claimRefund_funded_beforeExpiry_reverts() public {
        uint256 jobId = _funded(address(0), BUDGET);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.claimRefund(jobId);
    }

    function test_claimRefund_submitted_gracePeriod() public {
        uint256 jobId = _submitted(address(0), BUDGET);
        uint256 exp = kernel.getJob(jobId).expiredAt;
        vm.warp(exp + kernel.EVALUATOR_GRACE_PERIOD() - 1);
        vm.expectRevert(IAgenticCommerce.GracePeriodActive.selector);
        kernel.claimRefund(jobId);

        vm.warp(exp + kernel.EVALUATOR_GRACE_PERIOD());
        kernel.claimRefund(jobId);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Expired));
        assertEq(kernel.totalEscrowed(), 0);
    }

    function test_claimRefund_open_afterExpiry_noTransfer() public {
        uint256 jobId = _create(address(0));
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.recordLogs();
        kernel.claimRefund(jobId);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Expired));
        _assertNoLog(IAgenticCommerce.Refunded.selector);
    }

    function test_claimRefund_fundedZeroBudget_noTransfer() public {
        uint256 jobId = _funded(address(0), 0);
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        vm.recordLogs();
        kernel.claimRefund(jobId);
        _assertNoLog(IAgenticCommerce.Refunded.selector);
    }

    function test_claimRefund_worksWhilePaused() public {
        uint256 jobId = _funded(address(0), BUDGET);
        _pause();
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        kernel.claimRefund(jobId);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    function test_claimRefund_neverCallsHook_evenReverting() public {
        RevertingHook rh = new RevertingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(rh), true);
        uint256 jobId = _funded(address(rh), BUDGET);
        rh.setRevertBefore(true);
        rh.setRevertAfter(true);
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        kernel.claimRefund(jobId);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Expired));
    }

    function test_claimRefund_invalidAndTerminal_revert() public {
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.claimRefund(0);
        uint256 jobId = _create(address(0));
        vm.prank(client);
        kernel.reject(jobId, bytes32(0), "");
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.claimRefund(jobId);
    }

    function test_complete_vs_claimRefund_race_afterGrace() public {
        uint256 a = _submitted(address(0), BUDGET);
        vm.warp(kernel.getJob(a).expiredAt + kernel.EVALUATOR_GRACE_PERIOD());
        kernel.claimRefund(a);
        vm.prank(evaluator);
        vm.expectRevert(IAgenticCommerce.WrongStatus.selector);
        kernel.complete(a, bytes32(0), "");
    }

    // ───────────── helpers ─────────────

    function _assertNoLog(bytes32 topic0) internal {
        VmLogs memory l = _logs();
        for (uint256 i = 0; i < l.n; i++) {
            assertTrue(l.topics[i] != topic0, "unexpected event");
        }
    }

    struct VmLogs {
        uint256 n;
        bytes32[] topics;
    }

    function _logs() internal returns (VmLogs memory out) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        out.n = entries.length;
        out.topics = new bytes32[](entries.length);
        for (uint256 i = 0; i < entries.length; i++) {
            out.topics[i] = entries[i].topics.length > 0 ? entries[i].topics[0] : bytes32(0);
        }
    }
}

