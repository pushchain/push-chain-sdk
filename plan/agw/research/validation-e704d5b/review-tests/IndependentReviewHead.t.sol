// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// REVIEW-ONLY EXPERIMENT. Not part of the contract repository. Written for the independent review of the
// AGW SDK planning package (push-chain-sdk/plan/agw/independent-review/). Runs against
// push-agentic-wallets@0f279ca02242dfd8067ff716d24cad4b97bf29cb (nomenclature-changes head, 2026-10-02),
// in an isolated scratch copy. Inherits the repository's E2E harness; the gateway is the repository's
// recording mock, so nothing here proves token pull/burn, settlement, or a real UEA transport.

import { E2ETest } from "../integration/8_e2e.t.sol";
import { AGW } from "../../src/AGW.sol";
import { IAGW } from "../../src/interfaces/IAGW.sol";
import { AGWErrors, UniversalRulesPolicyErrors } from "../../src/libraries/Errors.sol";
import { Execution, ExecutionLib } from "../../src/libraries/ExecutionLib.sol";
import { ModeCode, ModeLib } from "../../src/libraries/ModeLib.sol";
import { AllowedCall, Config, RulesType } from "../../src/libraries/Types.sol";
import { Session, PermissionId, ConfigId } from "smartsessions/DataTypes.sol";
import { StakeDummy } from "../mocks/StakeDummy.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";

