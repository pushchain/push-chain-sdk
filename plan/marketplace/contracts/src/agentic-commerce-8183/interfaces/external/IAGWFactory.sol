// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerIntent} from "@push-agw/libraries/Types.sol";

/// @title IAGWFactory
/// @notice The Push Agentic Wallet factory — the functions this repo calls.
/// @dev - Source: AGW v6, `push-agentic-wallets` commit `ffd567d`, `src/interfaces/IAGWFactory.sol`; every
///        signature below verified identical.
///      - `isWallet` is what RulesBindingHook reads; the rest is what UniversalMarketplace reads.
///      - The v6 factory proxy is a deploy-time input, never a constant.
interface IAGWFactory {
    /// @notice True only for wallets this factory deployed.
    /// @param account Address to test.
    /// @return Whether it is an AGW.
    function isWallet(address account) external view returns (bool);

    /// @notice Deploys wallet `intent.index` for `intent.owner`, on the owner's signature.
    function deployWalletWithSig(OwnerIntent calldata intent, bytes calldata sig, string calldata label)
        external
        returns (address wallet);

    /// @notice The address wallet `index` of `owner` has, or will have.
    function predictWallet(address owner, uint256 index) external view returns (address wallet, bool deployed);

    /// @notice How many wallets `owner` has; also the index the next deploy takes.
    function walletCount(address owner) external view returns (uint256);

    /// @notice The owner of `wallet`, or address(0) if this factory did not deploy it.
    function ownerOf(address wallet) external view returns (address);
}
