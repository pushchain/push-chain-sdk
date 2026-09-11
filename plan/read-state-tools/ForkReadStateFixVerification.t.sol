// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import {IUniversalCallback} from "../../src/interfaces/IUniversalCallback.sol";
import {IUniversalCore} from "../../src/interfaces/IUniversalCore.sol";
import {ReadSpec, RequestStatus} from "../../src/libraries/ReadTypes.sol";
import {UniversalAccountId} from "../../src/libraries/Types.sol";
import {UniversalCallbackErrors} from "../../src/libraries/Errors.sol";

interface IUCViews {
    function grantRole(bytes32, address) external;
    function statusOf(uint256) external view returns (RequestStatus);
    function totalEscrowed() external view returns (uint256);
    function paused() external view returns (bool);
    function hasRole(bytes32, address) external view returns (bool);
}

/// @notice App whose callback needs a FIXED amount of gas close to its declared limit.
///         Used to probe whether the node's `callbackGasLimit + fulfilGasBuffer` is enough
///         when an app actually uses most of the budget it declared.
contract FullBudgetReadClient {
    IUniversalCallback public immutable UC;
    uint256[] public sink;
    /// packed: (gasAtEntry << 128) | completedFlag  -- one SSTORE at the very end
    uint256 public result;
    uint256 public writes;

    constructor(address uc, uint256 writes_) {
        UC = IUniversalCallback(uc);
        writes = writes_;
    }

    function request(ReadSpec memory spec, uint64 gasLimit) external payable returns (uint256) {
        return UC.requestExternalReadSelf{value: msg.value}(spec, this.onUniversalData.selector, gasLimit);
    }

    function onUniversalData(uint256, bytes calldata) external {
        uint256 entry = gasleft();
        for (uint256 i = 0; i < writes; i++) sink.push(i + 1);
        uint256 rem = gasleft();
        result = (entry << 128) | (rem << 1) | 1;
    }

    function completed() external view returns (bool) { return result & 1 == 1; }
    function gasAtEntry() external view returns (uint256) { return result >> 128; }
    /// gas consumed by the loop body (excludes the ~22k final SSTORE that records this)
    function gasUsedByLoop() external view returns (uint256) { return (result >> 128) - ((result >> 1) & type(uint64).max); }
    receive() external payable {}
}

/// @notice App whose callback tries to chain a follow-up read (C6 probe).
contract ChainingReadClient {
    IUniversalCallback public immutable UC;
    ReadSpec internal nextSpec;
    bool public callbackRan;
    bool public chainedRequestSucceeded;
    bytes public chainedRevert;

    constructor(address uc) { UC = IUniversalCallback(uc); }

    function request(ReadSpec memory spec, uint64 gasLimit) external payable returns (uint256) {
        nextSpec = spec;
        return UC.requestExternalReadSelf{value: msg.value}(spec, this.onUniversalData.selector, gasLimit);
    }

    function onUniversalData(uint256, bytes calldata) external {
        callbackRan = true;
        try UC.requestExternalReadSelf{value: 0}(nextSpec, this.onUniversalData.selector, 200_000) {
            chainedRequestSucceeded = true;
        } catch (bytes memory reason) {
            chainedRevert = reason;
        }
    }
    receive() external payable {}
}

/// @notice App whose callback ALWAYS reverts — for the live "callbackDelivered = false" check.
///         The read still reaches FULFILLED on the node; the contract emits CallbackFailed.
contract RevertingReadClient {
    IUniversalCallback public immutable UC;
    uint256 public attempts; // never persists — the revert rolls it back; proof is the CallbackFailed event

    constructor(address uc) { UC = IUniversalCallback(uc); }

    function request(ReadSpec memory spec, uint64 gasLimit) external payable returns (uint256) {
        return UC.requestExternalReadSelf{value: msg.value}(spec, this.onUniversalData.selector, gasLimit);
    }

    function onUniversalData(uint256, bytes calldata) external {
        attempts++;
        revert("app callback reverted on purpose");
    }
    receive() external payable {}
}

