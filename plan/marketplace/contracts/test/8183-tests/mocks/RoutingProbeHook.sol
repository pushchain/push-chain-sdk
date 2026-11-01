// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC8183Hook} from "../../../src/agentic-commerce-8183/hooks/BaseERC8183Hook.sol";

/// @notice Phase-3 concrete hook: records which handler ran and the arguments it decoded.
contract RoutingProbeHook is BaseERC8183Hook {
    struct Rec {
        string handler;
        uint256 jobId;
        address caller;
        address addrArg;
        uint256 uintArg;
        bytes32 b32Arg;
        bytes optParams;
    }

    Rec[] internal recs;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address kernel_) external initializer {
        __BaseERC8183Hook_init(kernel_);
    }

    /// @dev Calls the base init outside an initializer — must revert NotInitializing.
    function initOutside(address kernel_) external {
        __BaseERC8183Hook_init(kernel_);
    }

    function count() external view returns (uint256) {
        return recs.length;
    }

    function rec(uint256 i) external view returns (Rec memory) {
        return recs[i];
    }

    function _push(string memory h, uint256 id, address c, address a, uint256 u, bytes32 b, bytes memory o) internal {
        recs.push(Rec(h, id, c, a, u, b, o));
    }

    function _preSetProvider(uint256 id, address c, address p, bytes memory o) internal override {
        _push("preSetProvider", id, c, p, 0, 0, o);
    }

    function _postSetProvider(uint256 id, address c, address p, bytes memory o) internal override {
        _push("postSetProvider", id, c, p, 0, 0, o);
    }

    function _preSetBudget(uint256 id, address c, uint256 amt, bytes memory o) internal override {
        _push("preSetBudget", id, c, address(0), amt, 0, o);
    }

    function _postSetBudget(uint256 id, address c, uint256 amt, bytes memory o) internal override {
        _push("postSetBudget", id, c, address(0), amt, 0, o);
    }

    function _preFund(uint256 id, address c, bytes memory o) internal override {
        _push("preFund", id, c, address(0), 0, 0, o);
    }

    function _postFund(uint256 id, address c, bytes memory o) internal override {
        _push("postFund", id, c, address(0), 0, 0, o);
    }

    function _preSubmit(uint256 id, address c, bytes32 d, bytes memory o) internal override {
        _push("preSubmit", id, c, address(0), 0, d, o);
    }

    function _postSubmit(uint256 id, address c, bytes32 d, bytes memory o) internal override {
        _push("postSubmit", id, c, address(0), 0, d, o);
    }

    function _preComplete(uint256 id, address c, bytes32 r, bytes memory o) internal override {
        _push("preComplete", id, c, address(0), 0, r, o);
    }

    function _postComplete(uint256 id, address c, bytes32 r, bytes memory o) internal override {
        _push("postComplete", id, c, address(0), 0, r, o);
    }

    function _preReject(uint256 id, address c, bytes32 r, bytes memory o) internal override {
        _push("preReject", id, c, address(0), 0, r, o);
    }

    function _postReject(uint256 id, address c, bytes32 r, bytes memory o) internal override {
        _push("postReject", id, c, address(0), 0, r, o);
    }
}
