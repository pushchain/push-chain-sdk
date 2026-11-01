// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {RulesBindingHookErrors, ERC8183HookErrors} from "../../src/agentic-commerce-8183/libraries/Errors.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {RulesBindingHook} from "../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {MockAGWFactory} from "./mocks/MockAGWFactory.sol";
import {MockSmartSession} from "./mocks/MockSmartSession.sol";
import {RecordingHook} from "./mocks/RecordingHook.sol";

/// @notice Phase 5 — mandate binding and one live job per AGW, driven through the real kernel.
contract RulesBindingHookTest is KernelBase {
    RulesBindingHook internal hook;
    RulesBindingHook internal hookImpl;
    MockAGWFactory internal factory;
    MockSmartSession internal engine;
    address internal hookProxyAdminOwner = makeAddr("hookProxyAdminOwner");

    /// @dev `client` from KernelBase acts as the AGW.
    address internal agw;
    bytes32 internal constant P = keccak256("mandate-1");
    bytes32 internal constant P2 = keccak256("mandate-2");

    function setUp() public override {
        super.setUp();
        agw = client;
        factory = new MockAGWFactory();
        engine = new MockSmartSession();
        hookImpl = new RulesBindingHook();
        hook = RulesBindingHook(_deployHook(address(kernel), address(factory), address(engine)));
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), true);

        factory.setWallet(agw, true);
        engine.setPermission(P, agw, true);
    }

    function _deployHook(address k, address f, address e) internal returns (address) {
        return address(
            new TransparentUpgradeableProxy(
                address(hookImpl), hookProxyAdminOwner, abi.encodeCall(RulesBindingHook.initialize, (k, f, e))
            )
        );
    }

    /// @dev Job by `cl`, budgeted, ready to fund.
    function _open(address cl, uint256 amount) internal returns (uint256 jobId) {
        vm.prank(cl);
        jobId = kernel.createJob(provider, evaluator, _expiry(), "", address(hook));
        vm.prank(provider);
        kernel.setBudget(jobId, amount, "");
    }

    function _bind(address cl, bytes32 pid, uint256 amount) internal returns (uint256 jobId) {
        jobId = _open(cl, amount);
        vm.prank(cl);
        kernel.fund(jobId, amount, abi.encode(pid));
    }

    function _assertStillOpenAndUnbound(uint256 jobId, uint256 clientBalBefore) internal view {
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Open));
        assertEq(token.balanceOf(agw), clientBalBefore);
        address a = hook.agwOfJob(jobId);
        assertEq(a, address(0));
    }

    // ═════════════════════════ happy path ═════════════════════════

    function test_fund_bindsRules() public {
        uint256 jobId = _open(agw, BUDGET);
        vm.expectEmit(address(hook));
        emit RulesBindingHook.RulesBound(jobId, agw, P);
        vm.prank(agw);
        kernel.fund(jobId, BUDGET, abi.encode(P));

        (address a, bytes32 pid) = (hook.agwOfJob(jobId), hook.rulesOfJob(jobId));
        assertEq(a, agw);
        assertEq(pid, P);
        assertEq(hook.activeJobOf(agw), jobId);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Funded));
    }

    function test_zeroBudgetJob_bindsNormally() public {
        uint256 jobId = _bind(agw, P, 0);
        assertEq(hook.activeJobOf(agw), jobId);
    }

    // ═════════════════════════ check 1 · optParams length ═════════════════════════

    function test_invalidOptParams_lengths() public {
        uint256[4] memory lens = [uint256(0), 31, 33, 64];
        for (uint256 i = 0; i < lens.length; i++) {
            uint256 jobId = _open(agw, BUDGET);
            uint256 bal = token.balanceOf(agw);
            vm.prank(agw);
            vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.InvalidOptParams.selector, lens[i]));
            kernel.fund(jobId, BUDGET, new bytes(lens[i]));
            _assertStillOpenAndUnbound(jobId, bal);
        }
    }

    // ═════════════════════════ check 2 · client is an AGW ═════════════════════════

    function test_notAnAGW_eoaClient() public {
        address eoa = makeAddr("eoaClient");
        engine.setPermission(P, eoa, true);
        uint256 jobId = _open(eoa, BUDGET);
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.CallerIsNotAGW.selector, eoa));
        kernel.fund(jobId, BUDGET, abi.encode(P));
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Open));
    }

    function test_notAnAGW_contractClient() public {
        address c = address(new MockSmartSession());
        uint256 jobId = _open(c, BUDGET);
        uint256 bal = token.balanceOf(c);
        vm.prank(c);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.CallerIsNotAGW.selector, c));
        kernel.fund(jobId, BUDGET, abi.encode(P));
        assertEq(token.balanceOf(c), bal);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Open));
        address a = hook.agwOfJob(jobId);
        assertEq(a, address(0));
    }

    // ═════════════════════════ check 3 · mandate live ═════════════════════════

    function test_rulesNotLive_neverGranted() public {
        uint256 jobId = _open(agw, BUDGET);
        uint256 bal = token.balanceOf(agw);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.RulesNotLive.selector, agw, P2));
        kernel.fund(jobId, BUDGET, abi.encode(P2));
        _assertStillOpenAndUnbound(jobId, bal);
    }

    function test_rulesNotLive_revoked() public {
        engine.setPermission(P, agw, false);
        uint256 jobId = _open(agw, BUDGET);
        uint256 bal = token.balanceOf(agw);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.RulesNotLive.selector, agw, P));
        kernel.fund(jobId, BUDGET, abi.encode(P));
        _assertStillOpenAndUnbound(jobId, bal);
    }

    function test_rulesOfAnotherWallet_notLiveHere() public {
        address other = makeAddr("otherAGW");
        factory.setWallet(other, true);
        engine.setPermission(P2, other, true); // P2 live on `other`, not on `agw`
        uint256 jobId = _open(agw, BUDGET);
        uint256 bal = token.balanceOf(agw);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.RulesNotLive.selector, agw, P2));
        kernel.fund(jobId, BUDGET, abi.encode(P2));
        _assertStillOpenAndUnbound(jobId, bal);
    }

    // ═════════════════════════ check 4 · one live job per AGW ═════════════════════════

    function test_secondJob_whileFirstFunded_reverts() public {
        uint256 first = _bind(agw, P, BUDGET);
        uint256 second = _open(agw, BUDGET);
        uint256 bal = token.balanceOf(agw);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.AGWHasLiveJob.selector, agw, first));
        kernel.fund(second, BUDGET, abi.encode(P));
        _assertStillOpenAndUnbound(second, bal);
    }

    function test_secondJob_whileFirstSubmitted_reverts() public {
        uint256 first = _bind(agw, P, BUDGET);
        vm.prank(provider);
        kernel.submit(first, bytes32(0), "");
        assertEq(hook.activeJobOf(agw), first);
        uint256 second = _open(agw, BUDGET);
        uint256 bal = token.balanceOf(agw);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.AGWHasLiveJob.selector, agw, first));
        kernel.fund(second, BUDGET, abi.encode(P));
        _assertStillOpenAndUnbound(second, bal);
    }

    // ═════════════════════════ freeing the AGW — every path ═════════════════════════

    function _assertSecondJobFunds() internal {
        assertEq(hook.activeJobOf(agw), 0);
        uint256 second = _bind(agw, P, BUDGET);
        assertEq(hook.activeJobOf(agw), second);
    }

    function test_freed_afterComplete() public {
        uint256 first = _bind(agw, P, BUDGET);
        vm.prank(provider);
        kernel.submit(first, bytes32(0), "");
        vm.prank(evaluator);
        kernel.complete(first, bytes32(0), "");
        _assertSecondJobFunds();
    }

    function test_freed_afterReject() public {
        uint256 first = _bind(agw, P, BUDGET);
        vm.prank(evaluator);
        kernel.reject(first, bytes32(0), "");
        _assertSecondJobFunds();
    }

    function test_freed_afterClaimRefund_unhooked() public {
        uint256 first = _bind(agw, P, BUDGET);
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        kernel.claimRefund(first);
        _assertSecondJobFunds();
    }

    function test_freed_afterDetachThenRefund() public {
        uint256 first = _bind(agw, P, BUDGET);
        uint256[] memory ids = new uint256[](1);
        ids[0] = first;
        vm.prank(admin);
        kernel.batchDetachHook(ids);
        assertTrue(hook.activeJobOf(agw) != 0, "detach alone does not end the job");
        vm.warp(block.timestamp + EXPIRY_OFFSET);
        kernel.claimRefund(first);
        _assertSecondJobFunds();
    }

    // ═════════════════════════ isolation ═════════════════════════

    function test_twoAGWs_eachHoldALiveJob() public {
        address agw2 = makeAddr("agw2");
        factory.setWallet(agw2, true);
        engine.setPermission(P2, agw2, true);
        token.mint(agw2, 1e12);
        vm.prank(agw2);
        token.approve(address(kernel), type(uint256).max);

        uint256 a = _bind(agw, P, BUDGET);
        uint256 b = _bind(agw2, P2, BUDGET);
        assertEq(hook.activeJobOf(agw), a);
        assertEq(hook.activeJobOf(agw2), b);
    }

    function test_samePermissionId_differentAGWs_bindIndependently() public {
        address agw2 = makeAddr("agw2");
        factory.setWallet(agw2, true);
        engine.setPermission(P, agw2, true); // same id, different wallet
        token.mint(agw2, 1e12);
        vm.prank(agw2);
        token.approve(address(kernel), type(uint256).max);

        uint256 a = _bind(agw, P, BUDGET);
        uint256 b = _bind(agw2, P, BUDGET);
        (address wa, bytes32 pa) = (hook.agwOfJob(a), hook.rulesOfJob(a));
        (address wb, bytes32 pb) = (hook.agwOfJob(b), hook.rulesOfJob(b));
        assertEq(wa, agw);
        assertEq(wb, agw2);
        assertEq(pa, P);
        assertEq(pb, P);
    }

    function test_sameRules_sequentialJobs_allowed() public {
        uint256 first = _bind(agw, P, BUDGET);
        vm.prank(evaluator);
        kernel.reject(first, bytes32(0), "");
        uint256 second = _bind(agw, P, BUDGET);
        bytes32 pid = hook.rulesOfJob(second);
        assertEq(pid, P);
    }

    // ═════════════════════════ caller auth ═════════════════════════

    function test_beforeAction_directCall_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ERC8183HookErrors.CallerIsNotKernel.selector, stranger));
        hook.beforeAction(1, IAgenticCommerce.fund.selector, abi.encode(agw, abi.encode(P)));
    }

    function test_afterAction_directCall_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ERC8183HookErrors.CallerIsNotKernel.selector, stranger));
        hook.afterAction(1, IAgenticCommerce.fund.selector, "");
    }

    // ═════════════════════════ no desync ═════════════════════════

    /// @dev `_preFund` runs, then the kernel's transfer fails — the binding must roll back with it.
    ///      Asserted on state: a reverted call has no on-chain logs (Foundry's recorder keeps them anyway).
    function test_transferFailsAfterHook_rollsBackBinding() public {
        address agw3 = makeAddr("agw3-noAllowance");
        factory.setWallet(agw3, true);
        engine.setPermission(P, agw3, true);
        token.mint(agw3, 1e12); // funds but no approval
        uint256 jobId = _open(agw3, BUDGET);

        vm.prank(agw3);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(kernel), 0, BUDGET)
        );
        kernel.fund(jobId, BUDGET, abi.encode(P));

        address a = hook.agwOfJob(jobId);
        assertEq(a, address(0));
        assertEq(hook.activeJobOf(agw3), 0);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Open));
    }

    // ═════════════════════════ initialisation ═════════════════════════

    function test_initialize_setsState() public view {
        assertEq(hook.KERNEL(), address(kernel));
        assertEq(hook.AGW_FACTORY(), address(factory));
        assertEq(hook.SESSION_ENGINE(), address(engine));
    }

    function test_initialize_zeroKernel_reverts() public {
        vm.expectRevert(ERC8183HookErrors.ZeroAddress.selector);
        _deployHook(address(0), address(factory), address(engine));
    }

    function test_initialize_zeroFactory_reverts() public {
        vm.expectRevert(ERC8183HookErrors.ZeroAddress.selector);
        _deployHook(address(kernel), address(0), address(engine));
    }

    function test_initialize_zeroEngine_reverts() public {
        vm.expectRevert(ERC8183HookErrors.ZeroAddress.selector);
        _deployHook(address(kernel), address(factory), address(0));
    }

    function test_initialize_twice_reverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        hook.initialize(address(kernel), address(factory), address(engine));
    }

    // ═════════════════════════ views ═════════════════════════

    function test_activeJobOf_neverSeen_zero() public {
        assertEq(hook.activeJobOf(makeAddr("never")), 0);
    }

    function test_activeJobOf_returnsId() public {
        assertEq(hook.activeJobOf(agw), 0, "before fund");
        uint256 jobId = _bind(agw, P, BUDGET);
        assertEq(hook.activeJobOf(agw), jobId, "Funded");
        vm.prank(provider);
        kernel.submit(jobId, bytes32(0), "");
        assertEq(hook.activeJobOf(agw), jobId, "Submitted");
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32(0), "");
        assertEq(hook.activeJobOf(agw), 0, "after complete");
        assertEq(hook.rulesOfJob(jobId), P, "the binding outlives the job");
        assertEq(hook.agwOfJob(jobId), agw);
    }

    // ═════════════════════════ scope of the rule (D-25) ═════════════════════════

    function test_scope_hooklessJob_fundsWhileBusy() public {
        _bind(agw, P, BUDGET);
        assertTrue(hook.activeJobOf(agw) != 0);
        uint256 plain = _budgeted(address(0), BUDGET); // `client` == agw
        vm.prank(agw);
        kernel.fund(plain, BUDGET, "");
        assertEq(uint8(_status(plain)), uint8(IAgenticCommerce.JobStatus.Funded));
    }

    function test_scope_otherHookJob_doesNotTouchThisHook() public {
        RecordingHook other = new RecordingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(other), true);
        uint256 jobId = _budgeted(address(other), BUDGET);
        vm.prank(agw);
        kernel.fund(jobId, BUDGET, abi.encode(P));
        assertEq(hook.activeJobOf(agw), 0);
        address a = hook.agwOfJob(jobId);
        assertEq(a, address(0));
    }

    // ═════════════════════════ upgrade + layout ═════════════════════════

    function test_upgrade_preservesBindingAndBlock() public {
        uint256 first = _bind(agw, P, BUDGET);
        ProxyAdmin pa = ProxyAdmin(_proxyAdmin(address(hook)));
        assertEq(pa.owner(), hookProxyAdminOwner);
        address newImpl = address(new RulesBindingHook());
        vm.prank(hookProxyAdminOwner);
        pa.upgradeAndCall(ITransparentUpgradeableProxy(address(hook)), newImpl, "");

        (address a, bytes32 pid) = (hook.agwOfJob(first), hook.rulesOfJob(first));
        assertEq(a, agw);
        assertEq(pid, P);
        assertEq(hook.activeJobOf(agw), first);

        uint256 second = _open(agw, BUDGET);
        vm.prank(agw);
        vm.expectRevert(abi.encodeWithSelector(RulesBindingHookErrors.AGWHasLiveJob.selector, agw, first));
        kernel.fund(second, BUDGET, abi.encode(P));
    }

    function test_upgrade_byNonOwner_reverts() public {
        ProxyAdmin pa = ProxyAdmin(_proxyAdmin(address(hook)));
        address impl = address(new RulesBindingHook());
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pa.upgradeAndCall(ITransparentUpgradeableProxy(address(hook)), impl, "");
    }

    function test_storageLayout_bySlot() public {
        uint256 jobId = _bind(agw, P, BUDGET);
        address h = address(hook);
        assertEq(address(uint160(uint256(vm.load(h, bytes32(uint256(0)))))), address(kernel));
        for (uint256 i = 1; i <= 49; i++) {
            assertEq(vm.load(h, bytes32(i)), bytes32(0), "base gap");
        }
        assertEq(address(uint160(uint256(vm.load(h, bytes32(uint256(50)))))), address(factory));
        assertEq(address(uint160(uint256(vm.load(h, bytes32(uint256(51)))))), address(engine));

        bytes32 b = keccak256(abi.encode(jobId, uint256(52)));
        assertEq(address(uint160(uint256(vm.load(h, b)))), agw);
        assertEq(vm.load(h, bytes32(uint256(b) + 1)), P);

        // slots 52 / 53 unchanged: `_bindingOf` (was `rulesOf`), `_liveJobOf` (was `liveJobOf`)
        bytes32 l = keccak256(abi.encode(agw, uint256(53)));
        assertEq(uint256(vm.load(h, l)), jobId);

        for (uint256 i = 54; i <= 103; i++) {
            assertEq(vm.load(h, bytes32(i)), bytes32(0), "hook gap");
        }
    }
}
