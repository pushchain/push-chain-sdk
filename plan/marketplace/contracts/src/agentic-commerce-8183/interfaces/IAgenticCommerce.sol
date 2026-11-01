// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IAgenticCommerce
/// @notice External surface of the ERC-8183 kernel on Push Chain.
/// @dev - Events and errors are declared only here.
///      - Hooks and tests take selectors from this interface, never from signature strings.
interface IAgenticCommerce {
    // ──────────────────────────────── types ────────────────────────────────

    /// @notice Job lifecycle states.
    enum JobStatus {
        Open,
        Funded,
        Submitted,
        Completed,
        Rejected,
        Expired
    }

    /// @notice A job record.
    /// @dev - `provider` may be zero until `setProvider`.
    ///      - `hook == address(0)` means no hook.
    struct Job {
        address client;
        JobStatus status;
        address provider;
        uint48 expiredAt;
        address evaluator;
        address hook;
        uint256 budget;
        string description;
    }

    // ──────────────────────────────── events ────────────────────────────────

    /// @notice A job was created.
    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint256 expiredAt,
        address hook
    );
    /// @notice A provider was assigned to an Open job.
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    /// @notice The provider set or re-quoted the budget.
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    /// @notice The client funded the escrow.
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    /// @notice The provider submitted a deliverable.
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    /// @notice The evaluator completed the job.
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    /// @notice The job was rejected.
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    /// @notice The job expired through `claimRefund`.
    event JobExpired(uint256 indexed jobId);
    /// @notice Net payment released to the provider. Emitted on every completion, even at 0.
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    /// @notice Platform fee paid to the treasury.
    event PlatformFeePaid(uint256 indexed jobId, address indexed treasury, uint256 amount);
    /// @notice Evaluator fee paid.
    event EvaluatorFeePaid(uint256 indexed jobId, address indexed evaluator, uint256 amount);
    /// @notice Escrow returned to the client.
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);
    /// @notice A hook's whitelist status changed.
    event HookWhitelistUpdated(address indexed hook, bool status);
    /// @notice An admin detached a hook from a job.
    event HookDetached(uint256 indexed jobId, address indexed hook);
    /// @notice Platform fee or treasury changed.
    event PlatformFeeUpdated(uint256 feeBP, address indexed treasury);
    /// @notice Evaluator fee changed.
    event EvaluatorFeeUpdated(uint256 feeBP);
    /// @notice Unattributed tokens withdrawn while paused.
    event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount);

    // ──────────────────────────────── errors ────────────────────────────────

    /// @notice Job id is 0 or beyond `jobCounter`.
    error InvalidJob();
    /// @notice Job is not in a status that permits the action.
    error WrongStatus();
    /// @notice Caller is not the role this action requires.
    error Unauthorized();
    /// @notice A required address is zero.
    error ZeroAddress();
    /// @notice `expiredAt` is not beyond `now + MIN_EXPIRY_WINDOW`, or exceeds `uint48`.
    error ExpiryTooShort();
    /// @notice `fund` called before a provider was set.
    error ProviderNotSet();
    /// @notice Platform + evaluator fees would exceed 100%.
    error FeesTooHigh();
    /// @notice Hook is not whitelisted.
    error HookNotWhitelisted();
    /// @notice Hook does not advertise `IERC8183Hook` via ERC-165.
    error InvalidHook();
    /// @notice `expectedBudget` differs from the stored budget.
    error BudgetMismatch();
    /// @notice Evaluator and provider are the same address.
    error EvaluatorIsProvider();
    /// @notice Client and provider are the same address.
    error ClientIsProvider();
    /// @notice A Submitted job is still inside the evaluator grace window.
    error GracePeriodActive();
    /// @notice Withdrawal would take escrowed funds.
    error InsufficientUnattributedBalance(uint256 requested, uint256 available);

    // ──────────────────────────────── constants ────────────────────────────────

    /// @notice Role for fees, hooks, pause and emergency withdrawal.
    /// @return The role id.
    function ADMIN_ROLE() external view returns (bytes32);
    /// @notice Window after expiry in which a Submitted job cannot be refunded.
    /// @return Seconds.
    function EVALUATOR_GRACE_PERIOD() external view returns (uint256);
    /// @notice Minimum distance between now and `expiredAt` at creation.
    /// @return Seconds.
    function MIN_EXPIRY_WINDOW() external view returns (uint256);
    /// @notice Basis-point denominator.
    /// @return The denominator.
    function BPS_DENOMINATOR() external view returns (uint256);

    // ──────────────────────────────── admin ────────────────────────────────

    /// @notice Pause every lifecycle function except `claimRefund`.
    function pause() external;
    /// @notice Unpause.
    function unpause() external;
    /// @notice Set the platform fee and treasury.
    /// @param feeBP Fee in basis points.
    /// @param treasury Fee recipient.
    function setPlatformFee(uint256 feeBP, address treasury) external;
    /// @notice Set the evaluator fee.
    /// @param feeBP Fee in basis points.
    function setEvaluatorFee(uint256 feeBP) external;
    /// @notice Whitelist or de-whitelist a hook for new jobs.
    /// @param hook Hook address.
    /// @param status Whitelisted or not.
    function setHookWhitelist(address hook, bool status) external;
    /// @notice Detach hooks from jobs (emergency).
    /// @param jobIds Jobs to detach.
    function batchDetachHook(uint256[] calldata jobIds) external;
    /// @notice Withdraw tokens that are not escrow, while paused.
    /// @param token ERC-20 to withdraw; never zero.
    /// @param to Recipient.
    /// @param amount Amount.
    function emergencyWithdraw(address token, address to, uint256 amount) external;

    // ──────────────────────────────── lifecycle ────────────────────────────────

    /// @notice Create a job; the caller is the client.
    /// @param provider Provider, or zero to set later.
    /// @param evaluator Evaluator; never zero.
    /// @param expiredAt Expiry timestamp.
    /// @param description Free-text description.
    /// @param hook Whitelisted hook, or zero.
    /// @return jobId The new job id.
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external returns (uint256 jobId);

    /// @notice Assign the provider of an Open job. Client only.
    /// @param jobId The job.
    /// @param provider The provider.
    /// @param optParams Opaque hook payload.
    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external;

    /// @notice Set or re-quote the budget. Provider only.
    /// @param jobId The job.
    /// @param amount Budget in payment-token units.
    /// @param optParams Opaque hook payload.
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external;

    /// @notice Fund the escrow. Client only.
    /// @param jobId The job.
    /// @param expectedBudget Must equal the stored budget.
    /// @param optParams Opaque hook payload.
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams) external;

    /// @notice Submit a deliverable. Provider only.
    /// @param jobId The job.
    /// @param deliverable Deliverable hash or reference.
    /// @param optParams Opaque hook payload.
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external;

    /// @notice Complete and pay out. Evaluator only.
    /// @param jobId The job.
    /// @param reason Attestation reason.
    /// @param optParams Opaque hook payload.
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    /// @notice Reject; refunds escrow if funded.
    /// @param jobId The job.
    /// @param reason Rejection reason.
    /// @param optParams Opaque hook payload.
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external;

    /// @notice Refund an expired job. Anyone may call.
    /// @param jobId The job.
    function claimRefund(uint256 jobId) external;

    // ──────────────────────────────── views ────────────────────────────────

    /// @notice Full job record; zero struct for unknown ids.
    /// @param jobId The job.
    /// @return The job.
    function getJob(uint256 jobId) external view returns (Job memory);

    /// @notice The single payment token.
    /// @return The token.
    function paymentToken() external view returns (IERC20);
    /// @notice Platform fee in basis points.
    /// @return Basis points.
    function platformFeeBP() external view returns (uint256);
    /// @notice Platform fee recipient.
    /// @return The recipient.
    function platformTreasury() external view returns (address);
    /// @notice Evaluator fee in basis points.
    /// @return Basis points.
    function evaluatorFeeBP() external view returns (uint256);
    /// @notice Last job id issued.
    /// @return The last id issued.
    function jobCounter() external view returns (uint256);
    /// @notice Whether a hook may be used on new jobs.
    /// @param hook Hook address.
    /// @return Whether whitelisted.
    function whitelistedHooks(address hook) external view returns (bool);
    /// @notice Sum of budgets of Funded and Submitted jobs.
    /// @return The escrowed sum.
    function totalEscrowed() external view returns (uint256);
}
