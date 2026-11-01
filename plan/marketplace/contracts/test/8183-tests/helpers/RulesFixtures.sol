// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    AssetCap,
    AllowedCall,
    ArgPin,
    PinOp,
    UniversalTerms,
    ENVELOPE_VERSION
} from "@push-agw/libraries/Types.sol";
import {
    Session,
    ActionData,
    PolicyData,
    ERC7739Data,
    ERC7739Context
} from "../../../src/agentic-commerce-8183/interfaces/external/IAGW.sol";
import {AgentCardRules, MARKER_WALLET, MARKER_PRINCIPAL} from "../../../src/agentic-commerce-8183/libraries/Types.sol";

/// @notice The session fields the marketplace never checks and the AGW pins at `grantRules`. Unit suites pass test
///         values; the fork suite passes the real AGW v6 ones.
struct SessionSkeleton {
    address validator;
    address actionTarget;
    bytes4 actionSelector;
    address policy;
}

/// @title RulesFixtures — TEST ONLY: card rules, and the session the SDK builds from them (PRD 12 §6.1, Appendix E).
/// @notice `_fillTerms` plays the SDK: it copies the card's rules into `UniversalTerms` and fills the markers for one
///         job. Everything here is pure; deep copies throughout, so editing a filled session never edits the card.
abstract contract RulesFixtures {
    string internal constant SEPOLIA = "eip155:11155111";
    bytes32 internal constant SEPOLIA_HASH = keccak256("eip155:11155111");

    bytes4 internal constant SUPPLY = bytes4(keccak256("supply(address,uint256,address,uint16)"));
    bytes4 internal constant TRANSFER = 0xa9059cbb;
    bytes4 internal constant APPROVE = 0x095ea7b3;
    bytes4 internal constant TRANSFER_FROM = 0x23b872dd;
    bytes4 internal constant INCREASE_ALLOWANCE = 0x39509351;

    // ───────── card rules ─────────

    /// @dev One asset (the principal, both caps the marker) and three calls: `approve(pool, ≤ principal)`,
    ///      `pool.supply(_, _, onBehalfOf = wallet, _)`, `transfer(wallet, _)` by the beneficiary field.
    function _cardRules(address usdcPrc20, address usdcDest, address pool)
        internal
        pure
        returns (AgentCardRules memory r)
    {
        r.assets = new AssetCap[](1);
        r.assets[0] =
            AssetCap({token: usdcPrc20, maxPerCall: uint256(MARKER_PRINCIPAL), maxTotal: uint256(MARKER_PRINCIPAL)});
        r.principalAsset = 0;
        r.maxGasPerCall = 1e18;
        r.allowedCalls = new AllowedCall[](3);
        ArgPin[] memory approvePins = new ArgPin[](2);
        approvePins[0] = _pin(4, PinOp.EQ, _word(pool));
        approvePins[1] = _pin(36, PinOp.MAX, MARKER_PRINCIPAL);
        r.allowedCalls[0] = _allowed(usdcDest, APPROVE, 0, false, approvePins);
        r.allowedCalls[1] = _allowed(pool, SUPPLY, 0, false, _pins1(68, PinOp.EQ, MARKER_WALLET));
        r.allowedCalls[2] = _allowed(usdcDest, TRANSFER, 4, true, new ArgPin[](0));
    }

    /// @dev `_cardRules` plus a second asset that may route but never moves: `{pETH, 0, 0}`.
    function _cardRulesTwoAssets(address usdcPrc20, address usdcDest, address pool, address pethPrc20)
        internal
        pure
        returns (AgentCardRules memory r)
    {
        r = _cardRules(usdcPrc20, usdcDest, pool);
        AssetCap[] memory assets = new AssetCap[](2);
        assets[0] = r.assets[0];
        assets[1] = AssetCap({token: pethPrc20, maxPerCall: 0, maxTotal: 0});
        r.assets = assets;
    }

    // ───────── the SDK's session ─────────

    /// @dev Appendix E: the principal asset's caps → `principal` (per-call only if it is the marker); pins'
    ///      `MARKER_PRINCIPAL` → `bytes32(principal)`, `MARKER_WALLET` → the CEA word; everything else copied.
    function _fillTerms(AgentCardRules memory r, uint256 principal, uint48 validUntil, address cea)
        internal
        pure
        returns (UniversalTerms memory t)
    {
        t.validUntil = validUntil;
        t.expectedCEA = cea;
        t.maxGasPerCall = r.maxGasPerCall;
        t.assets = new AssetCap[](r.assets.length);
        for (uint256 i; i < r.assets.length; ++i) {
            t.assets[i] = _fillAsset(r.assets[i], i == r.principalAsset, principal);
        }
        t.allowedCalls = new AllowedCall[](r.allowedCalls.length);
        for (uint256 i; i < r.allowedCalls.length; ++i) {
            t.allowedCalls[i] = _fillCall(r.allowedCalls[i], principal, cea);
        }
    }

    function _fillAsset(AssetCap memory a, bool isPrincipal, uint256 principal)
        internal
        pure
        returns (AssetCap memory filled)
    {
        filled = AssetCap({token: a.token, maxPerCall: a.maxPerCall, maxTotal: a.maxTotal});
        if (!isPrincipal) return filled;
        filled.maxTotal = principal;
        if (a.maxPerCall == uint256(MARKER_PRINCIPAL)) filled.maxPerCall = principal;
    }

    function _fillCall(AllowedCall memory c, uint256 principal, address cea)
        internal
        pure
        returns (AllowedCall memory filled)
    {
        ArgPin[] memory pins = new ArgPin[](c.pins.length);
        for (uint256 k; k < pins.length; ++k) {
            pins[k] = _fillPin(c.pins[k], principal, cea);
        }
        filled = _allowed(c.target, c.selector, c.beneficiaryOffset, c.hasBeneficiary, pins);
        filled.maxValue = c.maxValue;
    }

    function _fillPin(ArgPin memory p, uint256 principal, address cea) internal pure returns (ArgPin memory) {
        bytes32 v = p.value;
        if (v == MARKER_WALLET) v = _word(cea);
        else if (v == MARKER_PRINCIPAL) v = bytes32(principal);
        return _pin(p.offset, p.op, v);
    }

    /// @dev The v6 envelope: `abi.encode(uint16 version, string chain, bytes body)`.
    function _envelope(UniversalTerms memory t, string memory chain) internal pure returns (bytes memory) {
        return abi.encode(ENVELOPE_VERSION, chain, abi.encode(t));
    }

    /// @dev One action, one policy carrying `initData`; the agent is `abi.encode(agent)`.
    function _wrapSession(bytes memory initData, address agent, SessionSkeleton memory sk)
        internal
        pure
        returns (Session memory s)
    {
        s.sessionValidator = sk.validator;
        s.sessionValidatorInitData = abi.encode(agent);
        s.erc7739Policies =
            ERC7739Data({allowedERC7739Content: new ERC7739Context[](0), erc1271Policies: new PolicyData[](0)});
        s.userOpPolicies = new PolicyData[](0);
        PolicyData[] memory p = new PolicyData[](1);
        p[0] = PolicyData({policy: sk.policy, initData: initData});
        s.actions = new ActionData[](1);
        s.actions[0] =
            ActionData({actionTargetSelector: sk.actionSelector, actionTarget: sk.actionTarget, actionPolicies: p});
    }

    // ───────── small builders ─────────

    function _word(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function _pin(uint16 offset, PinOp op, bytes32 value) internal pure returns (ArgPin memory) {
        return ArgPin({offset: offset, op: op, value: value});
    }

    function _pins1(uint16 offset, PinOp op, bytes32 value) internal pure returns (ArgPin[] memory pins) {
        pins = new ArgPin[](1);
        pins[0] = _pin(offset, op, value);
    }

    function _allowed(address target, bytes4 selector, uint16 offset, bool hasBeneficiary, ArgPin[] memory pins)
        internal
        pure
        returns (AllowedCall memory)
    {
        return AllowedCall({
            target: target,
            selector: selector,
            beneficiaryOffset: offset,
            hasBeneficiary: hasBeneficiary,
            maxValue: 0,
            pins: pins
        });
    }
}