/// @notice revertRecipient whose receive() reverts (C5 probe).
contract RejectingRecipient {
    receive() external payable { revert("no thanks"); }
}

/// @title  Verification of the read-state fixes against the REDEPLOYED Donut contracts
/// @notice Run after the team's fix commits landed (contracts 82e982b, c603558, 6fc7a18,
///         46b56c1; node e28367b6, 47a25eed, d4ef66db). Asserts the FIXED behaviour and
///         probes the boundaries the fixes introduced.
///
///   export PUSH_CHAIN_TESTNET_RPC_URL=https://evm.donut.rpc.push.org/
///   forge test --match-path test/fork/ForkReadStateFixVerification.t.sol -vv
contract ForkReadStateFixVerificationTest is Test {
    IUniversalCore internal constant CORE = IUniversalCore(0x00000000000000000000000000000000000000C0);
    IUniversalCallback internal constant UC = IUniversalCallback(0x00000000000000000000000000000000000000c2);
    address internal constant MODULE = 0x07a0258D367A4A4cd9d6E4b7eEE8E7eF491CC519;
    address internal constant ADMIN = 0xa96CaA79eb2312DbEb0B8E93c1Ce84C98b67bF11;

    /// Node-side constant from x/ucallback/keeper/evm.go (commit e28367b6).
    uint256 internal constant FULFIL_GAS_BUFFER = 50_000;

    uint256 internal forkId;

    function setUp() public {
        string memory rpc = vm.envOr("PUSH_CHAIN_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        forkId = vm.createSelectFork(rpc);
    }

    modifier onlyOnFork() {
        if (forkId == 0 && block.chainid == 31337) { emit log("SKIP: set PUSH_CHAIN_TESTNET_RPC_URL"); return; }
        _;
    }

    // =========================================================================
    // C1 — FIXED: bare namespace now resolves; the old workaround now fails
    // =========================================================================

    function test_C1_Fixed_BareNamespaceRequestSucceeds() public onlyOnFork {
        uint64 h = uint64(CORE.chainHeightByChainNamespace("eip155:11155111"));
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.deal(address(this), 1 ether);
        uint256 id = c.request(_evmSpec("eip155", "11155111", h, address(c)), 200_000);
        assertGt(id, 0);
        assertTrue(IUCViews(address(UC)).statusOf(id) == RequestStatus.PENDING);
        emit log_named_uint("bare-namespace request accepted at blockNumber", h);
    }

    function test_C1_Fixed_AboveObservedHeightStillRejected() public onlyOnFork {
        uint64 h = uint64(CORE.chainHeightByChainNamespace("eip155:11155111"));
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.expectRevert(UniversalCallbackErrors.InvalidBlockNumber.selector);
        c.request(_evmSpec("eip155", "11155111", h + 1, address(c)), 200_000);
    }

    /// @dev Regression guard: the key is JOINED from (ns, chainId). Passing the full
    ///      CAIP-2 as the namespace -- the pre-fix diagnostic -- must now fail, because it
    ///      would produce "eip155:11155111:11155111" and break validator routing.
    function test_C1_Fixed_OldCaip2WorkaroundNowRejected() public onlyOnFork {
        uint64 h = uint64(CORE.chainHeightByChainNamespace("eip155:11155111"));
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.expectRevert(UniversalCallbackErrors.InvalidBlockNumber.selector);
        c.request(_evmSpec("eip155:11155111", "11155111", h, address(c)), 200_000);
    }

    // =========================================================================
    // C3 — FIXED: heightless namespaces accepted with blockNumber == 0
    // =========================================================================

    function test_C3_Fixed_Web2RequestSucceedsWithZeroBlock() public onlyOnFork {
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.deal(address(this), 1 ether);
        uint256 id = c.request(_web2Spec(0, address(c)), 200_000);
        assertGt(id, 0);
        emit log("web2 request accepted (heightless branch)");
    }

    function test_C3_Fixed_Web2WithNonZeroBlockRejected() public onlyOnFork {
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.expectRevert(UniversalCallbackErrors.InvalidBlockNumber.selector);
        c.request(_web2Spec(1, address(c)), 200_000);
    }

    // =========================================================================
    // N4 — REGRESSION: the C3 fix removed the implicit destination gate
    // =========================================================================

    /// @dev Before c603558, an unconfigured destination had height 0 and was therefore
    ///      rejected by the height guard -- an accidental allow-list. The heightless
    ///      branch now ACCEPTS any unknown destination at blockNumber == 0. With the fee
    ///      at 0 and blockedDomains empty, arbitrary destinations are requestable for free.
    function test_N4_Regression_UnconfiguredDestinationNowAccepted() public onlyOnFork {
        FullBudgetReadClient c = new FullBudgetReadClient(address(UC), 1);
        vm.deal(address(this), 1 ether);
        string[2] memory ns = ["cosmos", "eip155"];
        string[2] memory id = ["foo", "999999"];
        for (uint256 i = 0; i < 2; i++) {
            uint256 fee = UC.estimateFee(ns[i], id[i]);
            uint256 rid = c.request{value: fee}(_evmSpec(ns[i], id[i], 0, address(c)), 200_000);
            emit log_named_string("accepted for unconfigured destination", string.concat(ns[i], ":", id[i]));
            emit log_named_uint("   fee paid", fee);
            assertGt(rid, 0);
        }
        emit log("=> every validator will attempt these. Affordability gate (N4) is still absent.");
    }

    // =========================================================================
    // C4 — FIXED: admin can settle an EXECUTED request
    // =========================================================================

    function test_C4_Fixed_AdminCanSettleExecuted() public onlyOnFork {
        assertTrue(IUCViews(address(UC)).hasRole(keccak256("UVCALLBACK_ADMIN_ROLE"), ADMIN));
        (FullBudgetReadClient c, uint256 id) = _stage(1, 200_000, 0.1 ether);
        vm.prank(MODULE);
        UC.fulfillExternalCallback(id, abi.encode(uint256(1)));
        assertTrue(IUCViews(address(UC)).statusOf(id) == RequestStatus.EXECUTED);

        // random caller: no
        vm.prank(address(0xBEEF));
        vm.expectRevert(UniversalCallbackErrors.UnauthorizedCaller.selector);
        UC.reportCallbackGas(id, 50_000);

        // admin: yes
        vm.prank(ADMIN);
        UC.reportCallbackGas(id, 50_000);
        assertTrue(IUCViews(address(UC)).statusOf(id) == RequestStatus.SETTLED);
        assertTrue(c.completed());
        emit log("EXECUTED -> SETTLED via UVCALLBACK_ADMIN_ROLE");
    }

    /// @dev Settles which version is live: PR #123 was merged with the modifier changed
    ///      from DEFAULT_ADMIN_ROLE to UVCALLBACK_ADMIN_ROLE (commit 46b56c1). An address
    ///      holding ONLY UVCALLBACK_ADMIN_ROLE can settle iff the merged version is deployed.
    function test_C4_DeployedImplUsesUvcallbackAdminRole() public onlyOnFork {
        address probe = address(0xC4C4);
        bytes32 UVC = keccak256("UVCALLBACK_ADMIN_ROLE");
        vm.prank(ADMIN);
        IUCViews(address(UC)).grantRole(UVC, probe);
        assertTrue(IUCViews(address(UC)).hasRole(UVC, probe));
        assertFalse(IUCViews(address(UC)).hasRole(bytes32(0), probe), "probe must NOT hold DEFAULT_ADMIN_ROLE");

        (, uint256 id) = _stage(1, 200_000, 0.1 ether);
        vm.prank(MODULE);
        UC.fulfillExternalCallback(id, abi.encode(uint256(1)));

        vm.prank(probe);
        UC.reportCallbackGas(id, 50_000);
        assertTrue(IUCViews(address(UC)).statusOf(id) == RequestStatus.SETTLED);
        emit log("deployed impl gates reportCallbackGas on UVCALLBACK_ADMIN_ROLE (merged version, 46b56c1)");
    }

    // =========================================================================
    // N2 — BOUNDARY: is callbackGasLimit + 50_000 enough when the app USES its budget?
    // =========================================================================
    //
    // Calibrated empirically, not estimated: for each limit L, find the MOST demanding
    // callback that still completes when handed exactly L gas directly (no UniversalCallback
    // involved). That is the worst legitimate app. Then run the real fulfil path with the
    // node's exact formula, outer = L + fulfilGasBuffer, and check the callback completes.

    /// @dev Largest `writes` such that onUniversalData completes when called with gas == L.
    function _mostDemandingCallbackFor(uint64 L) internal returns (uint256 w) {
        uint256 lo = 0; uint256 hi = 64;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            uint256 snap = vm.snapshotState();
            FullBudgetReadClient c = new FullBudgetReadClient(address(UC), mid);
            (bool ok,) = address(c).call{gas: L}(abi.encodeWithSelector(c.onUniversalData.selector, uint256(0), bytes("")));
            bool done = ok && c.completed();
            vm.revertToState(snap);
            if (done) lo = mid; else hi = mid - 1;
        }
        return lo;
    }

    function test_N2_Boundary_BufferSufficientForMostDemandingCallback() public onlyOnFork {
        uint64[3] memory limits = [uint64(200_000), 500_000, 1_000_000];
        emit log("limit    | writes | cb used  | outer=L+50k | completed");
        bool allOk = true;
        for (uint256 i = 0; i < limits.length; i++) {
            uint64 L = limits[i];
            uint256 w = _mostDemandingCallbackFor(L);
            uint256 snap = vm.snapshotState();
            (FullBudgetReadClient c, uint256 id) = _stage(w, L, 0);
            uint256 outer = uint256(L) + FULFIL_GAS_BUFFER;
            vm.prank(MODULE);
            (bool ok,) = address(UC).call{gas: outer}(
                abi.encodeWithSelector(IUniversalCallback.fulfillExternalCallback.selector, id, abi.encode(uint256(1)))
            );
            bool done = c.completed();
            uint256 used = done ? c.gasUsedByLoop() + 22_100 : 0;
            emit log_named_string(
                string.concat(vm.toString(uint256(L)), " | ", vm.toString(w), " | ", vm.toString(used), " | ", vm.toString(outer)),
                string.concat(" | ", done ? "YES" : "NO  <-- STARVED", ok ? "" : " (outer reverted)")
            );
            if (!done) allOk = false;
            vm.revertToState(snap);
        }
        assertTrue(allOk, "fulfilGasBuffer too small: the most demanding legitimate callback gets starved");
    }

    /// @dev For the most demanding callback at each limit, the smallest outer gas that
    ///      completes it. The gap above L is the buffer the node actually needs.
    function test_N2_Boundary_MeasureRequiredBuffer() public onlyOnFork {
        uint64[3] memory limits = [uint64(200_000), 500_000, 1_000_000];
        emit log("limit    | min outer that completes | needed buffer | node buffer");
        for (uint256 i = 0; i < limits.length; i++) {
            uint64 L = limits[i];
            uint256 w = _mostDemandingCallbackFor(L);
            uint256 lo = L; uint256 hi = uint256(L) + 100_000;
            // binary search smallest g in [L, L+100k] with completion (monotone)
            while (lo < hi) {
                uint256 mid = (lo + hi) / 2;
                uint256 snap = vm.snapshotState();
                (FullBudgetReadClient c, uint256 id) = _stage(w, L, 0);
                vm.prank(MODULE);
                (bool ok,) = address(UC).call{gas: mid}(
                    abi.encodeWithSelector(IUniversalCallback.fulfillExternalCallback.selector, id, abi.encode(uint256(1)))
                );
                bool done = ok && c.completed();
                vm.revertToState(snap);
                if (done) hi = mid; else lo = mid + 1;
            }
            emit log_named_string(
                vm.toString(uint256(L)),
                string.concat(" | ", vm.toString(lo), " | ", vm.toString(lo - L), " | ", vm.toString(FULFIL_GAS_BUFFER),
                    lo - L > FULFIL_GAS_BUFFER ? "  <-- INSUFFICIENT" : "  ok")
            );
            assertLe(lo - L, FULFIL_GAS_BUFFER, "needed buffer exceeds the node's fulfilGasBuffer");
        }
    }

    // =========================================================================
    // ENVELOPE SHAPE — learned the hard way on the first live read (2026-09-09)
    // =========================================================================

    /// @dev The first real Donut read came back READ_ERROR_INVALID_QUERY because the query was
    ///      encoded as three ABI params instead of one tuple. Go's abi.Arguments{tuple}.Unpack
    ///      expects the single-tuple layout. Pure test, no fork needed.
    function test_Envelope_MustBeSingleTupleNotThreeParams() public pure {
        bytes memory payload = abi.encode(address(0xdEaD));
        bytes memory single = abi.encode(EvmQueryEnvelope({queryType: 1, blockRef: EvmBlockRef({refType: 0, blockNumber: 42}), payload: payload}));
        bytes memory three  = abi.encode(uint8(1), EvmBlockRef({refType: 0, blockNumber: 42}), payload);

        // single-tuple form starts with a 0x20 head offset; three-param form starts with the queryType
        assertEq(uint256(bytes32(_slice(single, 0, 32))), 0x20, "single-tuple must lead with head offset");
        assertEq(uint256(bytes32(_slice(three, 0, 32))), 1, "three-param leads with queryType");
        assertTrue(keccak256(single) != keccak256(three), "layouts must differ");

        // and only the single-tuple form round-trips through the decoder's shape
        EvmQueryEnvelope memory back = abi.decode(single, (EvmQueryEnvelope));
        assertEq(back.queryType, 1); assertEq(back.blockRef.blockNumber, 42); assertEq(keccak256(back.payload), keccak256(payload));
    }

    function _slice(bytes memory b, uint256 start, uint256 len) internal pure returns (bytes memory out) {
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = b[start + i];
    }

    // =========================================================================
    // C6 — STILL PRESENT: callback cannot chain a read
    // =========================================================================

    function test_C6_StillPresent_ChainedReadFailsWithReentrancy() public onlyOnFork {
        uint64 h = uint64(CORE.chainHeightByChainNamespace("eip155:11155111"));
        ChainingReadClient c = new ChainingReadClient(address(UC));
        vm.deal(address(this), 1 ether);
        uint256 id = c.request(_evmSpec("eip155", "11155111", h, address(c)), 400_000);
        vm.prank(MODULE);
        UC.fulfillExternalCallback(id, abi.encode(uint256(1)));
        assertTrue(c.callbackRan());
        assertFalse(c.chainedRequestSucceeded(), "chained read should be blocked by shared nonReentrant");
        emit log_named_bytes("chained request revert data", c.chainedRevert());
        emit log("=> read -> callback -> read is still impossible (C6 unfixed).");
    }

    // =========================================================================
    // C5 — STILL PRESENT: rejected refund lands in the admin-rescuable pool
    // =========================================================================

    function test_C5_StillPresent_RejectedRefundBecomesRescuable() public onlyOnFork {
        RejectingRecipient bad = new RejectingRecipient();
        uint256 budget = 0.2 ether;
        (,uint256 id) = _stageWithRecipient(1, 200_000, budget, address(bad));

        vm.prank(MODULE);
        UC.fulfillExternalCallback(id, abi.encode(uint256(1)));
        uint256 rescuableBefore = address(UC).balance - IUCViews(address(UC)).totalEscrowed();
        vm.prank(MODULE);
        uint256 burned = UC.reportCallbackGas(id, 10_000); // tiny burn -> big refund attempted
        uint256 rescuableAfter = address(UC).balance - IUCViews(address(UC)).totalEscrowed();

        emit log_named_uint("budget escrowed        ", budget);
        emit log_named_uint("burned                 ", burned);
        emit log_named_uint("rescuable before settle", rescuableBefore);
        emit log_named_uint("rescuable after settle ", rescuableAfter);
        assertGt(rescuableAfter, rescuableBefore, "refund that the recipient rejected should now be admin-rescuable");
        emit log("=> user's unspent budget is now in rescueNativePC's pool (C5 unfixed; design unchanged).");
    }

    // =========================================================================
    // helpers
    // =========================================================================

    function _stage(uint256 writes, uint64 gasLimit, uint256 budget) internal returns (FullBudgetReadClient c, uint256 id) {
        c = new FullBudgetReadClient(address(UC), writes);
        return (c, _fund(c, gasLimit, budget, address(c)));
    }

    function _stageWithRecipient(uint256 writes, uint64 gasLimit, uint256 budget, address recipient)
        internal returns (FullBudgetReadClient c, uint256 id)
    {
        c = new FullBudgetReadClient(address(UC), writes);
        return (c, _fund(c, gasLimit, budget, recipient));
    }

    function _fund(FullBudgetReadClient c, uint64 gasLimit, uint256 budget, address recipient) internal returns (uint256) {
        uint64 h = uint64(CORE.chainHeightByChainNamespace("eip155:11155111"));
        uint256 fee = UC.estimateFee("eip155", "11155111");
        vm.deal(address(this), fee + budget + 1 ether);
        return c.request{value: fee + budget}(_evmSpec("eip155", "11155111", h, recipient), gasLimit);
    }

    function _evmSpec(string memory ns, string memory cid, uint64 blockNumber, address recipient) internal view returns (ReadSpec memory) {
        return ReadSpec({
            account: UniversalAccountId({chainNamespace: ns, chainId: cid, owner: abi.encodePacked(address(0xdEaD))}),
            query: abi.encode(
                EvmQueryEnvelope({
                    queryType: 0,
                    blockRef: EvmBlockRef({refType: 0, blockNumber: blockNumber}),
                    payload: abi.encode(address(0xdEaD))
                })
            ),
            minConfirmations: 1,
            blockNumber: blockNumber,
            expiryPushChainHeight: uint64(block.number + 1000),
            maxFee: 100 ether,
            revertRecipient: recipient
        });
    }

    function _web2Spec(uint64 blockNumber, address recipient) internal view returns (ReadSpec memory) {
        Web2Extract[] memory ex = new Web2Extract[](1);
        ex[0] = Web2Extract({path: "$.price", valueType: 0, mode: 0, decimals: 8});
        return ReadSpec({
            account: UniversalAccountId({chainNamespace: "web2", chainId: "https", owner: abi.encodePacked(address(this))}),
            query: abi.encode(
                Web2QueryEnvelope({
                    method: 0, url: "https://api.example.com/price", headers: bytes("{}"),
                    body: bytes(""), timeoutMs: 5000, extract: ex
                })
            ),
            minConfirmations: 1,
            blockNumber: blockNumber,
            expiryPushChainHeight: uint64(block.number + 1000),
            maxFee: 100 ether,
            revertRecipient: recipient
        });
    }

    // Mirrors universalClient/externalchains/{evm,web2}/read_envelope.go. Each envelope is
    // decoded as abi.Arguments{ ONE tuple }, so it must be abi.encode(struct) — a single
    // dynamic tuple with a 0x20 head offset — NOT abi.encode(field, field, field).
    struct EvmBlockRef { uint8 refType; uint64 blockNumber; }
    struct EvmQueryEnvelope { uint8 queryType; EvmBlockRef blockRef; bytes payload; }
    struct Web2Extract { string path; uint8 valueType; uint8 mode; uint8 decimals; }
    struct Web2QueryEnvelope { uint8 method; string url; bytes headers; bytes body; uint64 timeoutMs; Web2Extract[] extract; }
    function onUniversalData(uint256, bytes calldata) external {}
    receive() external payable {}
}
