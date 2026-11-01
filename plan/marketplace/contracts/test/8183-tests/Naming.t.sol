// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import {RulesBindingHook} from "../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol";
import {UniversalMarketplaceRules} from "../../src/agentic-commerce-8183/UniversalMarketplaceRules.sol";
import {IUniversalMarketplace} from "../../src/agentic-commerce-8183/interfaces/IUniversalMarketplace.sol";
import {IUniversalMarketplaceRules} from "../../src/agentic-commerce-8183/interfaces/IUniversalMarketplaceRules.sol";
import {
    UniversalMarketplaceErrors,
    RulesBindingHookErrors,
    ERC8183HookErrors
} from "../../src/agentic-commerce-8183/libraries/Errors.sol";
import {MARKER_WALLET, MARKER_PRINCIPAL} from "../../src/agentic-commerce-8183/libraries/Types.sol";

/// @notice TEST ONLY: exposes the rules helper's ERC-20 selector constants.
contract RulesSelectorsHarness is UniversalMarketplaceRules {
    function selectors() external pure returns (bytes4, bytes4, bytes4, bytes4) {
        return (ERC20_TRANSFER, ERC20_APPROVE, ERC20_TRANSFER_FROM, ERC20_INCREASE_ALLOWANCE);
    }
}

/// @title Naming — the marketplace's v2 surface (PRD 12 §3, §6.8), pinned against LITERAL signatures.
/// @notice A rename that drifts from the PRD, or a type change that moved a selector, fails here.
contract NamingTest is Test {
    // The struct tuples, spelled out: a field change moves every selector that takes one.
    string internal constant AGENT_CARD =
        "(address,bytes32,string,bytes32,string,uint256,address,uint256,uint256,uint32,uint32,uint32,uint32,bool)";
    string internal constant JOB_INPUTS = "(uint256,uint48,uint48,int256[])";
    string internal constant OWNER_INTENT =
        "(address,address,address,uint96,bytes32,bytes32,bytes32,uint192,uint64,uint64,uint48,uint256)";
    string internal constant SESSION =
        "(address,bytes,bytes32,(address,bytes)[],((bytes32,string[])[],(address,bytes)[]),(bytes4,address,(address,bytes)[])[],bool)";
    string internal constant SESSION_CONTEXT = "(address,bytes32,uint256,uint48,address)";

    function _sel(string memory sig) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(sig)));
    }

    function test_naming_marketplaceFunctions() public pure {
        assertEq(
            IUniversalMarketplace.openJob.selector,
            _sel(
                string.concat(
                    "openJob((uint256,uint256,", JOB_INPUTS, ",", SESSION, ",", OWNER_INTENT, ",bytes,string))"
                )
            )
        );
        assertEq(
            IUniversalMarketplace.registerAgentCard.selector,
            _sel(string.concat("registerAgentCard(", AGENT_CARD, ",bytes,bytes)"))
        );
        assertEq(
            IUniversalMarketplace.updateAgentCard.selector,
            _sel(string.concat("updateAgentCard(uint256,", AGENT_CARD, ",bytes,bytes)"))
        );
        assertEq(IUniversalMarketplace.setAgentCardActive.selector, _sel("setAgentCardActive(uint256,bool)"));
        assertEq(IUniversalMarketplace.disableAgentCard.selector, _sel("disableAgentCard(uint256)"));
        assertEq(IUniversalMarketplace.getAgentCard.selector, _sel("getAgentCard(uint256)"));
        assertEq(IUniversalMarketplace.isAgentCardVerified.selector, _sel("isAgentCardVerified(uint256)"));
        assertEq(IUniversalMarketplace.isAgentCardDisabled.selector, _sel("isAgentCardDisabled(uint256)"));
        assertEq(IUniversalMarketplace.agentCardVersion.selector, _sel("agentCardVersion(uint256)"));
        assertEq(IUniversalMarketplace.agentCardCount.selector, _sel("agentCardCount()"));
        assertEq(IUniversalMarketplace.agentCardOf.selector, _sel("agentCardOf(address)"));
        assertEq(IUniversalMarketplace.activeJobOf.selector, _sel("activeJobOf(address)"));
        assertEq(IUniversalMarketplace.computeCEA.selector, _sel("computeCEA(address,bytes32)"));
        assertEq(IUniversalMarketplace.cardVersionOfJob.selector, _sel("cardVersionOfJob(uint256)"));
        assertEq(IUniversalMarketplace.getAgentRating.selector, _sel("getAgentRating(address)"));
        assertEq(IUniversalMarketplace.setAgentRating.selector, _sel("setAgentRating(address,uint256)"));
        assertEq(IUniversalMarketplace.RULES.selector, _sel("RULES()"));
        assertEq(IUniversalMarketplace.PUSH_CHAIN_HASH.selector, _sel("PUSH_CHAIN_HASH()"));
        assertEq(IUniversalMarketplace.version.selector, _sel("version()"));
        assertEq(IUniversalMarketplace.AGW_FACTORY.selector, _sel("AGW_FACTORY()"));
        assertEq(IUniversalMarketplace.KERNEL.selector, _sel("KERNEL()"));
        assertEq(
            IUniversalMarketplace.previewIntent.selector,
            _sel(
                string.concat(
                    "previewIntent((uint256,address,uint96,", JOB_INPUTS, ",uint48,uint256),", SESSION, ")"
                )
            )
        );
        assertEq(
            IUniversalMarketplaceRules.validateAgentCardRules.selector, _sel("validateAgentCardRules(bytes)")
        );
        assertEq(
            IUniversalMarketplaceRules.checkRulesMatchCard.selector,
            _sel(string.concat("checkRulesMatchCard(bytes,", SESSION, ",", SESSION_CONTEXT, ")"))
        );
    }

    function test_naming_marketplaceEvents() public pure {
        assertEq(
            IUniversalMarketplace.AgentCardRegistered.selector,
            keccak256("AgentCardRegistered(uint256,address,bytes32,string,bytes32,bytes32,bytes32,uint256)")
        );
        assertEq(
            IUniversalMarketplace.AgentCardUpdated.selector,
            keccak256("AgentCardUpdated(uint256,uint256,bytes32,bytes32,bytes32,uint256)")
        );
        assertEq(IUniversalMarketplace.AgentCardStatusChanged.selector, keccak256("AgentCardStatusChanged(uint256,bool)"));
        assertEq(IUniversalMarketplace.AgentCardDisabled.selector, keccak256("AgentCardDisabled(uint256)"));
        assertEq(IUniversalMarketplace.AgentCardVerified.selector, keccak256("AgentCardVerified(uint256,uint256)"));
        assertEq(
            IUniversalMarketplace.AgentCardVerificationRevoked.selector, keccak256("AgentCardVerificationRevoked(uint256)")
        );
        assertEq(IUniversalMarketplace.AgentRatingSet.selector, keccak256("AgentRatingSet(address,uint256)"));
        assertEq(IUniversalMarketplace.HookUpdated.selector, keccak256("HookUpdated(address)"));
        assertEq(IUniversalMarketplace.EvaluatorUpdated.selector, keccak256("EvaluatorUpdated(address)"));
        assertEq(
            IUniversalMarketplace.CEADeploymentSet.selector, keccak256("CEADeploymentSet(bytes32,address,address)")
        );
        assertEq(
            IUniversalMarketplace.JobOpened.selector,
            keccak256("JobOpened(uint256,address,address,uint256,bytes32,uint256,uint256)")
        );
    }

    function test_naming_hookTopicsAndErrors() public pure {
        assertEq(RulesBindingHook.RulesBound.selector, keccak256("RulesBound(uint256,address,bytes32)"));
        assertEq(RulesBindingHookErrors.RulesNotLive.selector, bytes4(keccak256("RulesNotLive(address,bytes32)")));
        assertEq(RulesBindingHookErrors.CallerIsNotAGW.selector, bytes4(keccak256("CallerIsNotAGW(address)")));
        assertEq(RulesBindingHookErrors.AGWHasLiveJob.selector, bytes4(keccak256("AGWHasLiveJob(address,uint256)")));
        assertEq(ERC8183HookErrors.CallerIsNotKernel.selector, bytes4(keccak256("CallerIsNotKernel(address)")));
    }

    function test_naming_marketplaceErrors() public pure {
        assertEq(UniversalMarketplaceErrors.CallerIsNotProvider.selector, _sel("CallerIsNotProvider()"));
        assertEq(UniversalMarketplaceErrors.ZeroAddress.selector, _sel("ZeroAddress()"));
        assertEq(UniversalMarketplaceErrors.FillOutOfBounds.selector, _sel("FillOutOfBounds(uint256,uint256)"));
        // renamed
        assertEq(UniversalMarketplaceErrors.AgentCardInactive.selector, _sel("AgentCardInactive()"));
        assertEq(UniversalMarketplaceErrors.AgentCardDisabled.selector, _sel("AgentCardDisabled(uint256)"));
        assertEq(UniversalMarketplaceErrors.InvalidAgentCard.selector, _sel("InvalidAgentCard(string)"));
        assertEq(
            UniversalMarketplaceErrors.AgentCardVersionMismatch.selector,
            _sel("AgentCardVersionMismatch(uint256,uint256)")
        );
        assertEq(UniversalMarketplaceErrors.AgentCardIdentityImmutable.selector, _sel("AgentCardIdentityImmutable()"));
        assertEq(UniversalMarketplaceErrors.WalletHasActiveJob.selector, _sel("WalletHasActiveJob(address,uint256)"));
        assertEq(UniversalMarketplaceErrors.PrincipalCapMismatch.selector, _sel("PrincipalCapMismatch()"));
        assertEq(UniversalMarketplaceErrors.GasCapMismatch.selector, _sel("GasCapMismatch()"));
        assertEq(UniversalMarketplaceErrors.AssetMismatch.selector, _sel("AssetMismatch(uint256)"));
        // new
        assertEq(
            UniversalMarketplaceErrors.AgentCardAlreadyRegistered.selector, _sel("AgentCardAlreadyRegistered(address)")
        );
        assertEq(UniversalMarketplaceErrors.EnvelopeVersionMismatch.selector, _sel("EnvelopeVersionMismatch(uint256)"));
        assertEq(
            UniversalMarketplaceErrors.AssetCountMismatch.selector, _sel("AssetCountMismatch(uint256,uint256)")
        );
        assertEq(UniversalMarketplaceErrors.PinMismatch.selector, _sel("PinMismatch(uint256,uint256)"));
    }

    function test_naming_hookViews() public {
        address kernel = makeAddr("kernel");
        address factory = makeAddr("factory");
        address engine = makeAddr("engine");
        RulesBindingHook hook = RulesBindingHook(
            address(
                new TransparentUpgradeableProxy(
                    address(new RulesBindingHook()),
                    makeAddr("hookAdmin"),
                    abi.encodeCall(RulesBindingHook.initialize, (kernel, factory, engine))
                )
            )
        );
        assertEq(hook.rulesOfJob.selector, _sel("rulesOfJob(uint256)"));
        assertEq(hook.agwOfJob.selector, _sel("agwOfJob(uint256)"));
        assertEq(hook.activeJobOf.selector, _sel("activeJobOf(address)"));
        assertEq(hook.AGW_FACTORY.selector, _sel("AGW_FACTORY()"));
        assertEq(hook.SESSION_ENGINE.selector, _sel("SESSION_ENGINE()"));
        assertEq(hook.KERNEL.selector, _sel("KERNEL()"));
        assertEq(hook.KERNEL(), kernel);
        assertEq(hook.AGW_FACTORY(), factory);
        assertEq(hook.SESSION_ENGINE(), engine);
        assertEq(hook.rulesOfJob(1), bytes32(0));
        assertEq(hook.agwOfJob(1), address(0));
    }

    function test_naming_derivedErc20Selectors() public {
        (bytes4 transfer, bytes4 approve, bytes4 transferFrom, bytes4 increaseAllowance) =
            new RulesSelectorsHarness().selectors();
        assertEq(transfer, bytes4(0xa9059cbb));
        assertEq(approve, bytes4(0x095ea7b3));
        assertEq(transferFrom, bytes4(0x23b872dd));
        assertEq(increaseAllowance, bytes4(0x39509351));
    }

    function test_naming_markers() public pure {
        assertEq(MARKER_WALLET, keccak256("push.marketplace.marker.WALLET"));
        assertEq(MARKER_PRINCIPAL, keccak256("push.marketplace.marker.PRINCIPAL"));
        // non-zero high 96 bits: neither marker is a clean address word, so neither can pass as a spender pin
        assertGt(uint256(MARKER_WALLET) >> 160, 0);
        assertGt(uint256(MARKER_PRINCIPAL) >> 160, 0);
    }

    function test_naming_noMandateInABIs() public view {
        string[3] memory artifacts = [
            "out/UniversalMarketplace.sol/UniversalMarketplace.json",
            "out/UniversalMarketplaceRules.sol/UniversalMarketplaceRules.json",
            "out/RulesBindingHook.sol/RulesBindingHook.json"
        ];
        for (uint256 i; i < artifacts.length; ++i) {
            string memory abiSection = vm.split(vm.readFile(artifacts[i]), '"bytecode"')[0];
            assertEq(vm.indexOf(abiSection, "andate"), type(uint256).max, artifacts[i]);
            assertEq(vm.indexOf(abiSection, "permissionId"), type(uint256).max, artifacts[i]);
        }
    }
}
