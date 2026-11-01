// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Session} from "./external/IAGW.sol";
import {SessionContext} from "../libraries/Types.sol";

/// @title IUniversalMarketplaceRules
/// @notice The rules side of an agent card: validates its `AgentCardRules` at registration, and checks the
///         owner-signed session against the card at `openJob`. EVM universal only. Reverts with
///         `UniversalMarketplaceErrors`.
interface IUniversalMarketplaceRules {
    // ═══ UMR_1: RULES ═══

    /// @notice Registration guards on a card's rules (R1-R17). Reverts `InvalidAgentCard(reason)` on the first
    ///         violation.
    /// @dev - Assets: count, principal index, no zero, no duplicate; the principal asset's total cap is
    ///        `MARKER_PRINCIPAL`, its per-call cap non-zero; no marker on any other asset.
    ///      - Allowed calls: count, pin counts, `MARKER_WALLET` under EQ only, no identical entries, no pinless entry
    ///        beside a pinned one, ERC-20 approve / transfer / transferFrom pinned, no increaseAllowance.
    /// @param rules `abi.encode(AgentCardRules)`.
    /// @return tokens Every asset's token, for the marketplace's chain check.
    function validateAgentCardRules(bytes calldata rules) external pure returns (address[] memory tokens);

    /// @notice Rules = card (C1-C14): the session grants exactly the card's rules, markers filled for this job,
    ///         to the card's agent, bound to this job and CEA. Reverts on the first mismatch.
    /// @dev - Shape: agent, one action, one policy, envelope version, chain.
    ///      - Terms: assets and caps, gas cap, allowed calls and pins, expiry, expected CEA.
    /// @param cardRules The card's stored `abi.encode(AgentCardRules)`.
    /// @param session The owner-signed session.
    /// @param ctx The job's values.
    function checkRulesMatchCard(bytes calldata cardRules, Session calldata session, SessionContext calldata ctx)
        external
        pure;
}
