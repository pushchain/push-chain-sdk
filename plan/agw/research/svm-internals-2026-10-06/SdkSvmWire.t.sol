// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BaseTest } from "../test/Base.t.sol";
import { AGW } from "../src/AGW.sol";
import { UniversalRulesPolicyErrors } from "../src/libraries/Errors.sol";
import { ConfigId, Session } from "smartsessions/DataTypes.sol";
import { SvmConfig, UniversalOutboundTxRequest } from "../src/libraries/Types.sol";
import { IUniversalGatewayPC } from "../src/interfaces/IUniversalGatewayPC.sol";

contract SdkSvmAsset {
    function SOURCE_CHAIN_NAMESPACE() external pure returns (string memory) { return "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; }
}
contract SdkSvmGatewayObserver {
    uint256 public calls;
    function sendUniversalTxOutbound(UniversalOutboundTxRequest calldata) external payable { calls++; }
}
/** Review-only. SDK emits bytes; actual AGW/engine/URP decide acceptance. No RPC/server/ffi. */
contract SdkSvmWireTest is BaseTest {
    string private vectors;
    AGW private wallet;
    bytes32 private rid;
    ConfigId private cid;
    bytes32 private constant PROGRAM = 0x3333333333333333333333333333333333333333333333333333333333333333;
    address private constant ASSET = address(0x7070);
    function setUp() public override {
        super.setUp();
        vectors = vm.readFile("sdk-harness/sdk-vectors.json");
        vm.etch(ASSET, address(new SdkSvmAsset()).code);
        vm.etch(GATEWAY, address(new SdkSvmGatewayObserver()).code);
        wallet = newWallet(OWNER);
        _grant(".initData");
        vm.deal(address(wallet), 1 ether);
    }
    function _grant(string memory key) private {
        Session memory s = canonicalSession(abi.encode(AGENT), vm.parseJsonBytes(vectors, key));
        vm.prank(OWNER); rid = wallet.grantRules(s);
        bytes32 actionId = keccak256(abi.encodePacked(GATEWAY, SEND_OUTBOUND_SELECTOR));
        cid = ConfigId.wrap(keccak256(abi.encodePacked(address(wallet), keccak256(abi.encodePacked(rid, actionId)))));
    }
    function _data(string memory key, bytes32 recipient, uint256 amount) private view returns (bytes memory) {
        UniversalOutboundTxRequest memory r = UniversalOutboundTxRequest({ recipient: abi.encodePacked(recipient), token: ASSET, amount: amount, gasLimit: 200_000, gasPrice: 0, maxPCForGas: 1e15, payload: vm.parseJsonBytes(vectors, key), revertRecipient: address(wallet) });
        return abi.encodeCall(IUniversalGatewayPC.sendUniversalTxOutbound, (r));
    }
    function _run(string memory key, bytes32 recipient, uint256 amount) private {
        bytes memory data = abi.encodePacked(GATEWAY, uint256(1.1e15), _data(key, recipient, amount));
        vm.prank(AGENT); wallet.executeAsAgent(rid, bytes32(0), data);
    }
    function test_SdkSvm_EncodedTermsMatchStoredPinsAndAssets() public view {
        SvmConfig memory c = urp.getSvmConfig(cid, address(wallet));
        assertTrue(c.initialized); assertEq(c.assets.length, 1); assertEq(c.assets[0].token, ASSET);
        assertEq(c.ceaAccounts.length, 2); assertEq(c.pins.length, 2); assertEq(c.dataPins.length, 1);
        assertEq(c.dataPins[0].num, 9); assertEq(c.dataPins[0].den, 10);
    }
    function test_SdkSvm_ValidPayloadPassesAndMeters() public {
        _run(".valid", PROGRAM, 5);
        assertEq(urp.getSvmConfig(cid, address(wallet)).assets[0].spent, 5);
        assertEq(SdkSvmGatewayObserver(GATEWAY).calls(), 1);
    }
    function test_SdkSvm_AccountSubstitutionFails() public {
        expectUrpGate(UniversalRulesPolicyErrors.SvmAccountPinMismatch.selector); _run(".badPin", PROGRAM, 5);
    }
    function test_SdkSvm_ProtectedAccountAliasFails() public {
        expectUrpGate(UniversalRulesPolicyErrors.CeaAccountAtUnpinnedIndex.selector); _run(".alias", PROGRAM, 5);
    }
    function test_SdkSvm_RatioFloorFailsWithoutSpend() public {
        expectUrpGate(UniversalRulesPolicyErrors.SvmDataRatioNotMet.selector); _run(".badRatio", PROGRAM, 5);
        assertEq(urp.getSvmConfig(cid, address(wallet)).assets[0].spent, 0);
    }
    function test_SdkSvm_RecipientMismatchFails() public {
        expectUrpGate(UniversalRulesPolicyErrors.RecipientTargetMismatch.selector); _run(".valid", bytes32(uint256(7)), 5);
    }
    function test_SdkSvm_TrailingPayloadFails() public {
        expectUrpGate(UniversalRulesPolicyErrors.MalformedSvmPayload.selector); _run(".trailing", PROGRAM, 5);
    }
    function test_SdkSvm_NonExecuteFails() public {
        expectUrpGate(UniversalRulesPolicyErrors.SvmInstructionNotExecute.selector); _run(".wrongId", PROGRAM, 5);
    }
    function test_SdkSvm_U64OverflowFails() public {
        expectUrpGate(abi.encodeWithSelector(UniversalRulesPolicyErrors.AmountExceedsU64.selector, uint256(type(uint64).max) + 1)); _run(".valid", PROGRAM, uint256(type(uint64).max) + 1);
    }
    function test_SdkSvm_DatalessOnlyEmptyData() public {
        _grant(".datalessInitData"); _run(".datalessPayload", PROGRAM, 0);
        expectUrpGate(abi.encodeWithSelector(UniversalRulesPolicyErrors.ProgramNotAllowed.selector, PROGRAM, bytes8(0x0100000000000000))); _run(".valid", PROGRAM, 0);
    }
}
