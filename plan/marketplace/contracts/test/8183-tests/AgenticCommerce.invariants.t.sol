// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {AgenticCommerce} from "../../src/agentic-commerce-8183/AgenticCommerce.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {MockERC20_6} from "./mocks/MockERC20_6.sol";
import {RecordingHook} from "./mocks/RecordingHook.sol";

/// @notice Drives the kernel with random but role-correct actions and checks every transition.
/// @dev - Kernel reverts are swallowed (fail_on_revert stays false).
///      - Violations are recorded in `violation`, never asserted here — a handler revert would be swallowed too.
contract KernelHandler is Test {
    AgenticCommerce internal kernel;
    MockERC20_6 internal token;
    address internal admin;
    address internal hook;

    address[3] internal clients;
    address[3] internal providers;
    address[2] internal evaluators;

    mapping(uint256 => uint8) public lastStatus;
    uint256 public okFund;
    uint256 public okComplete;
    uint256 public okExit; // reject or claimRefund from Funded/Submitted
    bool public violation;
    string public violationReason;

    constructor(AgenticCommerce kernel_, MockERC20_6 token_, address admin_, address hook_) {
        kernel = kernel_;
        token = token_;
        admin = admin_;
        hook = hook_;
        for (uint256 i = 0; i < 3; i++) {
            clients[i] = makeAddr(string.concat("c", vm.toString(i)));
            providers[i] = makeAddr(string.concat("p", vm.toString(i)));
            token.mint(clients[i], 1e12);
            vm.prank(clients[i]);
            token.approve(address(kernel), type(uint256).max);
        }
        evaluators[0] = makeAddr("e0");
        evaluators[1] = makeAddr("e1");
        _seed();
    }

    /// @dev Seeds one Open-budgeted, one Funded and one Submitted job so every run has escrow to move.
    function _seed() internal {
        uint256 exp = block.timestamp + 30 days;
        for (uint256 k = 0; k < 3; k++) {
            vm.prank(clients[k]);
            uint256 id = kernel.createJob(providers[k], evaluators[0], exp, "seed", address(0));
            vm.prank(providers[k]);
            kernel.setBudget(id, 1e6 * (k + 1), "");
            lastStatus[id] = uint8(IAgenticCommerce.JobStatus.Open);
            if (k >= 1) {
                vm.prank(clients[k]);
                kernel.fund(id, 1e6 * (k + 1), "");
                lastStatus[id] = uint8(IAgenticCommerce.JobStatus.Funded);
            }
            if (k == 2) {
                vm.prank(providers[k]);
                kernel.submit(id, bytes32(0), "");
                lastStatus[id] = uint8(IAgenticCommerce.JobStatus.Submitted);
            }
        }
    }

    // ───────────── actions ─────────────

    function createJob(uint256 c, uint256 p, uint256 e, uint256 expOffset, bool withProvider, bool withHook) external {
        address cl = clients[c % 3];
        address pr = withProvider ? providers[p % 3] : address(0);
        address ev = evaluators[e % 2];
        expOffset = bound(expOffset, 6 minutes, 30 days);
        vm.prank(cl);
        try kernel.createJob(pr, ev, block.timestamp + expOffset, "", withHook ? hook : address(0)) returns (
            uint256 id
        ) {
            lastStatus[id] = uint8(IAgenticCommerce.JobStatus.Open);
        } catch {}
    }

    function setProvider(uint256 j, uint256 p) external {
        (uint256 id, IAgenticCommerce.Job memory job) = _pick(j);
        if (id == 0) return;
        vm.prank(job.client);
        try kernel.setProvider(id, providers[p % 3], "") {
            _check(id);
        } catch {}
    }

    function setBudget(uint256 j, uint256 amount) external {
        (uint256 id, IAgenticCommerce.Job memory job) = _pick(j);
        if (id == 0) return;
        amount = bound(amount, 0, 1e9);
        vm.prank(job.provider);
        try kernel.setBudget(id, amount, "") {
            _check(id);
        } catch {}
    }

    /// @dev Probes: `wrongStatus` targets any job; `wrongActor` sends from the provider.
    ///      A probe that succeeds is a violation (C-01).
    function fund(uint256 j, bool wrongStatus, bool wrongActor) external {
        (uint256 id, IAgenticCommerce.Job memory job) =
            wrongStatus ? _pick(j) : _pickStatus(j, IAgenticCommerce.JobStatus.Open);
        if (id == 0) return;
        bool mustRevert = wrongActor || job.status != IAgenticCommerce.JobStatus.Open;
        vm.prank(wrongActor ? job.provider : job.client);
        try kernel.fund(id, job.budget, "") {
            if (mustRevert) _fail("fund succeeded with wrong status/actor");
            _check(id);
            okFund++;
        } catch {}
    }

    /// @dev Probes: `wrongActor` sends from the client.
    function submit(uint256 j, bool wrongStatus, bool wrongActor) external {
        (uint256 id, IAgenticCommerce.Job memory job) =
            wrongStatus ? _pick(j) : _pickStatus(j, IAgenticCommerce.JobStatus.Funded);
        if (id == 0) return;
        bool mustRevert = wrongActor || job.status != IAgenticCommerce.JobStatus.Funded;
        vm.prank(wrongActor ? job.client : job.provider);
        try kernel.submit(id, bytes32(0), "") {
            if (mustRevert) _fail("submit succeeded with wrong status/actor");
            _check(id);
        } catch {}
    }

    /// @dev Probes: `wrongActor` sends from the client.
    function complete(uint256 j, bool wrongStatus, bool wrongActor) external {
        (uint256 id, IAgenticCommerce.Job memory job) =
            wrongStatus ? _pick(j) : _pickStatus(j, IAgenticCommerce.JobStatus.Submitted);
        if (id == 0) return;
        bool mustRevert = wrongActor || job.status != IAgenticCommerce.JobStatus.Submitted;
        vm.prank(wrongActor ? job.client : job.evaluator);
        try kernel.complete(id, bytes32(0), "") {
            if (mustRevert) _fail("complete succeeded with wrong status/actor");
            _check(id);
            okComplete++;
        } catch {}
    }

    /// @dev Default: evaluator on an escrowed job, or client on any job.
    ///      Probe `wrongActor`: Open → evaluator; Funded/Submitted → provider. Must revert.
    function reject(uint256 j, bool asEvaluator, bool wrongActor) external {
        (uint256 id, IAgenticCommerce.Job memory job) = (asEvaluator && !wrongActor) ? _pickEscrowed(j) : _pick(j);
        if (id == 0) return;
        address actor;
        if (wrongActor) actor = job.status == IAgenticCommerce.JobStatus.Open ? job.evaluator : job.provider;
        else actor = asEvaluator ? job.evaluator : job.client;
        uint8 before = lastStatus[id];
        vm.prank(actor);
        try kernel.reject(id, bytes32(0), "") {
            if (wrongActor) _fail("reject succeeded with wrong actor");
            _check(id);
            if (before == 1 || before == 2) okExit++;
        } catch {}
    }

    function claimRefund(uint256 j) external {
        (uint256 id,) = _pickEscrowed(j);
        if (id == 0) return;
        uint8 before = lastStatus[id];
        try kernel.claimRefund(id) {
            _check(id);
            if (before == 1 || before == 2) okExit++;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 days));
    }

    function setFees(uint256 pBP, uint256 eBP) external {
        pBP = bound(pBP, 0, 10_000);
        eBP = bound(eBP, 0, 10_000 - pBP);
        vm.startPrank(admin);
        kernel.setEvaluatorFee(0);
        kernel.setPlatformFee(pBP, makeAddr("treasury"));
        kernel.setEvaluatorFee(eBP);
        vm.stopPrank();
    }

    // ───────────── ghost checks ─────────────

    function _pick(uint256 j) internal view returns (uint256 id, IAgenticCommerce.Job memory job) {
        uint256 n = kernel.jobCounter();
        if (n == 0) return (0, job);
        id = bound(j, 1, n);
        job = kernel.getJob(id);
    }

    /// @dev Picks the first job at or after a random start whose status is `want`; 0 if none.
    function _pickStatus(uint256 j, IAgenticCommerce.JobStatus want)
        internal
        view
        returns (uint256 id, IAgenticCommerce.Job memory job)
    {
        uint256 n = kernel.jobCounter();
        if (n == 0) return (0, job);
        uint256 start = bound(j, 1, n);
        for (uint256 k = 0; k < n; k++) {
            uint256 cand = ((start - 1 + k) % n) + 1;
            IAgenticCommerce.Job memory c = kernel.getJob(cand);
            if (c.status == want) return (cand, c);
        }
        return (0, job);
    }

    /// @dev A job holding escrow (Funded, else Submitted); 0 if none.
    function _pickEscrowed(uint256 j) internal view returns (uint256 id, IAgenticCommerce.Job memory job) {
        (id, job) = _pickStatus(j, IAgenticCommerce.JobStatus.Funded);
        if (id == 0) (id, job) = _pickStatus(j, IAgenticCommerce.JobStatus.Submitted);
    }

    /// @dev Called only after a successful action: the transition must be a legal edge.
    function _check(uint256 id) internal {
        uint8 prev = lastStatus[id];
        uint8 next = uint8(kernel.getJob(id).status);
        if (prev >= 3) {
            _fail("action succeeded on a terminal job");
        } else if (!_isEdge(prev, next)) {
            _fail("illegal status transition");
        }
        lastStatus[id] = next;
    }

    function _isEdge(uint8 a, uint8 b) internal pure returns (bool) {
        // 0 Open · 1 Funded · 2 Submitted · 3 Completed · 4 Rejected · 5 Expired
        if (a == 0) return b == 0 || b == 1 || b == 4 || b == 5;
        if (a == 1) return b == 2 || b == 4 || b == 5;
        if (a == 2) return b == 3 || b == 4 || b == 5;
        return false;
    }

    function _fail(string memory why) internal {
        if (!violation) {
            violation = true;
            violationReason = why;
        }
    }
}

