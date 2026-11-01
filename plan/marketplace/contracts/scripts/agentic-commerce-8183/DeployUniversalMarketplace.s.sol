// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import {AgenticCommerce} from "../../src/agentic-commerce-8183/AgenticCommerce.sol";
import {UniversalMarketplace} from "../../src/agentic-commerce-8183/UniversalMarketplace.sol";
import {UniversalMarketplaceRules} from "../../src/agentic-commerce-8183/UniversalMarketplaceRules.sol";
import {RulesBindingHook} from "../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol";
import {InitParams} from "../../src/agentic-commerce-8183/libraries/Types.sol";

/// @title DeployUniversalMarketplace
/// @notice Deploys the self-contained UniversalMarketplace stack on Push Donut, bound to AGW v6:
///         kernel (AgenticCommerce, pUSDC) → RulesBindingHook (whitelisted) → UniversalMarketplaceRules →
///         UniversalMarketplace, then registers the CEA deployment of each supported chain.
/// @dev - The broadcaster is the kernel and marketplace admin, the owner of every ProxyAdmin, and the
///        marketplace-wide evaluator (an EOA that completes or rejects jobs by hand) until the real evaluator
///        is wired with `setEvaluator`.
///      - Fees stay zero (the kernel's default).
///      - Env: DEPLOYER_KEY (broadcaster), TREASURE_KEY (its address becomes the kernel's platform treasury).
///      - Run: forge script scripts/agentic-commerce-8183/DeployUniversalMarketplace.s.sol \
///             --rpc-url $PUSH_CHAIN_TESTNET_RPC_URL --broadcast
contract DeployUniversalMarketplace is Script {
    address internal constant PUSDC = 0x7A58048036206bB898008b5bBDA85697DB1e5d66; // USDC.eth (Sepolia)
    address internal constant AGW_V6_FACTORY = 0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc;
    address internal constant AGW_V6_SESSION_ENGINE = 0xf63DC0628fe1B25049FE3E3a3585Ef051CB98c1d;
    uint256 internal constant DONUT_CHAIN_ID = 42101;

    struct CEAChain {
        string namespace;
        address ceaFactory;
        address ceaProxyImpl;
    }

    struct Deployed {
        address kernel;
        address hook;
        address rules;
        address marketplace;
    }

    function run() external returns (Deployed memory d) {
        require(block.chainid == DONUT_CHAIN_ID, "not Push Donut");
        uint256 key = _envKey("DEPLOYER_KEY");
        address me = vm.addr(key);
        address treasury = vm.addr(_envKey("TREASURE_KEY"));

        vm.startBroadcast(key);
        d.kernel = _proxy(
            address(new AgenticCommerce()), me, abi.encodeCall(AgenticCommerce.initialize, (PUSDC, treasury, me))
        );
        d.hook = _proxy(
            address(new RulesBindingHook()),
            me,
            abi.encodeCall(RulesBindingHook.initialize, (d.kernel, AGW_V6_FACTORY, AGW_V6_SESSION_ENGINE))
        );
        AgenticCommerce(d.kernel).setHookWhitelist(d.hook, true);
        d.rules = address(new UniversalMarketplaceRules());

        InitParams memory ip = InitParams({
            agwFactory: AGW_V6_FACTORY, kernel: d.kernel, hook: d.hook, evaluator: me, rules: d.rules, admin: me
        });
        d.marketplace =
            _proxy(address(new UniversalMarketplace()), me, abi.encodeCall(UniversalMarketplace.initialize, (ip)));

        CEAChain[] memory chains = _ceaChains();
        for (uint256 i; i < chains.length; ++i) {
            UniversalMarketplace(d.marketplace).setCEADeployment(
                keccak256(bytes(chains[i].namespace)), chains[i].ceaFactory, chains[i].ceaProxyImpl
            );
        }
        vm.stopBroadcast();

        _log(d, me, treasury);
    }

    /// @dev Accepts a private key with or without the 0x prefix.
    function _envKey(string memory name) internal view returns (uint256) {
        string memory raw = vm.envString(name);
        if (bytes(raw).length == 64) raw = string.concat("0x", raw);
        return vm.parseUint(raw);
    }

    function _proxy(address impl, address proxyAdminOwner, bytes memory init) internal returns (address) {
        return address(new TransparentUpgradeableProxy(impl, proxyAdminOwner, init));
    }

    /// @dev Live factories (gateway-testnet / core-testnet address docs); each proxy impl read from the factory's
    ///      `CEA_PROXY_IMPLEMENTATION()` on 2026-10-20.
    function _ceaChains() internal pure returns (CEAChain[] memory c) {
        c = new CEAChain[](4);
        c[0] = CEAChain(
            "eip155:11155111", 0x8ED594A83301FEc545fC6c19fc12cF7111777029, 0x0a4F7be62B56830070266be81114edB93e68DA09
        );
        c[1] = CEAChain(
            "eip155:84532", 0x0A75ca7736b488Eb41675ADc3b3156BACF659F55, 0x6c9Cfef12155bEE91ecD6d0C8f516cABA2890656
        );
        c[2] = CEAChain(
            "eip155:421614", 0x88DC189275078Cf509E4Cc773F089c8ad07b7EA2, 0x512d1B8C185a0Fd533a69f8973A3DD6513233009
        );
        c[3] = CEAChain(
            "eip155:97", 0x3f1B16e0B072d472951C4563d29d3da6a3EE3Ce8, 0x0ff5d8b7d9Ac3ee2Ad420e9b70Ed6Dc465f593e9
        );
    }

    function _log(Deployed memory d, address me, address treasury) internal pure {
        console.log("admin / proxy admin owner / evaluator:", me);
        console.log("treasury   ", treasury);
        console.log("kernel     ", d.kernel);
        console.log("hook       ", d.hook);
        console.log("rules      ", d.rules);
        console.log("marketplace", d.marketplace);
    }
}
