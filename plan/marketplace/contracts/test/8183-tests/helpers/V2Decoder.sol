// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    T_UINT,
    T_INT,
    T_BOOL,
    T_ADDRESS,
    T_BYTES,
    T_STRING,
    T_TUPLE,
    T_ARRAY,
    T_FIXED_ARRAY
} from "../../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol";

/// @title V2Decoder — TEST ONLY: the evaluator's answer decoder, as written in the V2 design doc
/// @notice The reference the conformance suite holds the marketplace's templates to.
/// @dev - Source: `docs-internal/Universal Evaluator V2 Design`, "The decoder (in the evaluator)". Logic copied
///        verbatim; only the layout is `forge fmt`'s. Do not "fix" it here: a divergence is a finding.
///      - `locate` is the one addition: it exposes `_locate` so a test can compare leaf types.
// forge-lint: disable-start(unsafe-typecast)
contract V2Decoder {
    /// @notice The number to compare, from answer `res`.
    function decodeAnswer(bytes memory outputs, uint8[] memory field, bytes calldata res)
        external
        pure
        returns (bool, int256)
    {
        (bool ok, uint8 leaf, uint256 at) = _locate(outputs, field, res);
        if (!ok) return (false, 0);

        if (leaf == T_BYTES || leaf == T_STRING || leaf == T_ARRAY) {
            (bool ok2, uint256 len) = _word(res, at);
            if (!ok2) return (false, 0);
            if (leaf == T_ARRAY) return (true, int256(len));
            if (len > res.length || at + 32 + len > res.length) return (false, 0);
            return (true, int256(uint256(keccak256(res[at + 32:at + 32 + len]))));
        }

        (bool ok3, uint256 w) = _word(res, at);
        if (!ok3) return (false, 0);
        if (leaf == T_UINT) return w > uint256(type(int256).max) ? (false, int256(0)) : (true, int256(w));
        if (leaf == T_INT) return (true, int256(w));
        if (leaf == T_BOOL) return w > 1 ? (false, int256(0)) : (true, int256(w));
        if (leaf == T_ADDRESS) return w >> 160 != 0 ? (false, int256(0)) : (true, int256(w));
        return (true, int256(w));
    }

    /// @notice `_locate`, exposed: whether the path resolves, the leaf's type code, and its offset in `res`.
    function locate(bytes memory types, uint8[] memory field, bytes calldata res)
        external
        pure
        returns (bool ok, uint8 leaf, uint256 at)
    {
        return _locate(types, field, res);
    }

    /// @dev Walks the return types along `field` and finds where that value sits in `res`.
    function _locate(bytes memory types, uint8[] memory field, bytes calldata res)
        internal
        pure
        returns (bool ok, uint8 leaf, uint256 at)
    {
        uint256 t;
        uint256 base;
        for (uint256 i; i < field.length; ++i) {
            uint8 code = uint8(types[t]);
            uint256 idx = field[i];
            uint256 elem;
            uint256 ptr;

            if (code == T_TUPLE) {
                if (idx >= uint8(types[t + 1])) return (false, 0, 0);
                uint256 c = t + 2;
                uint256 head;
                for (uint256 j; j < idx; ++j) {
                    head += _headWords(types, c);
                    c = _skip(types, c);
                }
                uint256 slot = base + 32 * head;
                if (_isDynamic(types, c)) {
                    (ok, ptr) = _word(res, slot);
                    if (!ok || ptr > res.length) return (false, 0, 0);
                    base += ptr;
                } else {
                    base = slot;
                }
                t = c;
            } else if (code == T_ARRAY) {
                elem = t + 1;
                uint256 len;
                (ok, len) = _word(res, base);
                if (!ok || idx >= len) return (false, 0, 0);
                uint256 start = base + 32;
                if (_isDynamic(types, elem)) {
                    (ok, ptr) = _word(res, start + 32 * idx);
                    if (!ok || ptr > res.length) return (false, 0, 0);
                    base = start + ptr;
                } else {
                    base = start + 32 * idx * _headWords(types, elem);
                }
                t = elem;
            } else if (code == T_FIXED_ARRAY) {
                if (idx >= uint8(types[t + 1])) return (false, 0, 0);
                elem = t + 2;
                if (_isDynamic(types, elem)) {
                    (ok, ptr) = _word(res, base + 32 * idx);
                    if (!ok || ptr > res.length) return (false, 0, 0);
                    base += ptr;
                } else {
                    base += 32 * idx * _headWords(types, elem);
                }
                t = elem;
            } else {
                return (false, 0, 0);
            }
        }
        return (true, uint8(types[t]), base);
    }

    /// @dev bytes, string and T[] are dynamic; a struct or T[k] is dynamic if anything inside is.
    function _isDynamic(bytes memory types, uint256 t) internal pure returns (bool) {
        uint8 code = uint8(types[t]);
        if (code == T_BYTES || code == T_STRING || code == T_ARRAY) return true;
        if (code == T_FIXED_ARRAY) return _isDynamic(types, t + 2);
        if (code == T_TUPLE) {
            uint256 c = t + 2;
            for (uint256 j; j < uint8(types[t + 1]); ++j) {
                if (_isDynamic(types, c)) return true;
                c = _skip(types, c);
            }
        }
        return false;
    }

    /// @dev Slots a value takes in its parent's head: 1 if dynamic (a pointer), else its full size.
    function _headWords(bytes memory types, uint256 t) internal pure returns (uint256 n) {
        if (_isDynamic(types, t)) return 1;
        uint8 code = uint8(types[t]);
        if (code == T_FIXED_ARRAY) return uint8(types[t + 1]) * _headWords(types, t + 2);
        if (code == T_TUPLE) {
            uint256 c = t + 2;
            for (uint256 j; j < uint8(types[t + 1]); ++j) {
                n += _headWords(types, c);
                c = _skip(types, c);
            }
            return n;
        }
        return 1;
    }

    /// @dev The position in `types` right after the type starting at `t`.
    function _skip(bytes memory types, uint256 t) internal pure returns (uint256) {
        uint8 code = uint8(types[t]);
        if (code == T_ARRAY) return _skip(types, t + 1);
        if (code == T_FIXED_ARRAY) return _skip(types, t + 2);
        if (code == T_TUPLE) {
            uint256 c = t + 2;
            for (uint256 j; j < uint8(types[t + 1]); ++j) {
                c = _skip(types, c);
            }
            return c;
        }
        return t + 1;
    }

    /// @dev One 32-byte slot of the answer, or not-ok if the answer is too short.
    function _word(bytes calldata b, uint256 at) internal pure returns (bool, uint256) {
        if (at > b.length || b.length - at < 32) return (false, 0);
        return (true, uint256(bytes32(b[at:at + 32])));
    }
}
// forge-lint: disable-end(unsafe-typecast)
