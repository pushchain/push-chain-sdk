// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OwnerIntent} from "@push-agw/libraries/Types.sol";
import {Session} from "./external/IAGW.sol";
import {IAGWFactory} from "./external/IAGWFactory.sol";
import {IAgenticCommerce} from "./IAgenticCommerce.sol";
import {IUniversalMarketplaceRules} from "./IUniversalMarketplaceRules.sol";
import {AgentCard, AgentCardView, JobInputs, OpenJobParams, IntentRequest} from "../libraries/Types.sol";

/// @title IUniversalMarketplace
/// @notice Agent cards, and `openJob`: one relayed call that deploys the user's AGW (if needed), grants it the
///         card's rules, and creates the ERC-8183 job with the AGW as client. Moves no funds.
/// @dev Errors live in `UniversalMarketplaceErrors` (`libraries/Errors.sol`); types in `libraries/Types.sol`.
interface IUniversalMarketplace {
    // ═══ UM_1: EVENTS ═══

    /// @dev `rulesHash = keccak256(rules)`, `jobSpecHash = keccak256(jobSpecTemplate)`.
    event AgentCardRegistered(
        uint256 indexed cardId,
        address indexed provider,
        bytes32 indexed jobType,
        string chainNamespace,
        bytes32 rulesHash,
        bytes32 jobSpecHash,
        bytes32 metadataHash,
        uint256 providerFee
    );
    /// @notice The provider changed the card. `version` is the new version; the verified tag is cleared.
    event AgentCardUpdated(
        uint256 indexed cardId,
        uint256 version,
        bytes32 rulesHash,
        bytes32 jobSpecHash,
        bytes32 metadataHash,
        uint256 providerFee
    );
    /// @notice The provider switched the card on or off.
    event AgentCardStatusChanged(uint256 indexed cardId, bool active);
    /// @notice The admin disabled the card, permanently.
    event AgentCardDisabled(uint256 indexed cardId);
    /// @notice The admin verified the card AT `version`. Any later update clears the tag.
    event AgentCardVerified(uint256 indexed cardId, uint256 version);
    /// @notice The verified tag was removed: by the admin, by an update, or by `disableAgentCard`.
    event AgentCardVerificationRevoked(uint256 indexed cardId);
    /// @notice The admin set an agent's rating (placeholder until VerifiedRatings is wired).
    event AgentRatingSet(address indexed agent, uint256 rating);
    /// @notice New jobs get this hook.
    event HookUpdated(address hook);
    /// @notice New jobs get this evaluator.
    event EvaluatorUpdated(address evaluator);
    /// @notice A chain's CEA deployment was set, or cleared (both zero).
    event CEADeploymentSet(bytes32 indexed chainHash, address ceaFactory, address ceaProxyImpl);
    /// @notice `openJob` deployed (if needed) and granted the AGW, and created `jobId`.
    event JobOpened(
        uint256 indexed cardId,
        address indexed owner,
        address indexed agw,
        uint256 jobId,
        bytes32 rulesId,
        uint256 principal,
        uint256 cardVersion
    );

    // ═══ UM_2: ADMIN ═══

    /// @notice Sets the hook every new job is created with. Must be whitelisted on the kernel.
    function setHook(address hook) external;

    /// @notice Sets the evaluator every new job is created with.
    function setEvaluator(address evaluator) external;

    /// @notice Sets a destination chain's CEA deployment; `(chainHash, 0, 0)` clears it. A chain without one cannot
    ///         carry cards or jobs.
    function setCEADeployment(bytes32 chainHash, address ceaFactory, address ceaProxyImpl) external;

    /// @notice Sets an agent's rating. No validation; placeholder until VerifiedRatings is wired.
    function setAgentRating(address agent, uint256 rating) external;

    /// @notice Pauses card registration, update and `openJob`. Admin functions stay live.
    function pause() external;

    /// @notice Lifts `pause`.
    function unpause() external;

    /// @notice Permanently disables a card and clears its verified tag. The provider stays registered.
    function disableAgentCard(uint256 cardId) external;

    /// @notice Tags the card verified at `cardVersion`, which must be its current version.
    function verifyAgentCard(uint256 cardId, uint256 cardVersion) external;

    /// @notice Clears the verified tag. Idempotent.
    function revokeAgentCardVerification(uint256 cardId) external;

    // ═══ UM_3: CARDS ═══