contract AgenticCommerceInvariantsTest is KernelBase {
    KernelHandler internal handler;

    function setUp() public override {
        super.setUp();
        RecordingHook hook = new RecordingHook();
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), true);
        handler = new KernelHandler(kernel, token, admin, address(hook));
        targetContract(address(handler));
    }

    function invariant_totalEscrowedMatchesLiveBudgets() public view {
        uint256 sum;
        uint256 n = kernel.jobCounter();
        for (uint256 i = 1; i <= n; i++) {
            IAgenticCommerce.Job memory j = kernel.getJob(i);
            if (j.status == IAgenticCommerce.JobStatus.Funded || j.status == IAgenticCommerce.JobStatus.Submitted) {
                sum += j.budget;
            }
        }
        assertEq(kernel.totalEscrowed(), sum);
    }

    function invariant_balanceCoversEscrow() public view {
        assertGe(token.balanceOf(address(kernel)), kernel.totalEscrowed());
    }

    function invariant_onlyLegalTransitions() public view {
        assertFalse(handler.violation(), handler.violationReason());
    }

    /// @dev Liveness proof for the handler: a fixed 600-step pseudo-random walk must reach
    ///      fund, complete and a refund path, with every invariant holding at the end.
    ///      Lives here, not in afterInvariant, because shrunk/replayed sequences are short by design.
    function test_handlerLiveness() public {
        for (uint256 i = 0; i < 600; i++) {
            uint256 r = uint256(keccak256(abi.encode(i)));
            uint256 a = r % 10;
            if (a == 0) handler.createJob(r, r >> 8, r >> 16, r >> 24, (r >> 32) % 2 == 0, (r >> 40) % 2 == 0);
            else if (a == 1) handler.setProvider(r, r >> 8);
            else if (a == 2) handler.setBudget(r, r >> 8);
            else if (a == 3) handler.fund(r, false, false);
            else if (a == 4) handler.submit(r, false, false);
            else if (a == 5) handler.complete(r, false, false);
            else if (a == 6) handler.reject(r, (r >> 8) % 2 == 0, false);
            else if (a == 7) handler.claimRefund(r);
            else if (a == 8) handler.warp(r % 3 hours);
            else handler.setFees(r, r >> 8);
        }
        assertGt(handler.okFund(), 0, "no successful fund");
        assertGt(handler.okComplete(), 0, "no successful complete");
        assertGt(handler.okExit(), 0, "no successful refund path");
        invariant_totalEscrowedMatchesLiveBudgets();
        invariant_balanceCoversEscrow();
        invariant_onlyLegalTransitions();
    }
}
