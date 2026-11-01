// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    Evaluation,
    Operation,
    LogicKind,
    Logic,
    T_UINT,
    T_ADDRESS,
    T_TUPLE
} from "../../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol";
import {
    FillSource,
    Fill,
    ReadTemplate,
    TargetSource,
    CheckTemplate
} from "../../../src/agentic-commerce-8183/libraries/Types.sol";

/// @title TemplateParts — TEST ONLY: chain-agnostic builders for jobSpecTemplates
/// @notice Shared by the builder, conformance and marketplace suites. Every builder is pure.
abstract contract TemplateParts {
    bytes4 internal constant BALANCE_OF = bytes4(keccak256("balanceOf(address)"));
    bytes4 internal constant GET_RESERVE_DATA = bytes4(keccak256("getReserveData(address)"));
    bytes4 internal constant MAX_WITHDRAW = bytes4(keccak256("maxWithdraw(address)"));

    // ───────── outputs and fields ─────────

    function _uintOut() internal pure returns (bytes memory) {
        return abi.encodePacked(T_TUPLE, uint8(1), T_UINT);
    }

    /// @dev Aave v3 `getReserveData` → one 15-field struct, the V2 doc's encoding.
    function _reserveDataOut() internal pure returns (bytes memory) {
        return abi.encodePacked(
            abi.encodePacked(T_TUPLE, uint8(1), T_TUPLE, uint8(15), T_TUPLE, uint8(1), T_UINT),
            abi.encodePacked(T_UINT, T_UINT, T_UINT, T_UINT, T_UINT, T_UINT, T_UINT),
            abi.encodePacked(T_ADDRESS, T_ADDRESS, T_ADDRESS, T_ADDRESS, T_UINT, T_UINT, T_UINT)
        );
    }

    function _f(uint8 a) internal pure returns (uint8[] memory f) {
        f = new uint8[](1);
        f[0] = a;
    }

    function _f2(uint8 a, uint8 b) internal pure returns (uint8[] memory f) {
        f = new uint8[](2);
        f[0] = a;
        f[1] = b;
    }

    function _noFills() internal pure returns (Fill[] memory) {
        return new Fill[](0);
    }

    function _ceaFill(uint8 word) internal pure returns (Fill[] memory fills) {
        fills = new Fill[](1);
        fills[0] = Fill({word: word, source: FillSource.CEA, param: 0});
    }

    // ───────── reads, checks, logic ─────────

    function _read(
        string memory chainId,
        address target,
        bytes4 selector,
        bytes memory args,
        Fill[] memory fills,
        bytes memory outputs,
        uint8[] memory field
    ) internal pure returns (ReadTemplate memory) {
        return ReadTemplate({
            chainNamespace: "eip155",
            chainId: chainId,
            minConfirmations: 12,
            target: target,
            selector: selector,
            args: args,
            fills: fills,
            outputs: outputs,
            field: field
        });
    }

    /// @dev `token.balanceOf(CEA)` on `chainId`: args are one zero word the CEA fill overwrites.
    function _balanceOfCEA(string memory chainId, address token) internal pure returns (ReadTemplate memory) {
        return _read(chainId, token, BALANCE_OF, new bytes(32), _ceaFill(0), _uintOut(), _f(0));
    }

    function _chk(uint8 read, Evaluation e, Operation op, TargetSource src, int256 value)
        internal
        pure
        returns (CheckTemplate memory)
    {
        return CheckTemplate({read: read, evaluation: e, operation: op, source: src, value: value});
    }

    /// @dev One logic step over `checks` and child steps `children`; `k` for AT_LEAST only.
    function _step(LogicKind kind, uint8[] memory checks, uint8[] memory children, uint8 k)
        internal
        pure
        returns (Logic memory)
    {
        return Logic({kind: kind, checks: checks, children: children, k: k});
    }

    /// @dev A one-step tree: `kind` over `checks`, no children.
    function _rootOf(LogicKind kind, uint8[] memory checks) internal pure returns (Logic[] memory logic) {
        logic = new Logic[](1);
        logic[0] = _step(kind, checks, new uint8[](0), 0);
    }

    function _none() internal pure returns (uint8[] memory) {
        return new uint8[](0);
    }

    function _one(uint8 a) internal pure returns (uint8[] memory c) {
        c = new uint8[](1);
        c[0] = a;
    }

    function _kids(uint8 a, uint8 b) internal pure returns (uint8[] memory c) {
        c = new uint8[](2);
        c[0] = a;
        c[1] = b;
    }

    function _kids3(uint8 a, uint8 b, uint8 d) internal pure returns (uint8[] memory c) {
        c = new uint8[](3);
        c[0] = a;
        c[1] = b;
        c[2] = d;
    }
}
