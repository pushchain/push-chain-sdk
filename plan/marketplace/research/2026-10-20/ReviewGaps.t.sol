// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Copied into the isolated pinned repository's test/8183-tests for execution.
import {MarketplaceFixtures} from "./UniversalMarketplace.t.sol";
import {UniversalMarketplaceForkTest, IAGWExecute} from "./UniversalMarketplace.fork.t.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {IAGWFactory} from "../../src/agentic-commerce-8183/interfaces/external/IAGWFactory.sol";
import {ISmartSession} from "../../src/agentic-commerce-8183/interfaces/external/ISmartSession.sol";
import {JobInputs, OpenJobParams, JobSpecTemplate} from "../../src/agentic-commerce-8183/libraries/Types.sol";
import {JobSpec, AllowedMutability} from "../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol";

contract ReviewLocalGaps is MarketplaceFixtures {
    function test_review_nonNoneIsAcceptedButReplacementPayloadIsInert() public {
        JobSpecTemplate memory t = _lendingTemplate();
        t.allowedMutability = AllowedMutability.BOTH;
        uint256 id = _register(_card(), _rules(), t);
        (uint256 jobId, address agw) = _open(_ready(id));
        string memory original = kernel.getJob(jobId).description;
        assertEq(uint8(abi.decode(bytes(original), (JobSpec)).allowedMutability), uint8(AllowedMutability.BOTH));
        vm.prank(provider);
        kernel.setBudget(jobId, FEE, hex"deadbeef");
        assertEq(kernel.getJob(jobId).description, original, "interim hook ignores replacement bytes");
        _fund(jobId, agw, FEE);
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Funded));
    }

    function test_review_cardFeeIsReferenceAndFundOnlyChecksAcceptedBudget() public {
        uint256 id = _registerLending();
        (uint256 jobId, address agw) = _open(_ready(id));
        uint256 differentFee = mkt.getAgentCard(id).card.providerFee * 3;
        _budgetAndFund(jobId, agw, differentFee);
        assertEq(kernel.getJob(jobId).budget, differentFee);
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Funded));
    }
}

contract ReviewRealAgwCancellation is UniversalMarketplaceForkTest {
    struct Execution { address target; uint256 value; bytes callData; }

    function _reviewOpen() internal returns (uint256 cardId, uint96 index, uint256 jobId, address agw, bytes32 rulesId) {
        vm.createSelectFork("https://evm.donut.rpc.push.org/", 24447347);
        _deploy();
        vm.prank(provider);
        cardId = mkt.registerAgentCard(_card(), abi.encode(_rules()), abi.encode(_lendingTemplate()));
        index = uint96(IAGWFactory(FACTORY).walletCount(owner));
        (agw,) = IAGWFactory(FACTORY).predictWallet(owner, index);
        JobInputs memory job = _inputs();
        OpenJobParams memory p = _signed(cardId, index, _sessionFor(agw, job), job);
        vm.prank(relayer);
        (jobId,,rulesId) = mkt.openJob(p);
    }

    function test_review_cancelFreesWalletButOldAndNewGrantsBothRemainLive() public {
        (uint256 cardId, uint96 index, uint256 jobId, address agw, bytes32 oldId) = _reviewOpen();
        _ownerExecute(agw, address(kernel), abi.encodeCall(IAgenticCommerce.reject, (jobId, bytes32(0), bytes(""))));
        assertEq(mkt.activeJobOf(agw), 0, "cancel frees marketplace slot");
        assertTrue(ISmartSession(ENGINE).isPermissionEnabled(oldId, agw), "cancel does not revoke authority");
        JobInputs memory job = _inputs();
        OpenJobParams memory again = _signed(cardId, index, _sessionFor(agw, job), job);
        vm.prank(relayer);
        (,,bytes32 newId) = mkt.openJob(again);
        assertTrue(newId != oldId);
        assertTrue(ISmartSession(ENGINE).isPermissionEnabled(oldId, agw));
        assertTrue(ISmartSession(ENGINE).isPermissionEnabled(newId, agw));
    }

    function test_review_ownerCanAtomicallyCancelAndRevokeWithoutNewAgwRole() public {
        (,,uint256 jobId, address agw, bytes32 rulesId) = _reviewOpen();
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(address(kernel), 0, abi.encodeCall(IAgenticCommerce.reject, (jobId, bytes32(0), bytes(""))));
        calls[1] = Execution(agw, 0, abi.encodeWithSignature("revokeRules(bytes32)", rulesId));
        vm.prank(owner);
        IAGWExecute(agw).execute(bytes32(bytes1(0x01)), abi.encode(calls));
        assertEq(uint8(kernel.getJob(jobId).status), uint8(IAgenticCommerce.JobStatus.Rejected));
        assertEq(mkt.activeJobOf(agw), 0);
        assertFalse(ISmartSession(ENGINE).isPermissionEnabled(rulesId, agw));
    }
}