contract IndependentReviewHeadTest is E2ETest {
    string internal constant SEPOLIA = "eip155:11155111";

    // ───────────────────────────── helpers ─────────────────────────────

    function _replacement() internal view returns (Session memory) {
        return canonicalSession(agentConfig(agentAddr), _urpConfig());
    }

    /// @dev The rules id derived WITHOUT the engine: keccak256(abi.encode(validator, abi.encode(agent), salt)),
    ///      salt = bytes32(grantNonce). Independent of the wallet and of the chain.
    function _formulaId(address agent, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(address(validator), abi.encode(agent), bytes32(nonce)));
    }

    function _replace(AGW w, bytes memory assertCall, bytes32 oldId, Session memory s) internal {
        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(address(urp), 0, assertCall);
        calls[1] = Execution(address(w), 0, abi.encodeCall(AGW.revokeRules, (oldId)));
        calls[2] = Execution(address(w), 0, abi.encodeCall(AGW.grantRules, (s)));
        vm.prank(BOB_UEA);
        w.execute(ModeCode.unwrap(ModeLib.encodeSimpleBatch()), ExecutionLib.encodeBatch(calls));
    }

    function _assertUniversal(bytes32 pid, uint256 expected) internal view returns (bytes memory) {
        return abi.encodeWithSignature("assertSpent(bytes32,address,uint256)", _configId(pid), address(bobAgw), expected);
    }

    function _urpConfigWithExpiry(uint48 validUntil) internal view returns (bytes memory) {
        AllowedCall[] memory rules = new AllowedCall[](1);
        rules[0] = AllowedCall({
            target: MORPHO_BLUE,
            selector: SUPPLY_SELECTOR,
            beneficiaryOffset: BENEFICIARY_OFFSET,
            hasBeneficiary: true,
            maxValue: 0
        });
        return universalInitData(
            Config({
                initialized: false,
                validUntil: validUntil,
                destChainHash: bytes32(0),
                expectedCEA: BOB_AGW_CEA,
                asset: address(pUSDC),
                maxAmountPerCall: HUNDRED_USDC,
                maxAmountTotal: HUNDRED_USDC,
                maxPCPerCall: 1 ether,
                spent: 0,
                allowedCalls: rules
            })
        );
    }

    // ───────────────────── 1. successful replacement (new door) ─────────────────────

    /// Owner batch assert → revoke → grant. Beyond the 610a640 experiment: the predicted id is derived from
    /// the formula (not the engine), events are checked in order, the new id is USABLE by the agent, and
    /// the replaced id is DEAD at the sender-gated door.
    function test_ReviewHead_Replace_NewIdUsable_OldIdDead() public {
        _deployAndGrant();
        bytes32 oldId = permissionId;
        assertEq(oldId, _formulaId(agentAddr, 0), "grant 0 id matches the off-chain formula");

        _submitRequest(_executionCalldata(10e6, 0));
        assertEq(_spent(oldId), 10e6);

        bytes32 next = _formulaId(agentAddr, 1);

        vm.expectEmit(true, false, false, true, address(bobAgw));
        emit IAGW.RulesRevoked(oldId);
        vm.expectEmit(true, true, false, true, address(bobAgw));
        emit IAGW.RulesGranted(next, RulesType.UNIVERSAL, keccak256(bytes(SEPOLIA)), SEPOLIA);
        _replace(bobAgw, _assertUniversal(oldId, 10e6), oldId, _replacement());

        assertFalse(engine.isPermissionEnabled(PermissionId.wrap(oldId), address(bobAgw)), "old disabled");
        assertTrue(engine.isPermissionEnabled(PermissionId.wrap(next), address(bobAgw)), "new enabled");
        assertEq(bobAgw.agentOf(oldId), address(0), "old id names no agent");
        assertEq(bobAgw.agentOf(next), agentAddr, "new id names the agent");
        assertTrue(urp.getMode(_configId(next), address(bobAgw)).initialized, "new config really initialised");
        assertEq(_spent(next), 0, "new counter starts at zero");
        assertEq(_spent(oldId), 10e6, "old counter retained in URP storage");
        assertEq(bobAgw.grantNonce(), 2);

        // Stale id after replacement: refused at the door, before the engine.
        vm.prank(agentAddr);
        vm.expectRevert(abi.encodeWithSelector(AGWErrors.CallerIsNotAgent.selector, oldId, agentAddr));
        bobAgw.executeAsAgent(oldId, _singleMode(), _executionCalldata(1e6, 0));

        // New id works and meters from zero.
        vm.prank(agentAddr);
        bobAgw.executeAsAgent(next, _singleMode(), _executionCalldata(10e6, 0));
        assertEq(_spent(next), 10e6, "new id meters");
    }

    // ───────────── 2. failure INSIDE the engine/URP rolls back revoke and nonce ─────────────

    /// The 610a640 experiment failed at the wallet's shape check, before `_grantNonce++` and before the
    /// engine was touched. Here the replacement fails inside URP's init (expiry not in the future), i.e.
    /// AFTER the wallet advanced its nonce and mid-way through the engine's enable. grantNonce == 1 is
    /// therefore a real rollback witness, not a value that would hold anyway.
    function test_ReviewHead_UrpInitFailure_RollsBackRevokeAndNonce() public {
        _deployAndGrant();
        bytes32 oldId = permissionId;

        Session memory bad = canonicalSession(agentConfig(agentAddr), _urpConfigWithExpiry(uint48(block.timestamp)));
        bytes memory assertion = _assertUniversal(oldId, 0);
        vm.expectRevert(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.InvalidExpiry.selector, uint48(block.timestamp))
        );
        _replace(bobAgw, assertion, oldId, bad);

        assertTrue(engine.isPermissionEnabled(PermissionId.wrap(oldId), address(bobAgw)), "old still enabled");
        assertEq(bobAgw.agentOf(oldId), agentAddr, "old still names the agent");
        assertEq(bobAgw.grantNonce(), 1, "nonce advance rolled back");
        assertEq(engine.getPermissionIDs(address(bobAgw)).length, 1, "no half-enabled session left");

        _submitRequest(_executionCalldata(10e6, 0));
        assertEq(_spent(oldId), 10e6, "old rule still usable");
    }

    // ─────────────── 3. stale spend assertion after an intervening agent action ───────────────

    function test_ReviewHead_InterveningAgentSpend_BlocksReplacement() public {
        _deployAndGrant();
        bytes32 oldId = permissionId;
        uint256 observed = _spent(oldId);

        Session memory s = _replacement();
        bytes memory assertion = _assertUniversal(oldId, observed); // composed against the observed spend

        _submitRequest(_executionCalldata(10e6, 0)); // lands between composition and submission

        vm.expectRevert(abi.encodeWithSelector(UniversalRulesPolicyErrors.SpentMismatch.selector, observed, 10e6));
        _replace(bobAgw, assertion, oldId, s);

        assertTrue(engine.isPermissionEnabled(PermissionId.wrap(oldId), address(bobAgw)));
        assertFalse(engine.isPermissionEnabled(PermissionId.wrap(_formulaId(agentAddr, 1)), address(bobAgw)));
        assertEq(_spent(oldId), 10e6);
        assertEq(bobAgw.grantNonce(), 1);
    }

    // ───────────── 4. what survives revocation (read-model evidence) ─────────────

    /// After revoke: enumeration drops the id, the engine clears the agent config, `agentOf` is zero, but
    /// URP terms and counters remain readable. The agent of a revoked rule is therefore NOT recoverable
    /// from state, and `RulesGranted` does not carry it either.
    function test_ReviewHead_Revoke_ErasesAgentKeepsTerms() public {
        _deployAndGrant();
        bytes32 id = permissionId;
        (address v0, bytes memory cfg0) = engine.getSessionValidatorAndConfig(address(bobAgw), PermissionId.wrap(id));
        assertEq(v0, address(validator));
        assertEq(keccak256(cfg0), keccak256(abi.encode(agentAddr)));
        assertEq(engine.getEnabledActions(address(bobAgw), PermissionId.wrap(id)).length, 1);

        vm.prank(BOB_UEA);
        bobAgw.revokeRules(id);

        assertEq(engine.getPermissionIDs(address(bobAgw)).length, 0, "enumeration drops it");
        assertEq(engine.getEnabledActions(address(bobAgw), PermissionId.wrap(id)).length, 0, "actions dropped");
        (address v1, bytes memory cfg1) = engine.getSessionValidatorAndConfig(address(bobAgw), PermissionId.wrap(id));
        assertEq(v1, address(0), "validator cleared");
        assertEq(cfg1.length, 0, "agent config cleared");
        assertEq(bobAgw.agentOf(id), address(0), "agentOf erased");
        assertTrue(urp.getMode(_configId(id), address(bobAgw)).initialized, "URP config persists");
        assertEq(urp.getConfig(_configId(id), address(bobAgw)).asset, address(pUSDC), "terms still readable");
    }

    // ─────────────── 5. one-rule-per-(agent, chain) is NOT enforced on-chain ───────────────

    function test_ReviewHead_DuplicateAgentChainGrants_BothLive() public {
        _deployAndGrant();
        bytes32 first = permissionId;

        vm.prank(BOB_UEA);
        bytes32 second = bobAgw.grantRules(_replacement()); // same agent, same chain, same terms

        assertTrue(first != second);
        assertEq(engine.getPermissionIDs(address(bobAgw)).length, 2, "both enabled");
        assertEq(bobAgw.agentOf(first), agentAddr);
        assertEq(bobAgw.agentOf(second), agentAddr);

        // The agent can act under either; each has its own budget.
        vm.prank(agentAddr);
        bobAgw.executeAsAgent(first, _singleMode(), _executionCalldata(HUNDRED_USDC, 0));
        vm.prank(agentAddr);
        bobAgw.executeAsAgent(second, _singleMode(), _executionCalldata(HUNDRED_USDC, 0));
        assertEq(_spent(first), HUNDRED_USDC);
        assertEq(_spent(second), HUNDRED_USDC);
    }

    // ─────────────── 6. rules id: wallet-independent and chain-free ───────────────

    /// The same agent at the same grant nonce yields the SAME rules id on two different wallets, and the
    /// chain is not an input. So `rulesId` is unique only per wallet, and a helper keyed on
    /// (agent, chainNamespace, grantNonce) cannot be the contract's formula.
    function test_ReviewHead_RulesId_NotGloballyUnique_ChainNotAnInput() public {
        _deployAndGrant(); // bobAgw (BOB_UEA, index 0), universal on Sepolia, nonce 0
        (AGW w2,,, bytes32 nativeId) = _deployAndGrantNative(); // BOB_UEA index 1, NATIVE rule, nonce 0

        assertTrue(address(w2) != address(bobAgw));
        assertEq(permissionId, nativeId, "same id across wallets and across chains");
        assertEq(nativeId, _formulaId(agentAddr, 0));
        assertEq(
            nativeId,
            PermissionId.unwrap(engine.getPermissionId(_replacement())),
            "engine view agrees when salt = 0 (wallet overwrites salt with its grant nonce)"
        );
    }

    // ─────────────── 7. native replacement with the three-counter assertion ───────────────

    function test_ReviewHead_NativeReplace_ThreeCounterAssertion() public {
        (AGW w, StakeDummy stake,, bytes32 oldId) = _deployAndGrantNative();

        vm.prank(agentAddr);
        w.executeAsAgent(
            oldId,
            _singleMode(),
            ExecutionLib.encodeSingle(address(stake), 0, abi.encodeCall(StakeDummy.stakeFor, (address(w), 10e6)))
        );

        ConfigId cid = _configIdNative(oldId, address(stake), address(w));
        bytes memory staleAssert = abi.encodeWithSignature(
            "assertSpent(bytes32,address,uint256,uint256,uint32)", cid, address(w), uint256(0), uint256(10e6), uint32(0)
        );
        Session memory s = _nativeSessionFor(stake, address(w));
        vm.expectRevert(abi.encodeWithSelector(UniversalRulesPolicyErrors.SpentMismatch.selector, uint256(0), uint256(1)));
        _replace(w, staleAssert, oldId, s);

        bytes memory goodAssert = abi.encodeWithSignature(
            "assertSpent(bytes32,address,uint256,uint256,uint32)", cid, address(w), uint256(0), uint256(10e6), uint32(1)
        );
        _replace(w, goodAssert, oldId, s);

        bytes32 next = _formulaId(agentAddr, 1);
        assertFalse(engine.isPermissionEnabled(PermissionId.wrap(oldId), address(w)));
        assertTrue(engine.isPermissionEnabled(PermissionId.wrap(next), address(w)));
        assertEq(urp.getNativeConfig(_configIdNative(next, address(stake), address(w)), address(w)).callsUsed, 0);
        assertEq(urp.getNativeConfig(cid, address(w)).amountSpent, 10e6, "old counters retained");
    }
}
