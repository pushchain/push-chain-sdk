// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    AssetCap,
    AllowedCall,
    ArgPin,
    PinOp,
    UniversalTerms,
    ENVELOPE_VERSION,
    MAX_ASSETS,
    MAX_PINS,
    MAX_ALLOWED_CALL_PINS
} from "@push-agw/libraries/Types.sol";
import {UniversalMarketplaceErrors} from "./libraries/Errors.sol";
import {AgentCardRules, SessionContext, MARKER_WALLET, MARKER_PRINCIPAL} from "./libraries/Types.sol";
import {IUniversalMarketplaceRules} from "./interfaces/IUniversalMarketplaceRules.sol";
import {Session} from "./interfaces/external/IAGW.sol";

/// @title UniversalMarketplaceRules
/// @notice The rules side of an agent card: registration guards, and rules = card at `openJob`.
/// @dev - EVM universal only. Pure logic, no storage, no admin; split out of the marketplace for EIP-170.
///      - Reverts with `UniversalMarketplaceErrors`: a revert here bubbles through the marketplace unchanged.
///      - Not upgradeable. A rule change is a new deployment plus a marketplace upgrade that points at it.
///      - Known limit: whether a `MARKER_PRINCIPAL` pin sits on the PRINCIPAL token's `approve` is not checked.
///        `IPRC20` has no source-token view, so a PRC20 cannot be mapped to its destination token. The verified tag
///        covers it.
contract UniversalMarketplaceRules is IUniversalMarketplaceRules {
    /// @dev URP's allow-list bound (internal there, so mirrored): a card that could never be granted is refused.
    uint256 internal constant MAX_ALLOWED_CALLS = 32;

    bytes4 internal constant ERC20_TRANSFER = IERC20.transfer.selector;
    bytes4 internal constant ERC20_APPROVE = IERC20.approve.selector;
    bytes4 internal constant ERC20_TRANSFER_FROM = IERC20.transferFrom.selector;
    /// @dev Not on OZ 5's IERC20.
    bytes4 internal constant ERC20_INCREASE_ALLOWANCE = bytes4(keccak256("increaseAllowance(address,uint256)"));

    /// @dev Calldata offsets of an ERC-20 call's first and second argument words.
    uint16 internal constant ARG0 = 4;
    uint16 internal constant ARG1 = 36;

    // ═════════════════════════════════ rules = card ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplaceRules
    /// @dev - Order C1-C14; the first failure reverts.
    ///      - The session never carries a marker: C8 and C12 compare against the filled-in value.
    ///      - Never compared: the card's `principalAsset` (an index, not a rule), and the session's validator,
    ///        policy address, action target and selector, userOp and ERC-7739 lists, paymaster flag and salt. The
    ///        AGW pins every one of those itself at `grantRules` (v6 `_grantRules`).
    function checkRulesMatchCard(bytes calldata cardRules, Session calldata session, SessionContext calldata ctx)
        external
        pure
    {
        if (keccak256(session.sessionValidatorInitData) != keccak256(abi.encode(ctx.agent))) {
            revert UniversalMarketplaceErrors.AgentMismatch();
        }
        if (session.actions.length != 1) revert UniversalMarketplaceErrors.ActionCount();
        if (session.actions[0].actionPolicies.length != 1) revert UniversalMarketplaceErrors.PolicyShape(0);

        UniversalTerms memory t = _decodeEnvelope(session.actions[0].actionPolicies[0].initData, ctx.chainHash);
        AgentCardRules memory c = abi.decode(cardRules, (AgentCardRules));
        _matchAssets(c, t, ctx.principal);
        if (t.maxGasPerCall != c.maxGasPerCall) revert UniversalMarketplaceErrors.GasCapMismatch();
        _matchCalls(c.allowedCalls, t.allowedCalls, ctx);
        if (t.validUntil != ctx.expiredAt) revert UniversalMarketplaceErrors.ExpiryMismatch();
        if (t.expectedCEA != ctx.expectedCEA) {
            revert UniversalMarketplaceErrors.ExpectedCEAMismatch(ctx.expectedCEA, t.expectedCEA);
        }
    }

    /// @dev C4-C5. The version is read from the first word BEFORE any decode, as URP does, so a pre-v6
    ///      two-field envelope (first word 64, its string offset) is named instead of panicking the decoder.
    function _decodeEnvelope(bytes calldata d, bytes32 chainHash) internal pure returns (UniversalTerms memory) {
        uint256 version = d.length < 32 ? 0 : uint256(bytes32(d[:32]));
        if (version != ENVELOPE_VERSION) revert UniversalMarketplaceErrors.EnvelopeVersionMismatch(version);
        (, string memory chainNamespace, bytes memory body) = abi.decode(d, (uint16, string, bytes));
        if (keccak256(bytes(chainNamespace)) != chainHash) revert UniversalMarketplaceErrors.ChainMismatch(0);
        return abi.decode(body, (UniversalTerms));
    }

    /// @dev C6-C9: same tokens in the same order; the principal asset's caps filled with the principal (D3); every
    ///      other asset's caps copied exactly.
    function _matchAssets(AgentCardRules memory c, UniversalTerms memory t, uint256 principal) internal pure {
        uint256 n = c.assets.length;
        if (t.assets.length != n) revert UniversalMarketplaceErrors.AssetCountMismatch(n, t.assets.length);
        for (uint256 i; i < n; ++i) {
            if (t.assets[i].token != c.assets[i].token) revert UniversalMarketplaceErrors.AssetMismatch(i);
        }
        AssetCap memory card = c.assets[c.principalAsset];
        AssetCap memory signed = t.assets[c.principalAsset];
        uint256 perCall = card.maxPerCall == uint256(MARKER_PRINCIPAL) ? principal : card.maxPerCall;
        if (signed.maxTotal != principal || signed.maxPerCall != perCall) {
            revert UniversalMarketplaceErrors.PrincipalCapMismatch();
        }
        for (uint256 i; i < n; ++i) {
            if (i == c.principalAsset) continue;
            if (t.assets[i].maxPerCall != c.assets[i].maxPerCall || t.assets[i].maxTotal != c.assets[i].maxTotal) {
                revert UniversalMarketplaceErrors.AssetMismatch(i);
            }
        }
    }

    /// @dev C11-C12, one loop: every field of every call equal, every pin's offset and op equal, then its value
    ///      equal with markers filled in.
    function _matchCalls(AllowedCall[] memory card, AllowedCall[] memory signed, SessionContext calldata ctx)
        internal
        pure
    {
        if (signed.length != card.length) revert UniversalMarketplaceErrors.ActionsMismatch();
        bytes32 wallet = bytes32(uint256(uint160(ctx.expectedCEA)));
        bytes32 principal = bytes32(ctx.principal);
        for (uint256 i; i < card.length; ++i) {
            AllowedCall memory a = card[i];
            AllowedCall memory b = signed[i];
            if (
                a.target != b.target || a.selector != b.selector || a.beneficiaryOffset != b.beneficiaryOffset
                    || a.hasBeneficiary != b.hasBeneficiary || a.maxValue != b.maxValue || a.pins.length != b.pins.length
            ) revert UniversalMarketplaceErrors.ActionsMismatch();
            for (uint256 k; k < a.pins.length; ++k) {
                ArgPin memory p = a.pins[k];
                ArgPin memory q = b.pins[k];
                if (p.offset != q.offset || p.op != q.op) revert UniversalMarketplaceErrors.ActionsMismatch();
                bytes32 want = p.value == MARKER_WALLET ? wallet : p.value == MARKER_PRINCIPAL ? principal : p.value;
                if (q.value != want) revert UniversalMarketplaceErrors.PinMismatch(i, k);
            }
        }
    }

    // ═════════════════════════════════ registration guards ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplaceRules
    /// @dev Order R1-R17; the first failure reverts. Malformed bytes revert in the decoder, without data.
    function validateAgentCardRules(bytes calldata rules) external pure returns (address[] memory tokens) {
        AgentCardRules memory r = abi.decode(rules, (AgentCardRules));
        _validateAssets(r.assets, r.principalAsset);
        _validateCallShape(r.allowedCalls);
        _validateDuplicates(r.allowedCalls);
        _validateErc20(r.allowedCalls);
        tokens = new address[](r.assets.length);
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i] = r.assets[i].token;
        }
    }

    /// @dev R1-R7.
    function _validateAssets(AssetCap[] memory assets, uint8 principalAsset) internal pure {
        uint256 n = assets.length;
        if (n == 0 || n > MAX_ASSETS) revert UniversalMarketplaceErrors.InvalidAgentCard("asset count");
        if (principalAsset >= n) revert UniversalMarketplaceErrors.InvalidAgentCard("principal asset");
        for (uint256 i; i < n; ++i) {
            if (assets[i].token == address(0)) revert UniversalMarketplaceErrors.InvalidAgentCard("asset zero");
        }
        for (uint256 i; i < n; ++i) {
            for (uint256 j; j < i; ++j) {
                if (assets[j].token == assets[i].token) {
                    revert UniversalMarketplaceErrors.InvalidAgentCard("duplicate asset");
                }
            }
        }
        AssetCap memory p = assets[principalAsset];
        if (p.maxTotal != uint256(MARKER_PRINCIPAL)) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("principal total not marker");
        }
        if (p.maxPerCall == 0) revert UniversalMarketplaceErrors.InvalidAgentCard("principal per-call zero");
        for (uint256 i; i < n; ++i) {
            if (i == principalAsset) continue;
            if (assets[i].maxPerCall == uint256(MARKER_PRINCIPAL) || assets[i].maxTotal == uint256(MARKER_PRINCIPAL)) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("marker off principal asset");
            }
        }
    }

    /// @dev R8-R10: 1-32 calls; at most MAX_PINS pins per call and MAX_ALLOWED_CALL_PINS in all; `MARKER_WALLET`
    ///      only under EQ (a ceiling of an address is meaningless).
    function _validateCallShape(AllowedCall[] memory calls) internal pure {
        uint256 n = calls.length;
        if (n == 0 || n > MAX_ALLOWED_CALLS) revert UniversalMarketplaceErrors.InvalidAgentCard("allow-list size");
        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint256 pins = calls[i].pins.length;
            total += pins;
            if (pins > MAX_PINS || total > MAX_ALLOWED_CALL_PINS) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("too many pins");
            }
        }
        for (uint256 i; i < n; ++i) {
            ArgPin[] memory pins = calls[i].pins;
            for (uint256 k; k < pins.length; ++k) {
                if (pins[k].value == MARKER_WALLET && pins[k].op != PinOp.EQ) {
                    revert UniversalMarketplaceErrors.InvalidAgentCard("wallet marker op");
                }
            }
        }
    }

    /// @dev R11-R12. Several entries may share a (target, selector) — "approve to Aave or to Uniswap" — but only
    ///      if each is pinned: a call passes if ANY entry passes, so a pinless one beside a pinned one makes the
    ///      pins pointless (AGW v6 `AllowedCall` docs; URP allows it, the SDK and this helper refuse it).
    function _validateDuplicates(AllowedCall[] memory calls) internal pure {
        uint256 n = calls.length;
        bytes32[] memory hashes = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            hashes[i] = keccak256(abi.encode(calls[i]));
            for (uint256 j; j < i; ++j) {
                if (hashes[j] == hashes[i]) revert UniversalMarketplaceErrors.InvalidAgentCard("duplicate call");
            }
        }
        for (uint256 i; i < n; ++i) {
            for (uint256 j; j < i; ++j) {
                if (
                    calls[j].target == calls[i].target && calls[j].selector == calls[i].selector
                        && (calls[j].pins.length == 0 || calls[i].pins.length == 0)
                ) revert UniversalMarketplaceErrors.InvalidAgentCard("unpinned duplicate");
            }
        }
    }

    /// @dev R13-R17, each over every call before the next (D1: the agent approves, but only under pins).
    ///      - approve: spender pinned EQ to a clean, non-zero address word (which excludes both markers: their
    ///        high 96 bits are non-zero), and amount capped by a MAX pin (a literal or `MARKER_PRINCIPAL`).
    ///      - transfer / transferFrom: recipient bound to the user's account, by the beneficiary field or by an EQ
    ///        `MARKER_WALLET` pin.
    function _validateErc20(AllowedCall[] memory calls) internal pure {
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].selector == ERC20_INCREASE_ALLOWANCE) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("increaseAllowance");
            }
        }
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].selector == ERC20_APPROVE && !_hasSpenderPin(calls[i].pins)) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("approve spender not pinned");
            }
        }
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].selector == ERC20_APPROVE && !_hasPin(calls[i].pins, ARG1, PinOp.MAX)) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("approve amount not capped");
            }
        }
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].selector == ERC20_TRANSFER && !_recipientIsWallet(calls[i], ARG0)) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("erc20 transfer recipient");
            }
        }
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].selector == ERC20_TRANSFER_FROM && !_recipientIsWallet(calls[i], ARG1)) {
                revert UniversalMarketplaceErrors.InvalidAgentCard("erc20 transferFrom recipient");
            }
        }
    }

    /// @dev Some pin is `{4, EQ, v}` with `v` a non-zero address word.
    function _hasSpenderPin(ArgPin[] memory pins) internal pure returns (bool) {
        for (uint256 k; k < pins.length; ++k) {
            ArgPin memory p = pins[k];
            if (p.offset == ARG0 && p.op == PinOp.EQ && p.value != 0 && uint256(p.value) >> 160 == 0) return true;
        }
        return false;
    }

    /// @dev Some pin is `{offset, op, *}`.
    function _hasPin(ArgPin[] memory pins, uint16 offset, PinOp op) internal pure returns (bool) {
        for (uint256 k; k < pins.length; ++k) {
            if (pins[k].offset == offset && pins[k].op == op) return true;
        }
        return false;
    }

    /// @dev The recipient word at `offset` is the user's account: the beneficiary field, or `{offset, EQ, MARKER_WALLET}`.
    function _recipientIsWallet(AllowedCall memory call, uint16 offset) internal pure returns (bool) {
        if (call.hasBeneficiary && call.beneficiaryOffset == offset) return true;
        for (uint256 k; k < call.pins.length; ++k) {
            ArgPin memory p = call.pins[k];
            if (p.offset == offset && p.op == PinOp.EQ && p.value == MARKER_WALLET) return true;
        }
        return false;
    }
}
