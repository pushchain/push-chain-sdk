// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";

import {IAGWFactory} from "../../src/agentic-commerce-8183/interfaces/external/IAGWFactory.sol";
import {ISmartSession} from "../../src/agentic-commerce-8183/interfaces/external/ISmartSession.sol";

/// @notice The v6 factory's owner-door deploy, which IAGWFactory does not mirror (the marketplace never calls it).
interface IAGWFactoryDeploy {
    function deployWallet(string calldata label) external returns (address wallet);
}

/// @notice Pins the AGW interfaces against the live Donut AGW v6 deployment.
/// @dev - Skips unless PUSH_CHAIN_TESTNET_RPC_URL is set (forge also reads it from `.env`); no default RPC.
///      - Forks `FORK_BLOCK` if set, else the latest block (the public Donut RPC is not archival). The block used is
///        logged.
///      - A wrong ABI reverts or decodes garbage, so passing calls pin it. The wallet is deployed on the fork, so the
///        test needs no pre-existing wallet.
contract RulesBindingHookForkTest is Test {
    address internal constant FACTORY = 0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc;
    address internal constant ENGINE = 0xf63DC0628fe1B25049FE3E3a3585Ef051CB98c1d;

    function test_fork_mirrorsMatchDeployedAGW() public {
        string memory url = vm.envOr("PUSH_CHAIN_TESTNET_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        uint256 blk = vm.envOr("FORK_BLOCK", uint256(0));
        if (blk == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, blk);
        emit log_named_uint("fork block", block.number);

        address eoa = makeAddr("forkWalletOwner");
        vm.prank(eoa);
        address w = IAGWFactoryDeploy(FACTORY).deployWallet("");
        assertTrue(IAGWFactory(FACTORY).isWallet(w), "a freshly deployed wallet is an AGW");
        assertEq(IAGWFactory(FACTORY).ownerOf(w), eoa);
        assertFalse(IAGWFactory(FACTORY).isWallet(makeAddr("nobody")), "random address is not");
        assertFalse(ISmartSession(ENGINE).isPermissionEnabled(bytes32(uint256(1)), w), "unknown id is not enabled");
    }
}
