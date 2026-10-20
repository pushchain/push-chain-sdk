// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A PRC20 stand-in: an ERC-20 whose `SOURCE_CHAIN_NAMESPACE()` the test sets. OBSERVER, NOT ORACLE:
///         the namespace and the shape of the answer are inputs; the marketplace's judgement of them is what
///         is under test.
contract MockPRC20Source is ERC20 {
    /// @dev How `SOURCE_CHAIN_NAMESPACE()` answers. Namespace: a well-formed string · Reverts · Short: one
    ///      word · BadOffset: a string head whose offset is not 32 · Overlong: a length past the data.
    enum Answer {
        Namespace,
        Reverts,
        Short,
        BadOffset,
        Overlong
    }

    uint8 internal immutable DECIMALS;
    string internal namespace;
    Answer public answer;

    constructor(string memory name_, string memory namespace_, uint8 decimals_) ERC20(name_, name_) {
        namespace = namespace_;
        DECIMALS = decimals_;
    }

    function setNamespace(string calldata namespace_) external {
        namespace = namespace_;
    }

    function setAnswer(Answer a) external {
        answer = a;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return DECIMALS;
    }

    // forge-lint: disable-next-line(mixed-case-function)
    function SOURCE_CHAIN_NAMESPACE() external view returns (string memory) {
        Answer a = answer;
        if (a == Answer.Reverts) revert("MockPRC20Source: reverts");
        if (a == Answer.Namespace) return namespace;
        bytes memory raw;
        if (a == Answer.Short) raw = abi.encode(uint256(7));
        if (a == Answer.BadOffset) raw = abi.encode(uint256(64), uint256(0));
        if (a == Answer.Overlong) raw = abi.encode(uint256(32), uint256(1000));
        assembly ("memory-safe") {
            return(add(raw, 32), mload(raw))
        }
    }
}
