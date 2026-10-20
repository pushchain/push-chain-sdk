// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {UniversalTerms} from "@push-agw/libraries/Types.sol";
import {MarketplaceFixtures} from "./UniversalMarketplace.t.sol";
import {MockAGW} from "./mocks/MockAGW.sol";
import {UniversalMarketplaceErrors} from "../../src/agentic-commerce-8183/libraries/Errors.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {UniversalMarketplace} from "../../src/agentic-commerce-8183/UniversalMarketplace.sol";
import {JobSpec} from "../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol";
import {
    AgentCard,
    AgentCardRules,
    JobInputs,
    OpenJobParams
} from "../../src/agentic-commerce-8183/libraries/Types.sol";

/// @notice Drives openJob through honest and misbehaving wallets on a swap card (one param), card registration by
///         a small set of providers, the card's update, cancels and time. Records what every opened job must look
///         like.
contract MarketplaceHandler is MarketplaceFixtures {
    uint256 public cardId;
    address[] public agws;
    uint256[] public jobs;
    mapping(uint256 => bytes32) public expectedOrigin;
    /// @notice Per opened job: the policy initData the wallet was granted, and the job's principal (MI07).
    mapping(uint256 => bytes) public grantedInitData;
    mapping(uint256 => uint256) public grantedPrincipal;
    address[3] public providers;
    uint256 public userTokenStart;
    uint256 public userAssetStart;
    uint256 public userEthStart;

    /// @notice Outcome counters. `opened` and `refused` are the liveness evidence (afterInvariant); the
    ///         "unexpected" counters must stay zero. Counters rather than vm.expectRevert: with
    ///         fail_on_revert = false an unmet expectation inside a handler is a discarded call.
    uint256 public opened;
    uint256 public refused;
    uint256 public honestRefused;
    uint256 public misbehaviourAccepted;
    uint256 public wrongRefusal;
    uint256 public duplicateCardAccepted;
    uint256 public wrongRegistrationRefusal;

    constructor() {
        setUp();
        cardId = _registerSwap();
        providers = [provider, provider2, makeAddr("provider3")];
        userTokenStart = token.balanceOf(user);
        userAssetStart = pUSDC.balanceOf(user);
        userEthStart = user.balance;
    }

    function agwCount() external view returns (uint256) {
        return agws.length;
    }

    function jobCount() external view returns (uint256) {
        return jobs.length;
    }

    function marketplace() external view returns (address) {
        return address(mkt);
    }

    function job(uint256 jobId) external view returns (IAgenticCommerce.Job memory) {
        return kernel.getJob(jobId);
    }

    function balances(address who) external view returns (uint256 tokenBal, uint256 assetBal, uint256 ethBal) {
        return (token.balanceOf(who), pUSDC.balanceOf(who), who.balance);
    }

    function principalAssetOf(uint256 id) external view returns (uint8) {
        return abi.decode(mkt.getAgentCard(id).rules, (AgentCardRules)).principalAsset;
    }

    /// @param misbehave 0 honest · 1 wallet creates two jobs · 2 wallet creates the job from another address.
    ///        An honest open on a free wallet MUST succeed; a misbehaving one MUST fail with its named error.
    function open(uint256 principalSeed, uint256 executeSeed, uint256 paramSeed, uint8 misbehave) external {
        uint8 mode = misbehave % 3;
        (uint96 index, address agw, bool deployed) = _freeWallet();
        JobInputs memory j = _swapInputs(int256(bound(paramSeed, 1, 1e30)));
        j.principal = bound(principalSeed, 100e6, 1_000e6);
        j.executeBy = uint48(bound(executeSeed, block.timestamp + 10 minutes, j.expiredAt - 2 hours));
        OpenJobParams memory p = _readyAt(cardId, index, _rules(), j);

        if (mode != 0 && !deployed) {
            vm.prank(user);
            factory.deployWalletWithSig(p.intent, "", "");
            deployed = true;
        }
        if (deployed) MockAGW(payable(agw)).setMode(MockAGW.Mode(mode));

        uint256 before = kernel.jobCounter();
        vm.prank(relayer);
        try mkt.openJob(p) returns (uint256 jobId, address, bytes32) {
            if (mode == 0) {
                opened++;
                _record(agw, jobId, j.principal);
            } else {
                misbehaviourAccepted++;
            }
        } catch (bytes memory err) {
            if (mode == 0) {
                honestRefused++;
            } else {
                refused++;
                bytes memory expected = mode == 1
                    ? abi.encodeWithSelector(UniversalMarketplaceErrors.UnexpectedJobCount.selector, before, before + 2)
                    : abi.encodeWithSelector(UniversalMarketplaceErrors.JobMismatch.selector);
                if (keccak256(err) != keccak256(expected)) wrongRefusal++;
            }
        }
        if (deployed) MockAGW(payable(agw)).setMode(MockAGW.Mode.Honest);
    }

    /// @notice One of three providers tries to register a card. A provider who already has one MUST be refused with
    ///         `AgentCardAlreadyRegistered`; one who has none MUST succeed.
    function register(uint256 seed) external {
        address who = providers[seed % providers.length];
        bool had = mkt.agentCardOf(who) != 0;
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(who);
        try mkt.registerAgentCard(c, r, e) returns (uint256) {
            if (had) duplicateCardAccepted++;
        } catch (bytes memory err) {
            bytes memory expected =
                abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardAlreadyRegistered.selector, who);
            if (!had || keccak256(err) != keccak256(expected)) wrongRegistrationRefusal++;
        }
    }

    /// @notice The provider re-publishes the card: same content, next version.
    function update() external {
        AgentCard memory c = _card();
        c.jobType = keccak256("SWAP");
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_swapTemplate());
        vm.prank(provider);
        mkt.updateAgentCard(cardId, c, r, e);
    }

    function cancel(uint256 seed) external {
        if (agws.length == 0) return;
        uint256 id = mkt.activeJobOf(agws[seed % agws.length]);
        if (id == 0 || kernel.getJob(id).status != IAgenticCommerce.JobStatus.Open) return;
        vm.prank(provider);
        kernel.reject(id, bytes32(0), "");
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 10 days));
    }

    /// @dev The user's last wallet if it has no active job, else the next one.
    function _freeWallet() internal view returns (uint96 index, address agw, bool deployed) {
        index = uint96(factory.walletCount(user));
        (agw, deployed) = factory.predictWallet(user, index);
        if (index == 0) return (index, agw, deployed);
        (address last,) = factory.predictWallet(user, index - 1);
        if (mkt.activeJobOf(last) == 0) return (index - 1, last, true);
    }

    function _record(address agw, uint256 jobId, uint256 principal) internal {
        jobs.push(jobId);
        expectedOrigin[jobId] = keccak256(abi.encode(address(mkt), cardId, mkt.agentCardVersion(cardId), principal));
        grantedInitData[jobId] = MockAGW(payable(agw)).lastPolicyInitData();
        grantedPrincipal[jobId] = principal;
        for (uint256 i; i < agws.length; ++i) {
            if (agws[i] == agw) return;
        }
        agws.push(agw);
    }
}

