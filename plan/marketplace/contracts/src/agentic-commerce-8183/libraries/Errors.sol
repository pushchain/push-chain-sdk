// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title UniversalMarketplaceErrors
/// @notice Every error the marketplace, its rules helper and JobSpecBuilder raise.
/// @dev A library error has the same selector wherever it is raised, so a helper's revert bubbles through the
///      marketplace with the selector its callers expect.
library UniversalMarketplaceErrors {
    // ───────── config and cards ─────────

    error ZeroAddress();
    error HookNotWhitelisted();
    error AgentCardInactive();
    /// @dev The caller is not the card's provider (or the card does not exist).
    error CallerIsNotProvider();
    error AgentCardDisabled(uint256 cardId);
    error ChainNotSupported(bytes32 chainHash);
    /// @dev The single registration error; every `reason` is listed in the reference (Appendix B of PRD 12).
    error InvalidAgentCard(string reason);
    /// @dev `provided` is not the card's `current` version (openJob, verifyAgentCard).
    error AgentCardVersionMismatch(uint256 provided, uint256 current);
    /// @dev `updateAgentCard` tried to change the card's execution chain.
    error AgentCardIdentityImmutable();
    /// @dev One card per provider; a disabled card still counts.
    error AgentCardAlreadyRegistered(address provider);

    // ───────── openJob: the job ─────────

    error PrincipalOutOfRange();
    error ExpiryOutOfRange();
    error ExecuteByOutOfRange();
    /// @dev The configured evaluator is the card's provider (the evaluator changed after registration).
    error ProviderIsEvaluator();
    error ParamCountMismatch(uint256 expected, uint256 actual);
    error ParamOutOfRange(uint256 index, int256 value);
    /// @dev A PRINCIPAL_BPS target overflows: `principal × bps` does not fit uint256.
    error TargetOverflow(uint256 check);
    /// @dev The card's template writes fill `fill` of read `read` outside that read's args.
    error FillOutOfBounds(uint256 read, uint256 fill);

    // ───────── openJob: wallet and intent (same shapes as the AGW's errors of the same name) ─────────

    error IntentWalletMismatch(address expected, address provided);
    error ExecutorMismatch(address expected, address actual);
    error IntentSessionMismatch(bytes32 actual);
    error IntentExecMismatch(bytes32 actualCalldataHash);
    /// @dev The wallet's last job opened here is still active (`activeJobOf`).
    error WalletHasActiveJob(address agw, uint256 jobId);
    error AGWMismatch(address expected, address actual);
    error WalletOwnerMismatch(address expected, address actual);

    // ───────── openJob: rules = card ─────────

    error AgentMismatch();
    error ActionCount();
    error PolicyShape(uint256 i);
    /// @dev The envelope's first word is not `ENVELOPE_VERSION`; 0 when the envelope is shorter than one word.
    error EnvelopeVersionMismatch(uint256 actual);
    error ChainMismatch(uint256 i);
    error AssetCountMismatch(uint256 expected, uint256 actual);
    error AssetMismatch(uint256 index);
    error PrincipalCapMismatch();
    error GasCapMismatch();
    error ActionsMismatch();
    /// @dev Pin `pin` of allowed call `call` does not hold the card's value, with markers filled in.
    error PinMismatch(uint256 call, uint256 pin);
    error ExpiryMismatch();
    error ExpectedCEAMismatch(address expected, address actual);

    // ───────── openJob: the created job ─────────

    error UnexpectedJobCount(uint256 before, uint256 afterCount);
    error JobMismatch();
}

/// @title RulesBindingHookErrors
/// @notice The errors of the interim job hook.
library RulesBindingHookErrors {
    /// @notice `fund.optParams` is not exactly 32 bytes.
    error InvalidOptParams(uint256 length);
    /// @notice The funding client is not a factory-deployed AGW.
    error CallerIsNotAGW(address caller);
    /// @notice The rules set is not enabled on this AGW.
    error RulesNotLive(address agw, bytes32 rulesId);
    /// @notice The AGW already has a Funded or Submitted job under this hook.
    error AGWHasLiveJob(address agw, uint256 liveJobId);
}

/// @title ERC8183HookErrors
/// @notice The errors of BaseERC8183Hook, shared by every hook built on it.
library ERC8183HookErrors {
    /// @notice Caller is not the kernel.
    error CallerIsNotKernel(address caller);
    /// @notice A required address is zero.
    error ZeroAddress();
}
