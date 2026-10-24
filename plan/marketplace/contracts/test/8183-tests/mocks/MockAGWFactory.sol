// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerIntent} from "@push-agw/libraries/Types.sol";
import {MockAGW} from "./MockAGW.sol";

/// @notice Answers `isWallet` from a settable map, and — for UniversalMarketplace tests — deploys
///         MockAGW clones at CREATE2 addresses it can predict, mirroring the real factory's rules that
///         the marketplace depends on: explicit index == count, `intent.wallet` == predicted, and the
///         intent presentable only by its executor. It verifies NO signature; the AGW repo's E2E suite
///         runs the real factory.
contract MockAGWFactory {
    mapping(address => bool) public isWallet;
    mapping(address => uint256) public walletCount;
    mapping(address => address) public ownerOf;
    /// @notice Misbehaviour switch: deploy at another salt, i.e. not at the address `predictWallet` gave.
    bool public misdeploy;

    error IndexMismatch(uint96 expected, uint96 provided);
    error IntentWalletMismatch(address expected, address provided);
    error ExecutorMismatch(address expected, address actual);

    function setWallet(address account, bool status) external {
        isWallet[account] = status;
    }

    function setMisdeploy(bool on) external {
        misdeploy = on;
    }

    function predictWallet(address owner, uint256 index) public view returns (address wallet, bool deployed) {
        // forge-lint: disable-next-line(unsafe-typecast)
        bytes32 salt = keccak256(abi.encode(owner, uint96(index))); // the real factory's index is a uint96
        bytes32 h = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                salt,
                keccak256(abi.encodePacked(type(MockAGW).creationCode, abi.encode(owner)))
            )
        );
        // forge-lint: disable-next-line(unsafe-typecast)
        wallet = address(uint160(uint256(h))); // CREATE2: the address is the hash's low 160 bits
        deployed = index < walletCount[owner];
    }

    function deployWalletWithSig(OwnerIntent calldata intent, bytes calldata, string calldata)
        external
        returns (address wallet)
    {
        uint96 next = uint96(walletCount[intent.owner]);
        if (intent.index != next) revert IndexMismatch(next, intent.index);
        (address predicted,) = predictWallet(intent.owner, intent.index);
        if (intent.wallet != predicted) revert IntentWalletMismatch(predicted, intent.wallet);
        if (msg.sender != intent.owner && msg.sender != intent.executor) {
            revert ExecutorMismatch(intent.executor, msg.sender);
        }
        walletCount[intent.owner] = next + 1;
        bytes32 salt = keccak256(abi.encode(intent.owner, intent.index));
        if (misdeploy) salt = keccak256(abi.encode(salt));
        wallet = address(new MockAGW{salt: salt}(intent.owner));
        isWallet[wallet] = true;
        ownerOf[wallet] = intent.owner;
    }
}