/// @title UniversalMarketplace — invariants (PRD 12 §6.7).
/// @dev 64 runs × depth 100 per invariant (6,400 handler calls each): every call is a full openJob with criteria
///      built on-chain, so the defaults (256 × 500) take far longer.
/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 100
contract UniversalMarketplaceInvariants is Test {
    MarketplaceHandler internal h;
    UniversalMarketplace internal mkt;
    address internal user = makeAddr("userUEA");

    function setUp() public {
        h = new MarketplaceHandler();
        mkt = UniversalMarketplace(h.marketplace());

        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](5);
        sels[0] = MarketplaceHandler.open.selector;
        sels[1] = MarketplaceHandler.update.selector;
        sels[2] = MarketplaceHandler.cancel.selector;
        sels[3] = MarketplaceHandler.warp.selector;
        sels[4] = MarketplaceHandler.register.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    /// @notice An AGW's active job is always 0 or a job that AGW is the client of.
    function invariant_MI01_activeJobIsTheAgwsOwnJob() public view {
        uint256 n = h.agwCount();
        for (uint256 i; i < n; ++i) {
            address agw = h.agws(i);
            uint256 id = mkt.activeJobOf(agw);
            if (id == 0) continue;
            assertEq(h.job(id).client, agw, "activeJobOf points at a job the AGW is not client of");
            assertEq(mkt.agwOfJob(id), agw);
        }
    }

    /// @notice The marketplace never holds the payment token, the rules asset or PC.
    function invariant_MI02_marketplaceHoldsNothing() public view {
        (uint256 tokenBal, uint256 assetBal, uint256 ethBal) = h.balances(address(mkt));
        assertEq(tokenBal, 0);
        assertEq(assetBal, 0);
        assertEq(ethBal, 0);
    }

    /// @notice An honest open on a free wallet always succeeds; a misbehaving wallet is always refused, with
    ///         its own named error.
    function invariant_MI03_outcomesExactlyExpected() public view {
        assertEq(h.honestRefused(), 0, "an honest openJob on a free wallet reverted");
        assertEq(h.misbehaviourAccepted(), 0, "a misbehaving wallet's openJob succeeded");
        assertEq(h.wrongRefusal(), 0, "a misbehaving wallet was refused with the wrong error");
    }

    /// @notice Every opened job carries well-formed criteria with the recorded origin, the configured evaluator
    ///         and hook, and is never Funded (only the test funds, and this handler never does).
    function invariant_MI04_everyJobIsWellFormed() public view {
        uint256 n = h.jobCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.jobs(i);
            IAgenticCommerce.Job memory j = h.job(id);
            JobSpec memory spec = abi.decode(bytes(j.description), (JobSpec));
            assertEq(spec.origin, h.expectedOrigin(id), "origin");
            assertEq(j.evaluator, mkt.evaluator(), "evaluator");
            assertEq(j.hook, mkt.hook(), "hook");
            assertTrue(j.status != IAgenticCommerce.JobStatus.Funded, "funded by nobody");
        }
    }

    /// @notice openJob never moves the user's tokens or PC.
    function invariant_MI05_userBalanceNeverMovedByOpenJob() public view {
        (uint256 tokenBal, uint256 assetBal, uint256 ethBal) = h.balances(user);
        assertEq(tokenBal, h.userTokenStart());
        assertEq(assetBal, h.userAssetStart());
        assertEq(ethBal, h.userEthStart());
    }

    /// @notice One card per provider: `agentCardOf[p]` is 0 or a card whose provider is `p`, and no two cards share
    ///         a provider. A second registration is always refused with its named error.
    function invariant_MI06_onePerProvider() public view {
        uint256 n = mkt.agentCardCount();
        for (uint256 id = 1; id <= n; ++id) {
            address p = mkt.getAgentCard(id).card.provider;
            assertEq(mkt.agentCardOf(p), id, "the card's provider maps back to it");
            for (uint256 other = 1; other < id; ++other) {
                assertTrue(mkt.getAgentCard(other).card.provider != p, "two cards share a provider");
            }
        }
        for (uint256 i; i < 3; ++i) {
            address p = h.providers(i);
            uint256 id = mkt.agentCardOf(p);
            if (id != 0) assertEq(mkt.getAgentCard(id).card.provider, p, "agentCardOf names another provider's card");
        }
        assertEq(h.duplicateCardAccepted(), 0, "a provider registered a second card");
        assertEq(h.wrongRegistrationRefusal(), 0, "a registration was refused with the wrong error");
    }

    /// @notice The rules granted for every opened job cap the principal asset's lifetime total at exactly that
    ///         job's principal (D3).
    function invariant_MI07_principalCapEqualsPrincipal() public view {
        uint8 principalAsset = h.principalAssetOf(h.cardId());
        uint256 n = h.jobCount();
        for (uint256 i; i < n; ++i) {
            uint256 id = h.jobs(i);
            (,, bytes memory body) = abi.decode(h.grantedInitData(id), (uint16, string, bytes));
            UniversalTerms memory t = abi.decode(body, (UniversalTerms));
            assertEq(t.assets[principalAsset].maxTotal, h.grantedPrincipal(id), "maxTotal == principal");
        }
    }

    /// @notice Liveness: the run reached BOTH paths, or every invariant above held vacuously.
    function afterInvariant() public view {
        assertGt(h.opened(), 0, "no honest openJob ever succeeded");
        assertGt(h.refused(), 0, "no misbehaving openJob was ever refused");
    }
}
