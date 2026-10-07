// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseTest } from "../Base.t.sol";
import { PermissivePolicy } from "./4_agentDoor.t.sol";
import { AGW } from "../../src/AGW.sol";
import { IAGW } from "../../src/interfaces/IAGW.sol";
import { IAGWFactory } from "../../src/interfaces/IAGWFactory.sol";
import { AGWErrors } from "../../src/libraries/Errors.sol";
import { ModeLib, ModeCode } from "../../src/libraries/ModeLib.sol";
import { ExecutionLib, Execution } from "../../src/libraries/ExecutionLib.sol";
import { OwnerIntent, MAX_LABEL_BYTES } from "../../src/libraries/Types.sol";
import { Session, PermissionId } from "smartsessions/DataTypes.sol";

/**
 * @title  Wallet label — L01–L13 (PRD `docs-internal/sdk-first-changes/L-wallet-label_prd.md`).
 * @notice The label is stored on the wallet, editable by the owner, capped at `MAX_LABEL_BYTES` bytes,
 *         and reads as `AGW <index + 1>` (the factory's per-owner index) while none is set.
 */
contract WalletLabelTest is BaseTest {
    address internal ownerAddr;
    uint256 internal ownerPk;
    address internal EXECUTOR;
    AGW internal wallet;

    function setUp() public override {
        super.setUp();
        (ownerAddr, ownerPk) = ecdsaKey("labelOwner");
        EXECUTOR = makeAddr("executor");
        wallet = newWallet(ownerAddr);
    }

    // ─────────────────────────────── helpers ───────────────────────────────

    function _single() internal pure returns (bytes32) {
        return ModeCode.unwrap(ModeLib.encodeSimpleSingle());
    }

    function _batch() internal pure returns (bytes32) {
        return ModeCode.unwrap(ModeLib.encodeSimpleBatch());
    }

    function _setLabelCall(string memory l) internal pure returns (bytes memory) {
        return abi.encodeCall(AGW.setLabel, (l));
    }

    /// @dev A string of `n` copies of `unit`.
    function _repeat(string memory unit, uint256 n) internal pure returns (string memory out) {
        for (uint256 i; i < n; ++i) {
            out = string.concat(out, unit);
        }
    }

    // ═══════════════════════════════════ L01 ═══════════════════════════════════

    /// The default is `AGW <index + 1>`, numbered per owner.
    function test_L01_DefaultIsAGWIndexPlusOne() public {
        assertEq(wallet.label(), "AGW 1", "owner A, index 0");
        AGW second = newWallet(ownerAddr);
        assertEq(second.label(), "AGW 2", "owner A, index 1");
        assertEq(wallet.label(), "AGW 1", "the first is unaffected");

        AGW bobs = newWallet(makeAddr("bob"));
        assertEq(bobs.label(), "AGW 1", "owner B counts from 1 on their own index");
    }

    // ═══════════════════════════════════ L02 ═══════════════════════════════════

    /// A label passed at deploy is stored, and `WalletDeployed` still carries it.
    function test_L02_DeployLabelIsStored() public {
        (address predicted, uint96 index) = nextWallet(ownerAddr);
        vm.expectEmit(true, true, true, true, FACTORY);
        emit IAGWFactory.WalletDeployed(ownerAddr, index, predicted, "prediction-market-account");

        vm.prank(ownerAddr);
        AGW w = AGW(payable(factory.deployWallet("prediction-market-account")));

        assertEq(address(w), predicted, "deployed at the predicted address");
        assertEq(w.label(), "prediction-market-account", "stored");
    }

    // ═══════════════════════════════════ L03 ═══════════════════════════════════

    /// The owner sets a label: stored, `LabelSet` emitted, no checkpoint.
    function test_L03_OwnerSetsLabel() public {
        uint64 before = wallet.checkpointCount();

        vm.expectEmit(false, false, false, true, address(wallet));
        emit IAGW.LabelSet("x");
        vm.prank(ownerAddr);
        wallet.setLabel("x");

        assertEq(wallet.label(), "x", "stored");
        assertEq(wallet.checkpointCount(), before, "a rename is not a checkpoint");
    }

    // ═══════════════════════════════════ L04 ═══════════════════════════════════

    /// `""` resets to the default, and the event carries the empty string.
    function test_L04_EmptyResetsToDefault() public {
        vm.prank(ownerAddr);
        wallet.setLabel("x");

        vm.expectEmit(false, false, false, true, address(wallet));
        emit IAGW.LabelSet("");
        vm.prank(ownerAddr);
        wallet.setLabel("");

        assertEq(wallet.label(), "AGW 1", "back to the default");
    }

    // ═══════════════════════════════════ L05 ═══════════════════════════════════

    /// Nobody but the owner (or the wallet itself) can rename.
    function test_L05_NonOwnerRefused() public {
        address[3] memory callers = [AGENT, makeAddr("stranger"), FACTORY];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(AGWErrors.CallerIsNotOwner.selector);
            wallet.setLabel("hijacked");
        }
        assertEq(wallet.label(), "AGW 1", "unchanged");
    }

    // ═══════════════════════════════════ L06 ═══════════════════════════════════

    /// A rename through the owner door works; only the owner-door calls tick, `setLabel` adds nothing.
    function test_L06_RenameThroughExecute() public {
        uint64 c0 = wallet.checkpointCount();

        vm.prank(ownerAddr);
        wallet.execute(_single(), ExecutionLib.encodeSingle(address(wallet), 0, _setLabelCall("one")));
        assertEq(wallet.label(), "one", "single");
        assertEq(wallet.checkpointCount(), c0 + 1, "one owner-door call, one tick");

        Execution[] memory batch = new Execution[](2);
        batch[0] = Execution({ target: address(wallet), value: 0, callData: _setLabelCall("two") });
        batch[1] = Execution({ target: address(wallet), value: 0, callData: _setLabelCall("three") });
        vm.prank(ownerAddr);
        wallet.execute(_batch(), ExecutionLib.encodeBatch(batch));
        assertEq(wallet.label(), "three", "the last entry wins");
        assertEq(wallet.checkpointCount(), c0 + 3, "two batch entries, two ticks - none from setLabel");
    }

    // ═══════════════════════════════════ L07 ═══════════════════════════════════

    /// A relayer renames on the owner's signature (the UEA owner's route).
    function test_L07_RenameThroughExecuteWithSig() public {
        bytes memory ecd = ExecutionLib.encodeSingle(address(wallet), 0, _setLabelCall("relayed"));
        OwnerIntent memory i = blankIntent(ownerAddr, address(wallet), EXECUTOR);
        i.mode = _single();
        i.execCalldataHash = keccak256(ecd);
        i.nonceSeq = wallet.getNonce(i.nonceKey);
        bytes memory sig = signIntent(ownerPk, i);

        vm.prank(EXECUTOR);
        wallet.executeWithSig(_single(), ecd, i, sig);

        assertEq(wallet.label(), "relayed", "stored via the signed owner door");
    }

    // ═══════════════════════════════════ L08 ═══════════════════════════════════

    /// The agent door cannot reach `setLabel`, even under a session enabled directly on the engine
    /// with a policy that approves everything: the dispatch guard refuses the wallet as a target.
    function test_L08_AgentDoorCannotRename() public {
        PermissivePolicy permissive = new PermissivePolicy();
        Session memory bypass = sessionWithPolicy(address(permissive), agentConfig(AGENT), "");
        bypass.actions[0].actionTarget = address(wallet);
        bypass.actions[0].actionTargetSelector = AGW.setLabel.selector;
        Session[] memory arr = new Session[](1);
        arr[0] = bypass;
        vm.prank(address(wallet));
        bytes32 pid = PermissionId.unwrap(engine.enableSessions(arr)[0]);

        bytes memory ecd = ExecutionLib.encodeSingle(address(wallet), 0, _setLabelCall("agent-was-here"));
        vm.prank(AGENT);
        vm.expectRevert(abi.encodeWithSelector(AGWErrors.ForbiddenDispatchTarget.selector, address(wallet)));
        wallet.executeAsAgent(pid, _single(), ecd);

        assertEq(wallet.label(), "AGW 1", "unchanged");
    }

    // ═══════════════════════════════════ L09 ═══════════════════════════════════

    /// 64 bytes is the cap, on the setter and on the deploy path alike.
    function test_L09_MaxLength() public {
        string memory atCap = _repeat("a", MAX_LABEL_BYTES);
        string memory overCap = _repeat("a", MAX_LABEL_BYTES + 1);

        vm.prank(ownerAddr);
        wallet.setLabel(atCap);
        assertEq(wallet.label(), atCap, "64 bytes is accepted");

        vm.prank(ownerAddr);
        vm.expectRevert(abi.encodeWithSelector(AGWErrors.LabelTooLong.selector, MAX_LABEL_BYTES + 1));
        wallet.setLabel(overCap);
        assertEq(wallet.label(), atCap, "a refused rename leaves the old label");

        // The deploy path: the wallet's revert bubbles through the factory with full data, and the
        // whole deploy unwinds — the owner's count does not move.
        uint256 countBefore = factory.walletCount(ownerAddr);
        vm.prank(ownerAddr);
        vm.expectRevert(abi.encodeWithSelector(AGWErrors.LabelTooLong.selector, MAX_LABEL_BYTES + 1));
        factory.deployWallet(overCap);
        assertEq(factory.walletCount(ownerAddr), countBefore, "no wallet deployed");
    }

    // ═══════════════════════════════════ L10 ═══════════════════════════════════

    /// The cap counts BYTES: sixteen 4-byte characters fit, seventeen do not.
    function test_L10_LengthIsBytesNotChars() public {
        string memory fourByteChar = unicode"🙂";
        assertEq(bytes(fourByteChar).length, 4, "fixture: a 4-byte UTF-8 character");

        vm.prank(ownerAddr);
        wallet.setLabel(_repeat(fourByteChar, 16));
        assertEq(wallet.label(), _repeat(fourByteChar, 16), "64 bytes, 16 characters");

        vm.prank(ownerAddr);
        vm.expectRevert(abi.encodeWithSelector(AGWErrors.LabelTooLong.selector, 68));
        wallet.setLabel(_repeat(fourByteChar, 17));
    }

    // ═══════════════════════════════════ L11 ═══════════════════════════════════

    /// KNOWN LIMITATION, pinned: the label is not part of the owner's signature, so the relayer of a
    /// `deployWalletWithSig` chooses it. Cosmetic; the owner can rename with `setLabel`.
    function test_L11_SignedDeployLabelIsUnsigned() public {
        address owner2;
        uint256 pk2;
        (owner2, pk2) = ecdsaKey("signedDeployOwner");
        (address predicted, uint96 index) = nextWallet(owner2);
        OwnerIntent memory i = blankIntent(owner2, predicted, EXECUTOR);
        i.index = index;
        bytes memory sig = signIntent(pk2, i);

        vm.prank(EXECUTOR);
        AGW w = AGW(payable(factory.deployWalletWithSig(i, sig, "relayer-chose-this")));

        assertEq(w.label(), "relayer-chose-this", "the relayer's label is stored");

        vm.prank(owner2);
        w.setLabel("");
        assertEq(w.label(), "AGW 1", "and the owner can reset it");
    }

    // ═══════════════════════════════════ L12 ═══════════════════════════════════

    /// Any 1..64-byte label round-trips unchanged.
    function testFuzz_L12_RoundTrip(bytes memory raw) public {
        vm.assume(raw.length != 0);
        uint256 n = raw.length > MAX_LABEL_BYTES ? MAX_LABEL_BYTES : raw.length;
        bytes memory b = new bytes(n);
        for (uint256 k; k < n; ++k) {
            b[k] = raw[k];
        }

        vm.prank(ownerAddr);
        wallet.setLabel(string(b));
        assertEq(bytes(wallet.label()), b, "round-trip");
    }

    // ═══════════════════════════════════ L13 ═══════════════════════════════════

    /// The default follows the owner's own index, not how many wallets the factory has deployed.
    function test_L13_DefaultFollowsIndexNotGlobalCount() public {
        AGW bobs = newWallet(makeAddr("bob"));
        AGW second = newWallet(ownerAddr);

        assertEq(wallet.label(), "AGW 1", "A's first");
        assertEq(bobs.label(), "AGW 1", "B's first");
        assertEq(second.label(), "AGW 2", "A's second is AGW 2, not AGW 3");
    }
}
