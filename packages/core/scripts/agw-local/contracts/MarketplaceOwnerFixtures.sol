// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// SDK acceptance only: a real ERC-1271 owner and an EIP-7702-compatible verifier.
contract Marketplace1271Owner {
    address public immutable controller;
    uint8 public responseMode;

    constructor(address controller_) { controller = controller_; }
    receive() external payable {}

    function setResponseMode(uint8 mode) external {
        require(msg.sender == controller, "controller");
        responseMode = mode;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (responseMode == 1) return 0xffffffff;
        if (responseMode == 2) {
            // A magic prefix with nonzero trailing bytes must not count as ERC-1271 success.
            assembly { mstore(0, or(shl(224, 0x1626ba7e), 1)) return(0, 32) }
        }
        if (responseMode == 3) {
            assembly { mstore(0, shl(224, 0x1626ba7e)) return(0, 4) }
        }
        if (signature.length != 65) return 0xffffffff;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset, 32)) v := byte(0, calldataload(add(signature.offset, 64))) }
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0 || (v != 27 && v != 28)) return 0xffffffff;
        return ecrecover(digest, v, r, s) == controller ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function execute(address target, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == controller, "controller");
        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }
}

/// Nonreverting fallback: neither an empty nor an echoed return is a signature verifier.
contract MarketplaceEchoOwner {
    fallback() external { assembly { calldatacopy(0, 0, calldatasize()) return(0, calldatasize()) } }
}