    /// @notice Registers the caller's one card, with its content. The caller becomes its provider.
    /// @param c The card; `provider` and `active` are ignored.
    /// @param rules `abi.encode(AgentCardRules)`.
    /// @param jobSpecTemplate `abi.encode(JobSpecTemplate)`.
    function registerAgentCard(AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate)
        external
        returns (uint256 cardId);

    /// @notice Replaces every mutable field and both content blobs; bumps the version, clears the verified tag.
    function updateAgentCard(uint256 cardId, AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate)
        external;

    /// @notice The provider switches the card on or off. A disabled card cannot be switched on.
    function setAgentCardActive(uint256 cardId, bool active) external;

    // ═══ UM_4: JOBS ═══

    /// @notice Deploys the AGW if needed, grants the card's rules, and creates the job. Moves no funds.
    /// @return jobId The kernel job.
    /// @return agw The AGW, the job's client.
    /// @return rulesId The granted rules (the engine's permissionId).
    function openJob(OpenJobParams calldata p) external returns (uint256 jobId, address agw, bytes32 rulesId);

    // ═══ UM_5: VIEWS ═══

    /// @notice The card, its content, version and tags. The zero view for an unknown card.
    function getAgentCard(uint256 cardId) external view returns (AgentCardView memory);

    /// @notice Whether the admin has verified the card at its current version.
    function isAgentCardVerified(uint256 cardId) external view returns (bool);

    /// @notice Whether the admin has disabled the card. Permanent.
    function isAgentCardDisabled(uint256 cardId) external view returns (bool);

    /// @notice 1 at registration, +1 per update, 0 for an unknown card.
    function agentCardVersion(uint256 cardId) external view returns (uint256);

    /// @notice Cards registered so far; also the last card id.
    function agentCardCount() external view returns (uint256);

    /// @notice The provider's card id, or 0 for none.
    function agentCardOf(address provider) external view returns (uint256);

    /// @notice The agent's rating, 0 by default.
    function getAgentRating(address agent) external view returns (uint256);

    /// @notice The AGW's last job opened here while it is Funded, Submitted, or Open and unexpired; else 0.
    /// @dev Wider than the hook's `activeJobOf` (Funded or Submitted only): the marketplace binds at `openJob`, the
    ///      hook at `fund`.
    function activeJobOf(address agw) external view returns (uint256);

    /// @notice The card a job was opened from.
    function cardOfJob(uint256 jobId) external view returns (uint256);

    /// @notice The AGW a job was opened for.
    function agwOfJob(uint256 jobId) external view returns (address);

    /// @notice The rules set granted for a job.
    function rulesOfJob(uint256 jobId) external view returns (bytes32);

    /// @notice The card version a job was opened against.
    function cardVersionOfJob(uint256 jobId) external view returns (uint256);

    /// @notice The AGW's CEA on `chainHash`. Reverts `ChainNotSupported` for a chain without a CEA deployment.
    function computeCEA(address agw, bytes32 chainHash) external view returns (address);

    /// @notice The ERC-7579 single execution `openJob` makes the AGW run: `createJob` on the kernel.
    function buildCreateJobCalldata(uint256 cardId, address owner, uint96 index, JobInputs calldata job)
        external
        view
        returns (bytes32 mode, bytes memory executionCalldata);

    /// @notice The OwnerIntent the owner signs for `openJob`.
    function previewIntent(IntentRequest calldata r, Session calldata s) external view returns (OwnerIntent memory);

    /// @notice A chain's CEA factory and proxy implementation; zero when unsupported.
    function ceaDeployment(bytes32 chainHash) external view returns (address ceaFactory, address ceaProxyImpl);

    /// @notice The AGW factory. Set once, at initialization.
    function AGW_FACTORY() external view returns (IAGWFactory);

    /// @notice The ERC-8183 kernel. Set once, at initialization.
    function KERNEL() external view returns (IAgenticCommerce);

    /// @notice The rules-side helper (UniversalMarketplaceRules). Set once, at initialization.
    function RULES() external view returns (IUniversalMarketplaceRules);

    /// @notice keccak256("eip155:" ‖ decimal(block.chainid)): Push itself, which no card may name.
    function PUSH_CHAIN_HASH() external view returns (bytes32);

    /// @notice The hook new jobs get.
    function hook() external view returns (address);

    /// @notice The evaluator new jobs get.
    function evaluator() external view returns (address);

    /// @notice The contract's version, "2.0.0".
    function version() external pure returns (string memory);
}
