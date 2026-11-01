// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniversalMarketplace} from "../interfaces/IUniversalMarketplace.sol";
import {UniversalMarketplaceErrors} from "./Errors.sol";
import {Read, Check, JobSpec} from "./JobSpecTypes.sol";
import {
    FillSource,
    Fill,
    ReadTemplate,
    TargetSource,
    CheckTemplate,
    ParamBounds,
    JobSpecTemplate,
    BuildContext
} from "./Types.sol";

/// @title JobSpecBuilder
/// @notice Turns a card's `jobSpecTemplate` into one job's criteria, a `JobSpec` (the `createJob` description).
/// @dev - Builds only: it never judges a template. Whether the UniversalEvaluator can run the criteria is the
///        provider's responsibility, and the card's verified tag is the review (PRD 09 Z6).
///      - Checks only what building needs: the job's params against the template's bounds, every fill inside its
///        read's args, and a PRINCIPAL_BPS product that fits. Anything else malformed reverts on its own
///        (out-of-range index, unsupported CEA chain).
///      - External library: deployed once and linked into the marketplace, which DELEGATECALLs it. Inlined, it
///        put the marketplace over the size limit (23,821 B even at 1 optimizer run).
///      - Runs in the caller's context: the CEA comes from the caller's own `computeCEA`.
///      - `logic` and `allowedMutability` are copied verbatim; neither is judged here.
library JobSpecBuilder {
    uint256 internal constant BPS = 10_000;

    /// @notice `abi.encode(JobSpec)` for one job.
    /// @param jobSpecTemplate The card's `abi.encode(JobSpecTemplate)`.
    /// @param ctx The job's values.
    function build(bytes memory jobSpecTemplate, BuildContext memory ctx) public view returns (bytes memory) {
        JobSpecTemplate memory t = abi.decode(jobSpecTemplate, (JobSpecTemplate));
        _checkParams(t.params, ctx.params);
        address[] memory cea = _ceas(t, ctx.agw);

        JobSpec memory spec;
        spec.executeBy = uint64(ctx.executeBy);
        spec.failFinalAt = uint64(ctx.executeBy) + ctx.settleWindow;
        spec.origin = ctx.origin;
        spec.logic = t.logic;
        spec.allowedMutability = t.allowedMutability;
        spec.reads = new Read[](t.reads.length);
        for (uint256 i; i < t.reads.length; ++i) {
            spec.reads[i] = _buildRead(t.reads[i], i, ctx.params, cea[i]);
        }
        spec.checks = new Check[](t.checks.length);
        for (uint256 j; j < t.checks.length; ++j) {
            spec.checks[j] = _buildCheck(t.checks[j], j, ctx, cea);
        }
        return abi.encode(spec);
    }

    /// @dev One per template param, each inside its inclusive bounds.
    function _checkParams(ParamBounds[] memory bounds, int256[] memory params) private pure {
        if (params.length != bounds.length) {
            revert UniversalMarketplaceErrors.ParamCountMismatch(bounds.length, params.length);
        }
        for (uint256 i; i < params.length; ++i) {
            if (params[i] < bounds[i].min || params[i] > bounds[i].max) {
                revert UniversalMarketplaceErrors.ParamOutOfRange(i, params[i]);
            }
        }
    }

    /// @dev The AGW's CEA for every read that needs one (a CEA fill, or a CEA-target check on it), else zero.
    function _ceas(JobSpecTemplate memory t, address agw) private view returns (address[] memory cea) {
        cea = new address[](t.reads.length);
        for (uint256 i; i < t.reads.length; ++i) {
            if (_hasCEAFill(t.reads[i])) cea[i] = _ceaOf(agw, t.reads[i]);
        }
        for (uint256 j; j < t.checks.length; ++j) {
            uint8 r = t.checks[j].read;
            if (t.checks[j].source == TargetSource.CEA && cea[r] == address(0)) {
                cea[r] = _ceaOf(agw, t.reads[r]);
            }
        }
    }

    function _hasCEAFill(ReadTemplate memory r) private pure returns (bool) {
        for (uint256 f; f < r.fills.length; ++f) {
            if (r.fills[f].source == FillSource.CEA) return true;
        }
        return false;
    }

    /// @dev The template read, with its fills written into a fresh copy of `args`.
    function _buildRead(ReadTemplate memory r, uint256 i, int256[] memory params, address cea)
        private
        pure
        returns (Read memory)
    {
        bytes memory args = bytes.concat(r.args); // a copy: the template stays untouched
        for (uint256 f; f < r.fills.length; ++f) {
            Fill memory fill = r.fills[f];
            uint256 at = 32 * uint256(fill.word);
            if (at + 32 > args.length) revert UniversalMarketplaceErrors.FillOutOfBounds(i, f);
            bytes32 word = fill.source == FillSource.CEA
                ? bytes32(uint256(uint160(cea)))
                : bytes32(uint256(params[fill.param]));
            // solhint-disable-next-line no-inline-assembly
            assembly ("memory-safe") {
                mstore(add(add(args, 0x20), at), word)
            }
        }
        return Read({
            chainNamespace: r.chainNamespace,
            chainId: r.chainId,
            minConfirmations: r.minConfirmations,
            target: r.target,
            selector: r.selector,
            args: args,
            outputs: r.outputs,
            field: r.field
        });
    }

    /// @dev The check with its target resolved.
    function _buildCheck(CheckTemplate memory c, uint256 j, BuildContext memory ctx, address[] memory cea)
        private
        pure
        returns (Check memory)
    {
        int256 target = c.value;
        if (c.source == TargetSource.PRINCIPAL_BPS) {
            uint256 bps = uint256(c.value);
            if (ctx.principal > type(uint256).max / bps) revert UniversalMarketplaceErrors.TargetOverflow(j);
            // forge-lint: disable-next-line(unsafe-typecast)
            target = int256((ctx.principal * bps) / BPS); // ≤ uint256.max / 10_000 < int256.max: cannot truncate
        } else if (c.source == TargetSource.PARAM) {
            target = ctx.params[uint256(c.value)];
        } else if (c.source == TargetSource.CEA) {
            target = int256(uint256(uint160(cea[c.read])));
        }
        return Check({read: c.read, evaluation: c.evaluation, operation: c.operation, target: target});
    }

    /// @dev The AGW's CEA on the read's chain, from the caller (the marketplace, under DELEGATECALL). The key is
    ///      keccak256 of the read's CAIP-2 string; an unsupported chain reverts `ChainNotSupported`.
    function _ceaOf(address agw, ReadTemplate memory r) private view returns (address) {
        bytes32 chainHash = keccak256(abi.encodePacked(r.chainNamespace, ":", r.chainId));
        return IUniversalMarketplace(address(this)).computeCEA(agw, chainHash);
    }
}
