// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {IAgenticCommerce} from "./interfaces/IAgenticCommerce.sol";
import {IERC8183Hook} from "./interfaces/IERC8183Hook.sol";

/// @title AgenticCommerce
/// @notice ERC-8183 job escrow kernel for Push Chain.
/// @dev - Base shape: Virtuals `AgenticCommerceV3`, changed by K-01…K-11 (PRD Appendix A).
///      - Deployed behind `TransparentUpgradeableProxy`; upgrades go through its `ProxyAdmin`.
///      - Single payment token, assumed standard ERC-20 (no fee-on-transfer, no rebasing).
///      - Hooked functions run: checks → beforeAction → effects → transfers → events → afterAction
///        (`complete` interleaves each fee transfer with its event, per PRD §4.1.6).
contract AgenticCommerce is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IAgenticCommerce
{
    using SafeERC20 for IERC20;

    /// @inheritdoc IAgenticCommerce
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @inheritdoc IAgenticCommerce
    uint256 public constant EVALUATOR_GRACE_PERIOD = 1 hours;
    /// @inheritdoc IAgenticCommerce
    uint256 public constant MIN_EXPIRY_WINDOW = 5 minutes;
    /// @inheritdoc IAgenticCommerce
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ───────── storage — slots 0..57, append-only (PRD §4.1.4) ─────────

    /// @inheritdoc IAgenticCommerce
    IERC20 public paymentToken;
    /// @inheritdoc IAgenticCommerce
    uint256 public platformFeeBP;
    /// @inheritdoc IAgenticCommerce
    address public platformTreasury;
    /// @inheritdoc IAgenticCommerce
    uint256 public evaluatorFeeBP;
    /// @dev Read through `getJob`.
    mapping(uint256 => Job) internal jobs;
    /// @inheritdoc IAgenticCommerce
    uint256 public jobCounter;
    /// @inheritdoc IAgenticCommerce
    mapping(address => bool) public whitelistedHooks;
    /// @inheritdoc IAgenticCommerce
    uint256 public totalEscrowed;
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the proxy.
    /// @dev - Grants `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE` to `admin_`.
    ///      - Whitelists `address(0)` so hookless jobs are allowed.
    ///      - Fees start at 0.
    /// @param paymentToken_ The single payment token.
    /// @param treasury_ Platform fee recipient.
    /// @param admin_ Admin of roles, fees, hooks and pause.
    function initialize(address paymentToken_, address treasury_, address admin_) external initializer {
        if (paymentToken_ == address(0) || treasury_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        paymentToken = IERC20(paymentToken_);
        platformTreasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(ADMIN_ROLE, admin_);
        whitelistedHooks[address(0)] = true;
    }

    // ═════════════════════════════════ admin ═════════════════════════════════

    /// @inheritdoc IAgenticCommerce
    /// @dev - `claimRefund` stays callable while paused (K-05).
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @inheritdoc IAgenticCommerce
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /// @inheritdoc IAgenticCommerce
    function setPlatformFee(uint256 feeBP, address treasury) external onlyRole(ADMIN_ROLE) {
        if (treasury == address(0)) revert ZeroAddress();
        if (feeBP + evaluatorFeeBP > BPS_DENOMINATOR) revert FeesTooHigh();
        platformFeeBP = feeBP;
        platformTreasury = treasury;
        emit PlatformFeeUpdated(feeBP, treasury);
    }

    /// @inheritdoc IAgenticCommerce
    function setEvaluatorFee(uint256 feeBP) external onlyRole(ADMIN_ROLE) {
        if (feeBP + platformFeeBP > BPS_DENOMINATOR) revert FeesTooHigh();
        evaluatorFeeBP = feeBP;
        emit EvaluatorFeeUpdated(feeBP);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Affects new jobs only; an existing job keeps calling its hook.
    function setHookWhitelist(address hook, bool status) external onlyRole(ADMIN_ROLE) {
        if (hook == address(0)) revert ZeroAddress();
        whitelistedHooks[hook] = status;
        emit HookWhitelistUpdated(hook, status);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - A detached job behaves as hookless from then on.
    function batchDetachHook(uint256[] calldata jobIds) external onlyRole(ADMIN_ROLE) {
        uint256 n = jobCounter;
        for (uint256 i; i < jobIds.length; ++i) {
            uint256 jobId = jobIds[i];
            if (jobId == 0 || jobId > n) revert InvalidJob();
            address oldHook = jobs[jobId].hook;
            if (oldHook == address(0)) continue;
            jobs[jobId].hook = address(0);
            emit HookDetached(jobId, oldHook);
        }
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - K-02: escrow is untouchable; only `balance − totalEscrowed` of the payment token is free.
    ///      - D-27: ERC-20 only; no native branch.
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyRole(ADMIN_ROLE) whenPaused {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (token == address(paymentToken)) {
            uint256 bal = paymentToken.balanceOf(address(this));
            uint256 available = bal > totalEscrowed ? bal - totalEscrowed : 0;
            if (amount > available) revert InsufficientUnattributedBalance(amount, available);
        }
        IERC20(token).safeTransfer(to, amount);
        emit EmergencyWithdraw(token, to, amount);
    }

    // ═════════════════════════════════ lifecycle ═════════════════════════════════

    /// @inheritdoc IAgenticCommerce
    /// @dev - Not hooked (K-10).
    ///      - Evaluator must be non-zero (K-03); `evaluator == client` is allowed.
    function createJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        address hook
    ) external whenNotPaused nonReentrant returns (uint256 jobId) {
        if (evaluator == address(0)) revert ZeroAddress();
        if (expiredAt <= block.timestamp + MIN_EXPIRY_WINDOW || expiredAt > type(uint48).max) {
            revert ExpiryTooShort();
        }
        if (provider == msg.sender) revert ClientIsProvider();
        if (provider != address(0) && provider == evaluator) revert EvaluatorIsProvider();
        if (!whitelistedHooks[hook]) revert HookNotWhitelisted();
        if (hook != address(0) && !ERC165Checker.supportsInterface(hook, type(IERC8183Hook).interfaceId)) {
            revert InvalidHook();
        }

        jobId = ++jobCounter;
        jobs[jobId] = Job({
            client: msg.sender,
            status: JobStatus.Open,
            provider: provider,
            // forge-lint: disable-next-line(unsafe-typecast)
            expiredAt: uint48(expiredAt), // safe: bounded by the type(uint48).max check above
            evaluator: evaluator,
            hook: hook,
            budget: 0,
            description: description
        });
        emit JobCreated(jobId, msg.sender, provider, evaluator, expiredAt, hook);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Hooked, with `optParams` (K-04).
    function setProvider(uint256 jobId, address provider, bytes calldata optParams)
        external
        whenNotPaused
        nonReentrant
    {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider != address(0)) revert WrongStatus();
        if (provider == address(0)) revert ZeroAddress();
        if (provider == job.client) revert ClientIsProvider();
        if (provider == job.evaluator) revert EvaluatorIsProvider();

        bytes memory data = abi.encode(msg.sender, provider, optParams);
        _beforeHook(job.hook, jobId, data);
        job.provider = provider;
        emit ProviderSet(jobId, provider);
        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Re-callable while Open; `fund`'s `expectedBudget` guards against re-quotes.
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external whenNotPaused nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, amount, optParams);
        _beforeHook(job.hook, jobId, data);
        job.budget = amount;
        emit BudgetSet(jobId, amount);
        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Adds `budget` to `totalEscrowed`.
    ///      - A zero budget moves to Funded without a transfer.
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams)
        external
        whenNotPaused
        nonReentrant
    {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Open) revert WrongStatus();
        if (msg.sender != job.client) revert Unauthorized();
        if (job.provider == address(0)) revert ProviderNotSet();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();
        if (job.budget != expectedBudget) revert BudgetMismatch();

        bytes memory data = abi.encode(msg.sender, optParams);
        _beforeHook(job.hook, jobId, data);
        uint256 budget = job.budget;
        job.status = JobStatus.Funded;
        totalEscrowed += budget;
        if (budget > 0) paymentToken.safeTransferFrom(msg.sender, address(this), budget);
        emit JobFunded(jobId, msg.sender, budget);
        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Funded only (K-11); no auto-complete (K-03).
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external whenNotPaused nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Funded) revert WrongStatus();
        if (block.timestamp >= job.expiredAt) revert WrongStatus();
        if (msg.sender != job.provider) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, deliverable, optParams);
        _beforeHook(job.hook, jobId, data);
        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, msg.sender, deliverable);
        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Allowed after `expiredAt`; races `claimRefund` once the grace window ends.
    ///      - Event order is normative: PlatformFeePaid → EvaluatorFeePaid → JobCompleted → PaymentReleased.
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external whenNotPaused nonReentrant {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Submitted) revert WrongStatus();
        if (msg.sender != job.evaluator) revert Unauthorized();

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, data);

        uint256 budget = job.budget;
        job.status = JobStatus.Completed;
        totalEscrowed -= budget;

        uint256 platformFee = (budget * platformFeeBP) / BPS_DENOMINATOR;
        uint256 evalFee = (budget * evaluatorFeeBP) / BPS_DENOMINATOR;
        uint256 net = budget - platformFee - evalFee;
        address provider = job.provider;

        if (platformFee > 0) {
            address treasury = platformTreasury;
            paymentToken.safeTransfer(treasury, platformFee);
            emit PlatformFeePaid(jobId, treasury, platformFee);
        }
        if (evalFee > 0) {
            // msg.sender is the evaluator (checked above).
            paymentToken.safeTransfer(msg.sender, evalFee);
            emit EvaluatorFeePaid(jobId, msg.sender, evalFee);
        }
        if (net > 0) paymentToken.safeTransfer(provider, net);
        emit JobCompleted(jobId, msg.sender, reason);
        emit PaymentReleased(jobId, provider, net);

        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Open: client or provider. Funded/Submitted: evaluator only.
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external whenNotPaused nonReentrant {
        Job storage job = _job(jobId);
        JobStatus prev = job.status;
        if (prev == JobStatus.Open) {
            if (msg.sender != job.client && msg.sender != job.provider) revert Unauthorized();
        } else if (prev == JobStatus.Funded || prev == JobStatus.Submitted) {
            if (msg.sender != job.evaluator) revert Unauthorized();
        } else {
            revert WrongStatus();
        }

        bytes memory data = abi.encode(msg.sender, reason, optParams);
        _beforeHook(job.hook, jobId, data);
        job.status = JobStatus.Rejected;
        if (prev != JobStatus.Open) _refund(jobId, job);
        emit JobRejected(jobId, msg.sender, reason);
        _afterHook(job.hook, jobId, data);
    }

    /// @inheritdoc IAgenticCommerce
    /// @dev - Not pausable (K-05): refunds must never be blockable.
    ///      - Not hooked: a broken hook cannot trap funds.
    ///      - Submitted jobs wait `EVALUATOR_GRACE_PERIOD` after expiry (K-06).
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _job(jobId);
        JobStatus prev = job.status;
        if (prev != JobStatus.Open && prev != JobStatus.Funded && prev != JobStatus.Submitted) revert WrongStatus();
        if (prev == JobStatus.Submitted) {
            if (block.timestamp < uint256(job.expiredAt) + EVALUATOR_GRACE_PERIOD) revert GracePeriodActive();
        } else if (block.timestamp < job.expiredAt) {
            revert WrongStatus();
        }

        job.status = JobStatus.Expired;
        if (prev != JobStatus.Open) _refund(jobId, job);
        emit JobExpired(jobId);
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    /// @inheritdoc IAgenticCommerce
    function getJob(uint256 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    // ═════════════════════════════════ internal ═════════════════════════════════

    /// @dev Loads a job; reverts `InvalidJob` for 0 or unknown ids.
    function _job(uint256 jobId) internal view returns (Job storage) {
        if (jobId == 0 || jobId > jobCounter) revert InvalidJob();
        return jobs[jobId];
    }

    /// @dev Returns a Funded/Submitted job's escrow to the client and releases it from `totalEscrowed`.
    function _refund(uint256 jobId, Job storage job) internal {
        uint256 budget = job.budget;
        if (budget == 0) return;
        totalEscrowed -= budget;
        paymentToken.safeTransfer(job.client, budget);
        emit Refunded(jobId, job.client, budget);
    }

    /// @dev Calls `beforeAction` with the current function's selector; no-op without a hook.
    function _beforeHook(address hook, uint256 jobId, bytes memory data) internal {
        if (hook != address(0)) IERC8183Hook(hook).beforeAction(jobId, msg.sig, data);
    }

    /// @dev Calls `afterAction` with the current function's selector; no-op without a hook.
    function _afterHook(address hook, uint256 jobId, bytes memory data) internal {
        if (hook != address(0)) IERC8183Hook(hook).afterAction(jobId, msg.sig, data);
    }
}
