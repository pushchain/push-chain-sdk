// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

import {AgenticCommerce} from "../../src/agentic-commerce-8183/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {MockERC20_6} from "./mocks/MockERC20_6.sol";

/// @notice Shared kernel fixture: token, kernel behind a Transparent proxy, actors, job helpers.
abstract contract KernelBase is Test {
    AgenticCommerce internal kernel;
    AgenticCommerce internal kernelImpl;
    MockERC20_6 internal token;

    address internal kernelProxyAdminOwner = makeAddr("kernelProxyAdminOwner");
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal client = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal evaluator = makeAddr("evaluator");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant BUDGET = 100e6;
    uint256 internal constant EXPIRY_OFFSET = 1 days;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        token = new MockERC20_6("Push USDC", "pUSDC");
        kernelImpl = new AgenticCommerce();
        kernel = AgenticCommerce(_deployKernelProxy(address(kernelImpl), address(token), treasury, admin));

        token.mint(client, 1e15);
        vm.prank(client);
        token.approve(address(kernel), type(uint256).max);
    }

    function _deployKernelProxy(address impl, address token_, address treasury_, address admin_)
        internal
        returns (address)
    {
        bytes memory initData = abi.encodeCall(AgenticCommerce.initialize, (token_, treasury_, admin_));
        return address(new TransparentUpgradeableProxy(impl, kernelProxyAdminOwner, initData));
    }

    function _proxyAdmin(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT))));
    }

    // ───────────── job helpers ─────────────

    function _expiry() internal view returns (uint256) {
        return block.timestamp + EXPIRY_OFFSET;
    }

    function _create(address hook) internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = kernel.createJob(provider, evaluator, _expiry(), "job", hook);
    }

    function _createNoProvider(address hook) internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = kernel.createJob(address(0), evaluator, _expiry(), "job", hook);
    }

    function _budgeted(address hook, uint256 amount) internal returns (uint256 jobId) {
        jobId = _create(hook);
        vm.prank(provider);
        kernel.setBudget(jobId, amount, "");
    }

    function _funded(address hook, uint256 amount) internal returns (uint256 jobId) {
        jobId = _budgeted(hook, amount);
        vm.prank(client);
        kernel.fund(jobId, amount, "");
    }

    function _submitted(address hook, uint256 amount) internal returns (uint256 jobId) {
        jobId = _funded(hook, amount);
        vm.prank(provider);
        kernel.submit(jobId, keccak256("deliverable"), "");
    }

    function _status(uint256 jobId) internal view returns (IAgenticCommerce.JobStatus) {
        return kernel.getJob(jobId).status;
    }

    function _pause() internal {
        vm.prank(admin);
        kernel.pause();
    }
}
