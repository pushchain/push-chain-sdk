// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {AgenticCommerce} from "../../src/agentic-commerce-8183/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {MockERC20_6} from "./mocks/MockERC20_6.sol";
import {RecordingHook} from "./mocks/RecordingHook.sol";

/// @notice Kernel: initialisation, upgrade, storage layout, admin functions.
contract AgenticCommerceAdminTest is KernelBase {
    // ───────────── initialisation ─────────────

    function test_initialize_setsState() public view {
        assertEq(address(kernel.paymentToken()), address(token));
        assertEq(kernel.platformTreasury(), treasury);
        assertTrue(kernel.hasRole(kernel.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(kernel.hasRole(kernel.ADMIN_ROLE(), admin));
        assertTrue(kernel.whitelistedHooks(address(0)));
        assertEq(kernel.platformFeeBP(), 0);
        assertEq(kernel.evaluatorFeeBP(), 0);
        assertEq(kernel.jobCounter(), 0);
        assertEq(kernel.totalEscrowed(), 0);
    }

    function test_constants() public view {
        assertEq(kernel.ADMIN_ROLE(), keccak256("ADMIN_ROLE"));
        assertEq(kernel.EVALUATOR_GRACE_PERIOD(), 1 hours);
        assertEq(kernel.MIN_EXPIRY_WINDOW(), 5 minutes);
        assertEq(kernel.BPS_DENOMINATOR(), 10_000);
    }

    function test_initialize_revertsOnZeroToken() public {
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        _deployKernelProxy(address(kernelImpl), address(0), treasury, admin);
    }

    function test_initialize_revertsOnZeroTreasury() public {
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        _deployKernelProxy(address(kernelImpl), address(token), address(0), admin);
    }

    function test_initialize_revertsOnZeroAdmin() public {
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        _deployKernelProxy(address(kernelImpl), address(token), treasury, address(0));
    }

    function test_initialize_secondCallReverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        kernel.initialize(address(token), treasury, admin);
    }

    function test_initialize_onImplementationReverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        kernelImpl.initialize(address(token), treasury, admin);
    }

    // ───────────── upgrade ─────────────

    function test_upgrade_byProxyAdminOwner_preservesState() public {
        uint256 jobId = _funded(address(0), BUDGET);
        AgenticCommerce newImpl = new AgenticCommerce();
        ProxyAdmin pa = ProxyAdmin(_proxyAdmin(address(kernel)));
        assertEq(pa.owner(), kernelProxyAdminOwner);

        vm.prank(kernelProxyAdminOwner);
        pa.upgradeAndCall(ITransparentUpgradeableProxy(address(kernel)), address(newImpl), "");

        assertEq(
            address(uint160(uint256(vm.load(address(kernel), ERC1967Utils.IMPLEMENTATION_SLOT)))), address(newImpl)
        );
        assertEq(kernel.totalEscrowed(), BUDGET);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Funded));
        assertTrue(kernel.hasRole(kernel.ADMIN_ROLE(), admin));
        assertEq(kernel.jobCounter(), 1);
    }

    function test_upgrade_byStranger_reverts() public {
        ProxyAdmin pa = ProxyAdmin(_proxyAdmin(address(kernel)));
        address newImpl = address(new AgenticCommerce());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pa.upgradeAndCall(ITransparentUpgradeableProxy(address(kernel)), newImpl, "");
    }

    function test_upgrade_byAdminRoleHolder_reverts() public {
        ProxyAdmin pa = ProxyAdmin(_proxyAdmin(address(kernel)));
        address newImpl = address(new AgenticCommerce());
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, admin));
        pa.upgradeAndCall(ITransparentUpgradeableProxy(address(kernel)), newImpl, "");
    }

    // ───────────── storage layout (by slot, PRD §4.1.4) ─────────────

    function test_storageLayout_bySlot() public {
        vm.startPrank(admin);
        kernel.setPlatformFee(123, treasury);
        kernel.setEvaluatorFee(45);
        vm.stopPrank();
        uint256 jobId = _funded(address(0), BUDGET);

        assertEq(address(uint160(uint256(vm.load(address(kernel), bytes32(uint256(0)))))), address(token));
        assertEq(uint256(vm.load(address(kernel), bytes32(uint256(1)))), 123);
        assertEq(address(uint160(uint256(vm.load(address(kernel), bytes32(uint256(2)))))), treasury);
        assertEq(uint256(vm.load(address(kernel), bytes32(uint256(3)))), 45);
        assertEq(uint256(vm.load(address(kernel), bytes32(uint256(5)))), 1);
        assertEq(uint256(vm.load(address(kernel), bytes32(uint256(7)))), BUDGET);

        bytes32 jobSlot = keccak256(abi.encode(jobId, uint256(4)));
        uint256 expectedWord = uint256(uint160(client)) | (uint256(uint8(IAgenticCommerce.JobStatus.Funded)) << 160);
        assertEq(uint256(vm.load(address(kernel), jobSlot)), expectedWord);

        bytes32 hookSlot = keccak256(abi.encode(address(0), uint256(6)));
        assertEq(uint256(vm.load(address(kernel), hookSlot)), 1);

        for (uint256 i = 8; i <= 57; i++) {
            assertEq(vm.load(address(kernel), bytes32(i)), bytes32(0));
        }
    }

    // ───────────── access control ─────────────

    function test_admin_functions_revertForNonAdmin() public {
        bytes32 role = kernel.ADMIN_ROLE();
        bytes memory err =
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role);

        vm.startPrank(stranger);
        vm.expectRevert(err);
        kernel.pause();
        vm.expectRevert(err);
        kernel.unpause();
        vm.expectRevert(err);
        kernel.setPlatformFee(1, treasury);
        vm.expectRevert(err);
        kernel.setEvaluatorFee(1);
        vm.expectRevert(err);
        kernel.setHookWhitelist(address(1), true);
        vm.expectRevert(err);
        kernel.batchDetachHook(new uint256[](0));
        vm.expectRevert(err);
        kernel.emergencyWithdraw(address(token), stranger, 1);
        vm.stopPrank();
    }

    // ───────────── pause ─────────────

    function test_pause_blocksEveryLifecycleFunction() public {
        uint256 openJob = _create(address(0));
        uint256 noProv = _createNoProvider(address(0));
        uint256 funded = _funded(address(0), BUDGET);
        uint256 submitted = _submitted(address(0), BUDGET);
        _pause();

        bytes memory paused = abi.encodeWithSelector(PausableUpgradeable.EnforcedPause.selector);
        vm.prank(client);
        vm.expectRevert(paused);
        kernel.createJob(provider, evaluator, _expiry(), "x", address(0));
        vm.prank(client);
        vm.expectRevert(paused);
        kernel.setProvider(noProv, provider, "");
        vm.prank(provider);
        vm.expectRevert(paused);
        kernel.setBudget(openJob, 1, "");
        vm.prank(client);
        vm.expectRevert(paused);
        kernel.fund(openJob, 0, "");
        vm.prank(provider);
        vm.expectRevert(paused);
        kernel.submit(funded, bytes32(0), "");
        vm.prank(evaluator);
        vm.expectRevert(paused);
        kernel.complete(submitted, bytes32(0), "");
        vm.prank(evaluator);
        vm.expectRevert(paused);
        kernel.reject(funded, bytes32(0), "");
    }

    function test_unpause_restores() public {
        _pause();
        vm.prank(admin);
        kernel.unpause();
        uint256 jobId = _create(address(0));
        assertEq(jobId, 1);
    }

    function test_unpause_whenNotPaused_reverts() public {
        vm.prank(admin);
        vm.expectRevert(PausableUpgradeable.ExpectedPause.selector);
        kernel.unpause();
    }

    // ───────────── fees ─────────────

    function test_setPlatformFee() public {
        address t2 = makeAddr("t2");
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.PlatformFeeUpdated(500, t2);
        vm.prank(admin);
        kernel.setPlatformFee(500, t2);
        assertEq(kernel.platformFeeBP(), 500);
        assertEq(kernel.platformTreasury(), t2);
    }

    function test_setPlatformFee_zeroTreasury_reverts() public {
        vm.prank(admin);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.setPlatformFee(1, address(0));
    }

    function test_fees_exactly10000_allowed_10001_reverts() public {
        vm.startPrank(admin);
        kernel.setEvaluatorFee(4000);
        kernel.setPlatformFee(6000, treasury);
        vm.expectRevert(IAgenticCommerce.FeesTooHigh.selector);
        kernel.setPlatformFee(6001, treasury);
        vm.expectRevert(IAgenticCommerce.FeesTooHigh.selector);
        kernel.setEvaluatorFee(4001);
        vm.stopPrank();
    }

    function test_setEvaluatorFee_emits() public {
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.EvaluatorFeeUpdated(250);
        vm.prank(admin);
        kernel.setEvaluatorFee(250);
        assertEq(kernel.evaluatorFeeBP(), 250);
    }

    // ───────────── hook whitelist / detach ─────────────

    function test_setHookWhitelist() public {
        address h = makeAddr("h");
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.HookWhitelistUpdated(h, true);
        vm.prank(admin);
        kernel.setHookWhitelist(h, true);
        assertTrue(kernel.whitelistedHooks(h));
    }

    function test_setHookWhitelist_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.setHookWhitelist(address(0), true);
    }

    function test_batchDetachHook_detachesAndSkips() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), true);
        uint256 hooked = _create(address(hook));
        uint256 plain = _create(address(0));

        uint256[] memory ids = new uint256[](2);
        ids[0] = hooked;
        ids[1] = plain;
        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.HookDetached(hooked, address(hook));
        vm.prank(admin);
        kernel.batchDetachHook(ids);
        assertEq(kernel.getJob(hooked).hook, address(0));

        uint256 before = hook.count();
        vm.prank(provider);
        kernel.setBudget(hooked, 1, "");
        assertEq(hook.count(), before, "detached job must not call the hook");
    }

    function test_batchDetachHook_empty_isNoop() public {
        vm.prank(admin);
        kernel.batchDetachHook(new uint256[](0));
    }

    function test_batchDetachHook_invalidIds_revert() public {
        _create(address(0));
        uint256[] memory ids = new uint256[](1);
        vm.startPrank(admin);
        ids[0] = 0;
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.batchDetachHook(ids);
        ids[0] = 2;
        vm.expectRevert(IAgenticCommerce.InvalidJob.selector);
        kernel.batchDetachHook(ids);
        vm.stopPrank();
    }

    function test_dewhitelistedHook_stillCalledOnExistingJob() public {
        RecordingHook hook = new RecordingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), true);
        uint256 jobId = _create(address(hook));
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), false);

        vm.prank(provider);
        kernel.setBudget(jobId, 1, "");
        assertEq(hook.count(), 2);
    }

    // ───────────── emergencyWithdraw (K-02, D-27) ─────────────

    function test_emergencyWithdraw_notPaused_reverts() public {
        vm.prank(admin);
        vm.expectRevert(PausableUpgradeable.ExpectedPause.selector);
        kernel.emergencyWithdraw(address(token), admin, 1);
    }

    function test_emergencyWithdraw_zeroTo_reverts() public {
        _pause();
        vm.prank(admin);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.emergencyWithdraw(address(token), address(0), 1);
    }

    function test_emergencyWithdraw_zeroToken_reverts() public {
        _pause();
        vm.prank(admin);
        vm.expectRevert(IAgenticCommerce.ZeroAddress.selector);
        kernel.emergencyWithdraw(address(0), admin, 1);
    }

    function test_emergencyWithdraw_cannotTouchEscrow() public {
        _funded(address(0), BUDGET);
        _funded(address(0), BUDGET);
        token.mint(address(kernel), 7e6); // accidental transfer
        _pause();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IAgenticCommerce.InsufficientUnattributedBalance.selector, 7e6 + 1, 7e6));
        kernel.emergencyWithdraw(address(token), admin, 7e6 + 1);

        vm.expectEmit(address(kernel));
        emit IAgenticCommerce.EmergencyWithdraw(address(token), admin, 7e6);
        vm.prank(admin);
        kernel.emergencyWithdraw(address(token), admin, 7e6);
        assertEq(token.balanceOf(admin), 7e6);
        assertEq(token.balanceOf(address(kernel)), 2 * BUDGET);
    }

    function test_emergencyWithdraw_otherToken_fullyWithdrawable() public {
        MockERC20_6 other = new MockERC20_6("Other", "OTH");
        other.mint(address(kernel), 5e6);
        _funded(address(0), BUDGET);
        _pause();
        vm.prank(admin);
        kernel.emergencyWithdraw(address(other), admin, 5e6);
        assertEq(other.balanceOf(admin), 5e6);
    }

    function test_emergencyWithdraw_balanceBelowEscrow_availableIsZero() public {
        _funded(address(0), BUDGET);
        // Simulate a shortfall: move tokens out of the kernel behind its back.
        vm.prank(address(kernel));
        token.transfer(stranger, 1);
        _pause();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(IAgenticCommerce.InsufficientUnattributedBalance.selector, 1, 0));
        kernel.emergencyWithdraw(address(token), admin, 1);
    }
}
