// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC8183Hook} from "../../../src/agentic-commerce-8183/hooks/BaseERC8183Hook.sol";

/// @notice Overrides nothing: exercises the base's default no-op handlers.
contract BareHook is BaseERC8183Hook {
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address kernel_) external initializer {
        __BaseERC8183Hook_init(kernel_);
    }
}
