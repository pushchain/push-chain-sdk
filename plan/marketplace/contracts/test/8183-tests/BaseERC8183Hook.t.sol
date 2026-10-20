// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC8183HookErrors} from "../../src/agentic-commerce-8183/libraries/Errors.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IERC8183Hook} from "../../src/agentic-commerce-8183/interfaces/IERC8183Hook.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {RoutingProbeHook} from "./mocks/RoutingProbeHook.sol";
import {BareHook} from "./mocks/BareHook.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";

/// @notice Phase 3 — every route decodes exactly what the real kernel encoded.
contract BaseERC8183HookTest is KernelBase {
    RoutingProbeHook internal probe;
    RoutingProbeHook internal probeImpl;
    address internal hookProxyAdminOwner = makeAddr("hookProxyAdminOwner");

    function setUp() public override {
        super.setUp();
        probeImpl = new RoutingProbeHook();
        probe = RoutingProbeHook(_deployProbe(address(kernel)));
        vm.prank(admin);
        kernel.setHookWhitelist(address(probe), true);
    }

    function _deployProbe(address kernel_) internal returns (address) {
        return address(
            new TransparentUpgradeableProxy(
                address(probeImpl), hookProxyAdminOwner, abi.encodeCall(RoutingProbeHook.initialize, (kernel_))
            )
        );
    }

    function _assertRec(
        uint256 i,
        string memory handler,
        uint256 jobId,
        address caller,
        address addrArg,
        uint256 uintArg,
        bytes32 b32Arg,
        bytes memory opt
    ) internal view {
        RoutingProbeHook.Rec memory r = probe.rec(i);
        assertEq(r.handler, handler);
        assertEq(r.jobId, jobId);
        assertEq(r.caller, caller);
        assertEq(r.addrArg, addrArg);
        assertEq(r.uintArg, uintArg);
        assertEq(r.b32Arg, b32Arg);
        assertEq(r.optParams, opt);
    }

    // ───────────── all 12 routes, driven through the real kernel ─────────────

    function test_routes_setProvider_setBudget_fund_submit_complete() public {
        vm.prank(client);
        uint256 jobId = kernel.createJob(address(0), evaluator, _expiry(), "", address(probe));
        assertEq(probe.count(), 0);

        vm.prank(client);
        kernel.setProvider(jobId, provider, hex"a1");
        vm.prank(provider);
        kernel.setBudget(jobId, 42, hex"a2");
        token.mint(client, 42);
        vm.prank(client);
        kernel.fund(jobId, 42, hex"a3");
        vm.prank(provider);
        kernel.submit(jobId, bytes32("deliv"), hex"a4");
        vm.prank(evaluator);
        kernel.complete(jobId, bytes32("ok"), hex"a5");

        assertEq(probe.count(), 10);
        _assertRec(0, "preSetProvider", jobId, client, provider, 0, 0, hex"a1");
        _assertRec(1, "postSetProvider", jobId, client, provider, 0, 0, hex"a1");
        _assertRec(2, "preSetBudget", jobId, provider, address(0), 42, 0, hex"a2");
        _assertRec(3, "postSetBudget", jobId, provider, address(0), 42, 0, hex"a2");
        _assertRec(4, "preFund", jobId, client, address(0), 0, 0, hex"a3");
        _assertRec(5, "postFund", jobId, client, address(0), 0, 0, hex"a3");
        _assertRec(6, "preSubmit", jobId, provider, address(0), 0, bytes32("deliv"), hex"a4");
        _assertRec(7, "postSubmit", jobId, provider, address(0), 0, bytes32("deliv"), hex"a4");
        _assertRec(8, "preComplete", jobId, evaluator, address(0), 0, bytes32("ok"), hex"a5");
        _assertRec(9, "postComplete", jobId, evaluator, address(0), 0, bytes32("ok"), hex"a5");
    }

    function test_routes_reject() public {
        uint256 jobId = _funded(address(probe), BUDGET);
        uint256 n = probe.count();
        vm.prank(evaluator);
        kernel.reject(jobId, bytes32("no"), hex"b1");
        _assertRec(n, "preReject", jobId, evaluator, address(0), 0, bytes32("no"), hex"b1");
        _assertRec(n + 1, "postReject", jobId, evaluator, address(0), 0, bytes32("no"), hex"b1");
    }

    // ───────────── caller authentication ─────────────

    function test_beforeAction_fromNonKernel_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ERC8183HookErrors.CallerIsNotKernel.selector, stranger));
        probe.beforeAction(1, bytes4(0), "");
    }

    function test_afterAction_fromNonKernel_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ERC8183HookErrors.CallerIsNotKernel.selector, stranger));
        probe.afterAction(1, bytes4(0), "");
    }

    /// @dev The kernel never sends an unknown selector, so this is the one test that pranks as the kernel.
    function test_unknownSelector_isNoop() public {
        vm.startPrank(address(kernel));
        probe.beforeAction(1, bytes4(0xdeadbeef), hex"00");
        probe.afterAction(1, bytes4(0xdeadbeef), hex"00");
        vm.stopPrank();
        assertEq(probe.count(), 0);
    }

    // ───────────── ERC-165 ─────────────

    function test_supportsInterface() public view {
        assertTrue(probe.supportsInterface(type(IERC8183Hook).interfaceId));
        assertTrue(probe.supportsInterface(type(IERC165).interfaceId));
        assertFalse(probe.supportsInterface(bytes4(0x12345678)));
    }

    // ───────────── initialisation ─────────────

    function test_kernel_isSetAndAtSlot0() public view {
        assertEq(probe.KERNEL(), address(kernel));
        assertEq(address(uint160(uint256(vm.load(address(probe), bytes32(uint256(0)))))), address(kernel));
    }

    function test_init_zeroKernel_reverts() public {
        vm.expectRevert(ERC8183HookErrors.ZeroAddress.selector);
        _deployProbe(address(0));
    }

    function test_init_twice_reverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        probe.initialize(address(kernel));
    }

    function test_init_onImplementation_reverts() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        probeImpl.initialize(address(kernel));
    }

    function test_baseInit_outsideInitializer_reverts() public {
        vm.expectRevert(Initializable.NotInitializing.selector);
        probe.initOutside(address(kernel));
    }

    // ───────────── default handlers are no-ops ─────────────

    /// @dev A hook that overrides nothing must let every hooked action through unchanged.
    function test_defaultHandlers_areNoops_fullLifecycleAndReject() public {
        BareHook bareImpl = new BareHook();
        address bare = address(
            new TransparentUpgradeableProxy(
                address(bareImpl), hookProxyAdminOwner, abi.encodeCall(BareHook.initialize, (address(kernel)))
            )
        );
        vm.prank(admin);
        kernel.setHookWhitelist(bare, true);

        vm.prank(client);
        uint256 a = kernel.createJob(address(0), evaluator, _expiry(), "", bare);
        vm.prank(client);
        kernel.setProvider(a, provider, "");
        vm.prank(provider);
        kernel.setBudget(a, BUDGET, "");
        vm.prank(client);
        kernel.fund(a, BUDGET, "");
        vm.prank(provider);
        kernel.submit(a, bytes32(0), "");
        vm.prank(evaluator);
        kernel.complete(a, bytes32(0), "");
        assertEq(uint8(kernel.getJob(a).status), uint8(IAgenticCommerce.JobStatus.Completed));

        uint256 b = _funded(bare, BUDGET);
        vm.prank(evaluator);
        kernel.reject(b, bytes32(0), "");
        assertEq(uint8(kernel.getJob(b).status), uint8(IAgenticCommerce.JobStatus.Rejected));
    }
}
