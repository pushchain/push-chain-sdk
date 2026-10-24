// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAgenticCommerce} from "../interfaces/IAgenticCommerce.sol";
import {IUniversalEvaluator} from "../interfaces/IUniversalEvaluator.sol";
import {IUniversalCallback} from "../../interfaces/IUniversalCallback.sol";
import {RequestStatus, MAX_CALLBACK_GAS_LIMIT} from "../../libraries/ReadTypes.sol";
import {JobSpec, Read, Check, ReadAt} from "../libraries/JobSpecTypes.sol";
import {
    Answer,
    Verdict,
    OwnerCheck,
    PackedCheck,
    ReadPlan,
    ReadConfig,
    MAX_RESULT_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    IAGWCheckpoints,
    IUniversalCoreHeights,
    IReadStateDomains
} from "./EvaluationTypes.sol";
import {JobSpecLib} from "./JobSpecLib.sol";
import {EvmReadLib, FireParams} from "./EvmReadLib.sol";
import {UniversalEvaluatorErrors, JobSpecErrors} from "../libraries/Errors.sol";

/// @title UniversalEvaluator
/// @notice One evaluator for every job. It holds each job's spec, prepaid PC, PRE_EXECUTION snapshot and evaluation:
///         - inside `fund`, the UniversalHook hands it the final spec (`startSnapshot`): it is checked, frozen, every
///           read's fresh tracked height is recorded, and every PRE_EXECUTION read is read there (the snapshot);
///         - inside `submit`, the hook calls `verifyFromSubmit`: the end block of every POST_EXECUTION read is fixed at
///           its fresh tracked height, which must be above the one recorded at `fund`, then each is sent at its block;
///         - the callback that delivers the last answer works out the verdict and applies it: PASS completes,
///           FAIL rejects.
/// @dev - The end blocks are recorded before the reads are sent, and sending runs in its own guarded call, so a
///        failure to send (PC short, Read State paused) never loses them; the provider sends later (`sendReads`) at
///        the same blocks.
///      - Every tracked height used (at `fund` and at `submit`) must be at most `MAX_HEIGHT_AGE` old.
///      - The end blocks are fixed only inside `submit`: the hook calls `verifyFromSubmit` without try/catch, so if
///        they can't be fixed (a stale or unmoved height, too little gas) `submit` reverts and is sent again later.
///      - An unreadable answer counts as answered, PRE or POST: the checks that need it stay UNKNOWN and the rest may
///        still decide the root. Once the evaluation starts, an unreadable PRE read is sent again with the POST reads.
///      - Retries re-read the same blocks; there is no attempt limit. Only the provider spends PC on reads after
///        `submit` (`sendReads`), and only while the job is Submitted and undecided; snapshot retries
///        (`retrySnapshot`, until the evaluation starts) are the client's or the provider's.
///      - A job with no verdict ends through the kernel: after `expiredAt + EVALUATOR_GRACE_PERIOD` anyone may call
///        `claimRefund`, which refunds the client and frees the wallet.
///      - Answers longer than `MAX_RESULT_LENGTH` are unreadable. Read State itself does not cap answers yet.
///      - The verdict is applied as soon as the root is decided: the three-valued logic is monotone, so once the
///        root is PASS or FAIL no later answer can change it, and reads still out don't hold up payment.
///      - The kernel `reason` commits to the spec and to every read's evidence (`evidenceOf`) in index order, zero
///        for a read not answered when the root was decided, so it can be re-derived from events.
///      - `JobSpec.executeBy` and `JobSpec.failFinalAt` are not used: a FAIL at fixed blocks is final.
///      - `JobSpecLib.validate` runs in a linked library (DELEGATECALL; its address is fixed in this bytecode at
///        deployment, and it is stateless). Everything else, `EvmReadLib` included, is compiled in.
///      - Not upgradeable, with no admin: how this evaluator judges a frozen spec can't change. A rule change is a new
///        evaluator for new jobs; every job settles through the evaluator recorded in it at `createJob`. The kernel
///        and the hook stay trust points: both are upgradeable, and the kernel admin can detach a job's hook.
contract UniversalEvaluator is IUniversalEvaluator, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice What the evaluator keeps per job once its spec is frozen.
    struct JobCache {
        address client;
        uint8 logicCount; // entries in the packed logic
        bool frozen;
        bool checkpointOk; // the wallet's counter could be read at `fund`
        uint64 checkpointAtFund;
        bytes32 specHash; // keccak256 of the exact frozen spec bytes
        uint256[2] readChecks; // per read i, a 16-bit mask of the checks that use it: word i / 16, bits 16·(i % 16)
    }

    /// @notice The PRE_EXECUTION snapshot of a job.
    struct Snapshot {
        uint8 needed; // PRE_EXECUTION reads
        uint32 pre; // bit i: read i is PRE_EXECUTION
        uint32 answered; // bit i: PRE read i answered, usable or not; never cleared
    }

    /// @notice The evaluation of a submitted job.
    struct Evaluation {
        bool endFixed; // the end blocks are recorded
        bool started; // the POST reads were sent
        uint8 reads;
        uint8 pending; // reads still waiting for an answer
        bool done; // a verdict was worked out from the current answers
        Verdict verdict;
        bool applied; // the kernel accepted the verdict
        OwnerCheck ownerCheck; // recorded only
        uint32 checkRes; // each check's result, 2 bits per check (JobSpecLib)
        uint32 answered; // bit i: read i answered since it was last sent; PRE reads start answered by the snapshot
    }

    /// @notice Which read of which job a Read State request answers.
    struct RequestRef {
        uint256 jobId;
        uint8 read;
        bool snapshot;
    }

    // ───────── events ─────────

    event Prefunded(uint256 indexed jobId, address indexed from, uint256 amount);
    event SpecFrozenHere(uint256 indexed jobId, bytes32 specHash, OwnerCheck checkpointRead, uint64 checkpointAtFund);
    event SnapshotRequested(uint256 indexed jobId, uint8 indexed read, uint256 requestId, uint64 height);
    event SnapshotAnswered(uint256 indexed jobId, uint8 indexed read, uint256 requestId, bool ok, int256 value);
    event SnapshotReady(uint256 indexed jobId);
    event EndBlocksFixed(uint256 indexed jobId);
    event ReadsSent(uint256 indexed jobId, uint256 reads, uint256 paid);
    event ReadsNotSent(uint256 indexed jobId, bytes reason);
    event ReadAnswered(
        uint256 indexed jobId, uint8 indexed read, uint256 requestId, uint64 height, bool ok, int256 value
    );
    event Verified(uint256 indexed jobId, Verdict verdict, OwnerCheck ownerCheck, bytes32 reason);
    event SettleFailed(uint256 indexed jobId, bytes reason);
    event PrepaidRefunded(uint256 indexed jobId, address indexed to, uint256 amount);
    event FeesSwept(address indexed to, uint256 amount);

    /// @notice Gas for one decode, run as a capped self-call so a bad answer can't consume the callback.
    uint256 internal constant DECODE_GAS = 200_000;
    /// @notice Gas for reading the AGW's checkpoint counter.
    uint256 internal constant CHECKPOINT_GAS = 30_000;

    // ───────── configuration, written once in the constructor ─────────
    // Plain storage rather than `immutable`: Solidity copies an immutable into the bytecode at every use, which
    // costs about 1.5 KB here, against EIP-170. Nothing writes these after the constructor (no setter, and the
    // contract is not upgradeable), so they are as fixed as immutables.

    IAgenticCommerce public KERNEL;
    address public HOOK;
    IUniversalCallback public READ_STATE;
    IUniversalCoreHeights public UNIVERSAL_CORE;
    /// @notice Receives the evaluator's share of job fees, if the kernel admin sets one.
    address public FEE_RECIPIENT;
    /// @notice See `ReadConfig`.
    uint64 public READ_TTL;
    uint64 public CALLBACK_GAS_LIMIT;
    uint64 public SNAPSHOT_CALLBACK_GAS_LIMIT;
    uint256 public BUDGET_MULTIPLIER;
    uint256 public MAX_HEIGHT_AGE;
    uint16 public MAX_CONFIRMATIONS;

    // ───────── storage ─────────

    /// @notice Unspent PC prepaid for a job's reads (snapshot and evaluation).
    mapping(uint256 => uint256) public prepaidOf;
    /// @dev The job's spec, when it is not the createJob description: a replacement before `fund`, the frozen spec
    ///      after. Empty means the description (the hook never stores an empty one; freezing the description clears it).
    mapping(uint256 => bytes) internal _replacement;
    mapping(uint256 => JobCache) internal _cache;
    mapping(uint256 => ReadPlan[]) internal _plans;
    mapping(uint256 => PackedCheck[]) internal _checks;
    mapping(uint256 => uint256[]) internal _packedLogic; // JobSpecLib.packLogic
    mapping(uint256 => Snapshot) internal _snapshots;
    mapping(uint256 => uint256[8]) internal _fundHeights; // every read's tracked height at fund, 4 uint64 per word
    mapping(uint256 => Evaluation) internal _evals;
    // Per read, PRE or POST alike: a PRE read's snapshot, a POST read's latest answer.
    mapping(uint256 => mapping(uint256 => Answer)) internal _answers; // jobId => read => value
    mapping(uint256 => mapping(uint256 => uint256)) internal _request; // jobId => read => current request
    mapping(uint256 => mapping(uint256 => bytes32)) internal _leaf; // jobId => read => evidence of its answer
    mapping(uint256 => uint256[8]) internal _endHeights; // POST reads only, 4 uint64 per word
    mapping(uint256 => RequestRef) internal _requests;

    /// @dev `HOOK` is fixed here, for good: every later hook change must be an upgrade of that same proxy, since a
    ///      hook deployed at another address can't call this evaluator. The hook needs this address at its
    ///      `initialize`, so the two are deployed together: predict this address, deploy the hook proxy with it, then
    ///      deploy this (`scripts/agentic-commerce-8183`).
    constructor(
        address kernel_,
        address hook_,
        address readState_,
        address universalCore_,
        address feeRecipient_,
        ReadConfig memory config_
    ) {
        if (
            kernel_ == address(0) || hook_ == address(0) || readState_ == address(0) || universalCore_ == address(0)
                || feeRecipient_ == address(0)
        ) revert UniversalEvaluatorErrors.ZeroValue();
        if (
            config_.readTtl == 0 || config_.callbackGasLimit == 0 || config_.callbackGasLimit > MAX_CALLBACK_GAS_LIMIT
                || config_.snapshotCallbackGasLimit == 0 || config_.snapshotCallbackGasLimit > MAX_CALLBACK_GAS_LIMIT
                || config_.budgetMultiplier == 0 || config_.maxHeightAge == 0 || config_.maxConfirmations == 0
        ) revert UniversalEvaluatorErrors.ZeroValue();
        KERNEL = IAgenticCommerce(kernel_);
        HOOK = hook_;
        READ_STATE = IUniversalCallback(readState_);
        UNIVERSAL_CORE = IUniversalCoreHeights(universalCore_);
        FEE_RECIPIENT = feeRecipient_;
        READ_TTL = config_.readTtl;
        CALLBACK_GAS_LIMIT = config_.callbackGasLimit;
        SNAPSHOT_CALLBACK_GAS_LIMIT = config_.snapshotCallbackGasLimit;
        BUDGET_MULTIPLIER = config_.budgetMultiplier;
        MAX_HEIGHT_AGE = config_.maxHeightAge;
        MAX_CONFIRMATIONS = config_.maxConfirmations;
    }

    modifier onlyHook() {
        _requireHook();
        _;
    }

    /// @dev The modifier's check as one function, so it isn't copied into each hook-facing function.
    function _requireHook() private view {
        if (msg.sender != HOOK) revert UniversalEvaluatorErrors.CallerIsNotHook(msg.sender);
    }

    // ═════════════════════════════════ hook-facing (IUniversalEvaluator) ═════════════════════════════════

    /// @inheritdoc IUniversalEvaluator
    function setSpec(uint256 jobId, bytes calldata spec) external onlyHook {
        if (_cache[jobId].frozen) revert UniversalEvaluatorErrors.SpecFrozen(jobId);
        if (spec.length > MAX_DESCRIPTION_LENGTH) revert JobSpecErrors.SpecTooLong(spec.length);
        _replacement[jobId] = spec; // the hook emits SpecReplaced
    }

    /// @inheritdoc IUniversalEvaluator
    function currentSpec(uint256 jobId) external view returns (bytes memory) {
        return _replacement[jobId];
    }

    /// @inheritdoc IUniversalEvaluator
    /// @dev Inside `afterAction(fund)`: a revert here reverts the funding. Checks the spec, freezes it, records the
    ///      wallet's checkpoint (the AGW ticks it before each owner call, so this includes the funding call) and
    ///      sends the snapshot reads from the job's prepaid PC.
    function startSnapshot(uint256 jobId, bytes calldata spec) external onlyHook {
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        if (job.evaluator != address(this) || job.hook != HOOK) revert UniversalEvaluatorErrors.NotOurJob(jobId);
        if (job.status != IAgenticCommerce.JobStatus.Funded) revert UniversalEvaluatorErrors.WrongStatus(jobId);
        JobCache storage c = _cache[jobId];
        if (c.frozen) revert UniversalEvaluatorErrors.SpecFrozen(jobId);
        if (spec.length > MAX_DESCRIPTION_LENGTH) revert JobSpecErrors.SpecTooLong(spec.length);

        JobSpec memory s = _decodeSpec(spec); // reverts if `spec` is not an encoded JobSpec
        JobSpecLib.validate(s, MAX_CONFIRMATIONS); // reverts with the JobSpecErrors reason

        bytes32 specHash = keccak256(spec);
        if (specHash == keccak256(bytes(job.description))) delete _replacement[jobId];
        else _replacement[jobId] = spec; // the frozen bytes, whoever replaced them

        (bool cpOk, uint64 cp) = _readCheckpoint(job.client);
        c.client = job.client;
        c.frozen = true;
        c.checkpointOk = cpOk;
        c.checkpointAtFund = cp;
        c.specHash = specHash;
        _cacheSpec(jobId, s);
        emit SpecFrozenHere(jobId, specHash, cpOk ? OwnerCheck.CLEAN : OwnerCheck.UNKNOWN, cp);

        Snapshot storage sn = _snapshots[jobId];
        for (uint256 i; i < s.reads.length; ++i) {
            Read memory r = s.reads[i];
            // Preflight only: Read State's admin can still block the domain after `fund`.
            if (IReadStateDomains(address(READ_STATE)).isDomainBlocked(r.chainNamespace, r.chainId)) {
                revert UniversalEvaluatorErrors.ReadDomainBlocked(i);
            }
            uint64 h = EvmReadLib.latestHeight(UNIVERSAL_CORE, r, MAX_HEIGHT_AGE);
            _setHeight(_fundHeights[jobId], i, h); // a PRE read's block; a POST read's end block must be above it
            if (r.at == ReadAt.PRE_EXECUTION) {
                // forge-lint: disable-next-line(unsafe-typecast)
                sn.pre |= uint32(1 << i); // safe: i < MAX_READS (32)
                ++sn.needed; // answers come in later transactions, so counting as we fire is safe
                _fireSnapshot(jobId, i, r, h);
            }
        }
        if (sn.needed == 0) emit SnapshotReady(jobId);
    }

    /// @inheritdoc IUniversalEvaluator
    /// @dev Inside `afterAction(submit)`, called without try/catch: if the end blocks can't be fixed, `submit` reverts.
    ///      Fixes every read's end block first, then tries to send the reads in a separate guarded call, so a failure
    ///      to send (PC short, snapshot not ready, Read State paused) keeps the blocks and `submit` still succeeds.
    function verifyFromSubmit(uint256 jobId) external onlyHook {
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        if (job.status != IAgenticCommerce.JobStatus.Submitted) revert UniversalEvaluatorErrors.WrongStatus(jobId);
        if (!_cache[jobId].frozen) revert UniversalEvaluatorErrors.WrongStatus(jobId);
        JobSpec memory s = _frozenSpec(jobId, job.description);
        _fixEndBlocks(jobId, s);
        try this.sendFromSubmit(jobId) {}
        catch (bytes memory err) {
            emit ReadsNotSent(jobId, err);
        }
    }

    /// @notice The second half of `verifyFromSubmit`, as its own call so a failure doesn't undo the fixed blocks.
    function sendFromSubmit(uint256 jobId) external {
        if (msg.sender != address(this)) revert UniversalEvaluatorErrors.CallerIsNotSelf(msg.sender);
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        _start(jobId, _frozenSpec(jobId, job.description));
    }

    // ═════════════════════════════════ PC ═════════════════════════════════

    /// @notice Prepays PC for a job's reads, snapshot and evaluation. The AGW calls it in the funding batch.
    /// @dev Anyone may add PC; whatever is unspent goes back to the job's client through `claimPrepaid`.
    function prefund(uint256 jobId) external payable {
        if (jobId == 0 || jobId > KERNEL.jobCounter()) revert UniversalEvaluatorErrors.UnknownJob(jobId);
        _addPrepaid(jobId);
    }

    /// @notice What the job's reads cost at current fees, for the spec as it stands (replacement or description).
    ///         Prepay at least the sum, with headroom: fees and the base fee can move, and retries cost again.
    function prefundCost(uint256 jobId) external view returns (uint256 snapshot, uint256 evaluation) {
        bytes memory spec = _replacement[jobId];
        if (spec.length == 0) spec = bytes(KERNEL.getJob(jobId).description);
        JobSpec memory s = _decodeSpec(spec);
        for (uint256 i; i < s.reads.length; ++i) {
            bool pre = s.reads[i].at == ReadAt.PRE_EXECUTION;
            uint256 p = EvmReadLib.price(
                READ_STATE, s.reads[i], pre ? SNAPSHOT_CALLBACK_GAS_LIMIT : CALLBACK_GAS_LIMIT, BUDGET_MULTIPLIER
            );
            if (pre) snapshot += p;
            else evaluation += p;
        }
    }

    /// @notice Sends the job's unspent PC to its client once the job is over (Completed, Rejected, Expired), or
    ///         still Open past its expiry.
    function claimPrepaid(uint256 jobId) external nonReentrant {
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        if (job.client == address(0)) revert UniversalEvaluatorErrors.UnknownJob(jobId);
        IAgenticCommerce.JobStatus st = job.status;
        if (
            st == IAgenticCommerce.JobStatus.Funded || st == IAgenticCommerce.JobStatus.Submitted
                || (st == IAgenticCommerce.JobStatus.Open && block.timestamp < job.expiredAt)
        ) revert UniversalEvaluatorErrors.JobStillLive(jobId);
        uint256 amount = prepaidOf[jobId];
        prepaidOf[jobId] = 0;
        if (amount == 0) return;
        (bool ok,) = job.client.call{value: amount}("");
        if (!ok) revert UniversalEvaluatorErrors.RefundFailed(job.client, amount);
        emit PrepaidRefunded(jobId, job.client, amount);
    }

    // ═════════════════════════════════ provider / client recovery ═════════════════════════════════

    /// @notice Sends the job's reads for evaluation: POST reads at the blocks fixed at `submit`, PRE reads again at
    ///         their `fund` blocks. Provider only, and only while the job is Submitted: once it has ended, its PC is
    ///         the client's to claim. `msg.value` is added to the job's PC.
    ///         - If they did not go out inside `submit` (PC short, snapshot not ready, Read State paused): every POST
    ///           read, and every PRE read with no usable value.
    ///         - Once sent: every read with no usable answer that is not in flight (an error answer, an undecodable
    ///           or oversized one, an expired request, a failed callback). There is no attempt limit.
    /// @dev Never fixes the blocks, so the provider can't choose when the job is measured.
    function sendReads(uint256 jobId) external payable nonReentrant {
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        if (msg.sender != job.provider) revert UniversalEvaluatorErrors.CallerIsNotProvider(msg.sender);
        if (job.status != IAgenticCommerce.JobStatus.Submitted) revert UniversalEvaluatorErrors.WrongStatus(jobId);
        Evaluation storage e = _evals[jobId];
        if (!e.endFixed) revert UniversalEvaluatorErrors.EndBlocksNotFixed(jobId);
        if (e.done && e.verdict != Verdict.INCONCLUSIVE) revert UniversalEvaluatorErrors.NothingToSend(jobId);
        _addPrepaid(jobId);
        JobSpec memory s = _frozenSpec(jobId, job.description);
        if (e.started) _sendMissing(jobId, s);
        else _start(jobId, s);
    }

    /// @notice Sends again, at the same blocks, every PRE read never answered and not in flight (an expired request, a
    ///         failed callback). The job's client or provider only, until the evaluation starts; after that, `sendReads`.
    /// @dev Never takes back an answer, usable or not, so neither side can hold `ready` back; the evaluation itself
    ///      re-reads an unreadable PRE answer.
    function retrySnapshot(uint256 jobId) external payable nonReentrant {
        IAgenticCommerce.Job memory job = KERNEL.getJob(jobId);
        if (msg.sender != job.client && msg.sender != job.provider) {
            revert UniversalEvaluatorErrors.CallerIsNotClientOrProvider(msg.sender);
        }
        if (!_cache[jobId].frozen || _evals[jobId].started) revert UniversalEvaluatorErrors.NothingToSend(jobId);
        if (job.status != IAgenticCommerce.JobStatus.Funded && job.status != IAgenticCommerce.JobStatus.Submitted) {
            revert UniversalEvaluatorErrors.WrongStatus(jobId);
        }
        _addPrepaid(jobId);
        JobSpec memory s = _frozenSpec(jobId, job.description);
        Snapshot storage sn = _snapshots[jobId];
        uint256 sent;
        for (uint256 i; i < s.reads.length; ++i) {
            if ((sn.pre >> i) & 1 == 0 || (sn.answered >> i) & 1 == 1) continue; // never take back an answer
            if (READ_STATE.statusOf(_request[jobId][i]) == RequestStatus.PENDING) continue;
            _fireSnapshot(jobId, i, s.reads[i], _height(_fundHeights[jobId], i));
            ++sent;
        }
        if (sent == 0) revert UniversalEvaluatorErrors.NothingToSend(jobId);
    }

    /// @notice Applies a PASS or FAIL verdict the kernel refused inside the callback, e.g. while it was paused.
    function settle(uint256 jobId) external nonReentrant {
        Evaluation storage e = _evals[jobId];
        if (!e.done || e.applied || (e.verdict != Verdict.PASS && e.verdict != Verdict.FAIL)) {
            revert UniversalEvaluatorErrors.NothingToSettle(jobId);
        }
        (bool ok, bytes memory err) = _apply(jobId, e.verdict, _reason(jobId, e.verdict, e.ownerCheck));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(err, 32), mload(err)) // the kernel's own revert
            }
        }
    }

    /// @notice Sends the evaluator's share of job fees (paid by the kernel on `complete`) to `FEE_RECIPIENT`.
    function sweepFees() external {
        IERC20 token = KERNEL.paymentToken();
        uint256 amount = token.balanceOf(address(this));
        if (amount == 0) return;
        token.safeTransfer(FEE_RECIPIENT, amount);
        emit FeesSwept(FEE_RECIPIENT, amount);
    }

    // ═════════════════════════════════ callback ═════════════════════════════════

    /// @notice Read State delivers one answer, to a snapshot or an evaluation request. An evaluation answer that
    ///         decides the root applies the verdict.
    /// @dev Never reverts for a known request: bad or oversized answers become "can't tell", and a kernel revert is
    ///      caught. An answer to a superseded request is ignored.
    function onUniversalData(uint256 requestId, bytes calldata result) external {
        if (msg.sender != address(READ_STATE)) revert UniversalEvaluatorErrors.CallerIsNotReadState(msg.sender);
        RequestRef memory q = _requests[requestId];
        if (q.jobId == 0) return;
        delete _requests[requestId];
        if (q.snapshot) _onSnapshot(q.jobId, q.read, requestId, result);
        else _onAnswer(q.jobId, q.read, requestId, result);
    }

    /// @dev Usable or not, the answer completes this read's part of the snapshot.
    function _onSnapshot(uint256 jobId, uint8 read, uint256 requestId, bytes calldata result) internal {
        Snapshot storage sn = _snapshots[jobId];
        if (_request[jobId][read] != requestId || (sn.answered >> read) & 1 == 1) return;
        (bool ok, int256 value) = _record(jobId, read, requestId, _height(_fundHeights[jobId], read), result);
        sn.answered |= uint32(1) << read;
        emit SnapshotAnswered(jobId, read, requestId, ok, value);
        if (sn.answered == sn.pre) emit SnapshotReady(jobId);
    }

    function _onAnswer(uint256 jobId, uint8 read, uint256 requestId, bytes calldata result) internal {
        if (_request[jobId][read] != requestId) return; // superseded by a retry
        Evaluation storage e = _evals[jobId];
        if (e.done || (e.answered >> read) & 1 == 1) return;

        uint64 height = _blockOf(jobId, read);
        (bool ok, int256 value) = _record(jobId, read, requestId, height, result);
        e.answered |= uint32(1) << read;
        emit ReadAnswered(jobId, read, requestId, height, ok, value);

        // Judge now every check that uses this read; one still missing a usable value stays UNKNOWN (0).
        if (ok) e.checkRes = _judgeRead(jobId, read, e.checkRes);
        --e.pending;

        // The logic is monotone: once the root is PASS or FAIL no later answer can change it, so apply it now.
        // An unreadable answer changes no check, so only a usable one can decide the root.
        if (ok || e.pending == 0) {
            Verdict v = JobSpecLib.verdictPacked(_packedLogic[jobId], _cache[jobId].logicCount, e.checkRes);
            if (v != Verdict.INCONCLUSIVE || e.pending == 0) _finish(jobId, v);
        }
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    /// @notice The number to compare, from one answer. Pure; the evaluator calls it on itself with a gas cap.
    function decodeAnswer(bytes calldata outputs, uint8[] calldata field, bytes calldata res)
        external
        pure
        returns (bool, int256)
    {
        return EvmReadLib.decode(outputs, field, res);
    }

    function evaluationOf(uint256 jobId) external view returns (Evaluation memory) {
        return _evals[jobId];
    }

    /// @notice keccak256 of the frozen spec; zero until `fund` freezes it.
    function specHashOf(uint256 jobId) external view returns (bytes32) {
        return _cache[jobId].specHash;
    }

    /// @notice True once the spec is frozen and every PRE_EXECUTION read is answered, usable or not (`answerOf`).
    function ready(uint256 jobId) public view returns (bool) {
        Snapshot storage sn = _snapshots[jobId];
        return _cache[jobId].frozen && sn.answered == sn.pre;
    }

    /// @notice A read's value: a PRE read's snapshot, a POST read's latest answer.
    function answerOf(uint256 jobId, uint256 read) external view returns (bool ok, int256 value) {
        Answer memory a = _answers[jobId][read];
        return (a.ok, a.value);
    }

    /// @notice The read's tracked height recorded at `fund`; a PRE_EXECUTION read is read at this block.
    function fundHeightOf(uint256 jobId, uint256 read) external view returns (uint64) {
        return _height(_fundHeights[jobId], read);
    }

    function endHeightOf(uint256 jobId, uint256 read) external view returns (uint64) {
        return _height(_endHeights[jobId], read);
    }

    function requestOf(uint256 jobId, uint256 read) external view returns (uint256) {
        return _request[jobId][read];
    }

    /// @notice The evidence of one read's latest answer: keccak256(read, request, block, raw answer hash, ok, value).
    function evidenceOf(uint256 jobId, uint256 read) external view returns (bytes32) {
        return _leaf[jobId][read];
    }

    // ═════════════════════════════════ internal ═════════════════════════════════

    /// @dev Specs are checked by `JobSpecLib.validate` when frozen, so decoding a frozen spec never fails.
    function _decodeSpec(bytes memory spec) internal pure returns (JobSpec memory) {
        return abi.decode(spec, (JobSpec));
    }

    /// @dev The frozen spec: the stored replacement, or the createJob description.
    function _frozenSpec(uint256 jobId, string memory description) internal view returns (JobSpec memory) {
        bytes memory spec = _replacement[jobId];
        return _decodeSpec(spec.length == 0 ? bytes(description) : spec);
    }

    /// @dev Decode plans, checks, which checks each read feeds, and the packed tree, so callbacks never decode.
    function _cacheSpec(uint256 jobId, JobSpec memory s) internal {
        ReadPlan[] storage plans = _plans[jobId];
        for (uint256 i; i < s.reads.length; ++i) {
            plans.push();
            ReadPlan storage p = plans[i];
            p.outputs = s.reads[i].outputs;
            p.field = s.reads[i].field;
        }
        JobCache storage c = _cache[jobId];
        PackedCheck[] storage checks = _checks[jobId];
        for (uint256 i; i < s.checks.length; ++i) {
            Check memory chk = s.checks[i];
            uint32 left = JobSpecLib.packSide(chk.left);
            uint32 right = JobSpecLib.packSide(chk.right);
            checks.push(
                PackedCheck({
                    left: left, right: right, evaluation: chk.evaluation, operation: chk.operation, target: chk.target
                })
            );
            uint256 reads = left | right;
            for (uint256 r; reads != 0; ++r) {
                if (reads & 1 != 0) _markCheck(c, r, i);
                reads >>= 1;
            }
        }
        _packedLogic[jobId] = JobSpecLib.packLogic(s.logic);
        // forge-lint: disable-next-line(unsafe-typecast)
        c.logicCount = uint8(s.logic.length); // safe: JobSpecLib caps logic at MAX_LOGIC (32)
    }

    function _markCheck(JobCache storage c, uint256 read, uint256 check) internal {
        c.readChecks[read / 16] |= uint256(1) << (16 * (read % 16) + check);
    }

    /// @dev Each POST read's end block is its fresh tracked height, strictly above the one recorded at `fund`.
    ///      - A floor, not a proof of work: a height that has not moved since `fund` can't include the provider's
    ///        work, but one that has moved may still be below the block the work landed in. The provider (SDK) must
    ///        submit only once each tracked height covers that block; a too-early `submit` reads pre-work state.
    ///      - Applies to every POST read's chain, including one the provider did not act on, so `submit` waits until
    ///        each tracked height has moved on and is fresh. An intended liveness requirement.
    function _fixEndBlocks(uint256 jobId, JobSpec memory s) internal {
        Evaluation storage e = _evals[jobId];
        if (e.endFixed) return;
        uint256[8] storage heights = _endHeights[jobId];
        uint256[8] storage atFund = _fundHeights[jobId];
        uint32 pre = _snapshots[jobId].pre;
        for (uint256 i; i < s.reads.length; ++i) {
            if ((pre >> i) & 1 == 1) continue; // a PRE read has no end block
            uint64 h = EvmReadLib.latestHeight(UNIVERSAL_CORE, s.reads[i], MAX_HEIGHT_AGE);
            uint64 f = _height(atFund, i);
            if (h <= f) revert UniversalEvaluatorErrors.EndHeightNotAfterFund(jobId, i, f, h);
            _setHeight(heights, i, h);
        }
        e.endFixed = true;
        emit EndBlocksFixed(jobId);
    }

    /// @dev Starts the evaluation: judges the checks on PRE values alone, then sends every POST read at its end block
    ///      and every unreadable PRE read again at its `fund` block. Needs every PRE read answered.
    function _start(uint256 jobId, JobSpec memory s) internal {
        if (!ready(jobId)) revert UniversalEvaluatorErrors.SnapshotNotReady(jobId);
        Evaluation storage e = _evals[jobId];
        Snapshot storage sn = _snapshots[jobId];
        e.started = true;
        // forge-lint: disable-next-line(unsafe-typecast)
        e.reads = uint8(s.reads.length); // safe: JobSpecLib caps reads at MAX_READS (32)
        // forge-lint: disable-next-line(unsafe-typecast)
        e.pending = uint8(s.reads.length - sn.needed); // the POST reads; safe: as above
        e.answered = sn.pre;
        uint32 res;
        for (uint256 i; i < s.checks.length; ++i) {
            res = _judge(jobId, i, _checks[jobId][i], res); // a check needing a POST value stays UNKNOWN
        }
        e.checkRes = res;
        _sendMissing(jobId, s);
    }

    /// @dev Sends, at its block, every read with no usable answer that is not in flight, and reopens the verdict. On
    ///      the first send that is every POST read and every unreadable PRE read.
    function _sendMissing(uint256 jobId, JobSpec memory s) internal {
        Evaluation storage e = _evals[jobId];
        uint256 sent;
        uint256 paid;
        for (uint256 i; i < e.reads; ++i) {
            bool answered = (e.answered >> i) & 1 == 1;
            if (answered && _answers[jobId][i].ok) continue;
            uint256 req = _request[jobId][i];
            if (req != 0 && READ_STATE.statusOf(req) == RequestStatus.PENDING) continue;
            if (answered) {
                // forge-lint: disable-next-line(unsafe-typecast)
                e.answered = uint32(uint256(e.answered) & ~(uint256(1) << i)); // safe: clears one bit of a uint32
                ++e.pending; // it had been counted as answered
            }
            paid += _fireRead(jobId, i, s.reads[i]);
            ++sent;
        }
        if (sent == 0) revert UniversalEvaluatorErrors.NothingToSend(jobId);
        e.done = false;
        e.verdict = Verdict.NONE;
        emit ReadsSent(jobId, sent, paid);
    }

    function _fireRead(uint256 jobId, uint256 read, Read memory r) internal returns (uint256 value) {
        value = _spend(jobId, EvmReadLib.price(READ_STATE, r, CALLBACK_GAS_LIMIT, BUDGET_MULTIPLIER));
        uint256 requestId = _fire(r, _blockOf(jobId, read), value, CALLBACK_GAS_LIMIT, READ_TTL, jobId);
        _request[jobId][read] = requestId;
        // forge-lint: disable-next-line(unsafe-typecast)
        _requests[requestId] = RequestRef({jobId: jobId, read: uint8(read), snapshot: false}); // safe: read < 32
    }

    function _fireSnapshot(uint256 jobId, uint256 read, Read memory r, uint64 height) internal {
        uint256 value = _spend(jobId, EvmReadLib.price(READ_STATE, r, SNAPSHOT_CALLBACK_GAS_LIMIT, BUDGET_MULTIPLIER));
        uint256 requestId = _fire(r, height, value, SNAPSHOT_CALLBACK_GAS_LIMIT, READ_TTL, jobId);
        _request[jobId][read] = requestId;
        // forge-lint: disable-next-line(unsafe-typecast)
        _requests[requestId] = RequestRef({jobId: jobId, read: uint8(read), snapshot: true}); // safe: read < 32
        // forge-lint: disable-next-line(unsafe-typecast)
        emit SnapshotRequested(jobId, uint8(read), requestId, height); // safe: as above
    }

    function _fire(Read memory r, uint64 height, uint256 value, uint64 gasLimit, uint64 ttl, uint256 jobId)
        internal
        returns (uint256)
    {
        address client = _cache[jobId].client;
        return EvmReadLib.fire(
            READ_STATE,
            r,
            FireParams({
                owner: client,
                height: height,
                value: value,
                ttl: ttl,
                revertRecipient: client, // unspent callback budget goes back to the client
                callbackSelector: this.onUniversalData.selector,
                callbackGasLimit: gasLimit
            })
        );
    }

    function _spend(uint256 jobId, uint256 value) internal returns (uint256) {
        uint256 available = prepaidOf[jobId];
        if (available < value) revert UniversalEvaluatorErrors.PrepaidTooLow(value, available);
        prepaidOf[jobId] = available - value;
        return value;
    }

    function _addPrepaid(uint256 jobId) internal {
        if (msg.value == 0) return;
        prepaidOf[jobId] += msg.value;
        emit Prefunded(jobId, msg.sender, msg.value);
    }

    /// @dev Stores a read's answer, usable or not, and its evidence.
    function _record(uint256 jobId, uint8 read, uint256 requestId, uint64 height, bytes calldata result)
        internal
        returns (bool ok, int256 value)
    {
        bytes32 resultHash;
        (ok, value, resultHash) = _decodeResult(jobId, read, result);
        _answers[jobId][read] = Answer({ok: ok, value: value});
        _leaf[jobId][read] = keccak256(abi.encode(read, requestId, height, resultHash, ok, value));
    }

    /// @dev The block a read is read at: a PRE read's recorded at `fund`, a POST read's fixed at `submit`.
    function _blockOf(uint256 jobId, uint256 read) internal view returns (uint64) {
        bool pre = (_snapshots[jobId].pre >> read) & 1 == 1;
        return _height(pre ? _fundHeights[jobId] : _endHeights[jobId], read);
    }

    /// @dev Caps, then decodes. Oversized answers are unreadable and are not hashed (the hash would copy them).
    function _decodeResult(uint256 jobId, uint256 read, bytes calldata result)
        internal
        view
        returns (bool ok, int256 value, bytes32 resultHash)
    {
        if (result.length > MAX_RESULT_LENGTH) return (false, 0, bytes32(0));
        resultHash = keccak256(result);
        ReadPlan storage plan = _plans[jobId][read];
        try this.decodeAnswer{gas: DECODE_GAS}(plan.outputs, plan.field, result) returns (bool k, int256 v) {
            (ok, value) = (k, v);
        } catch {}
    }

    /// @dev Judges every check that uses `read`.
    function _judgeRead(uint256 jobId, uint256 read, uint32 checkRes) internal view returns (uint32) {
        uint256 mask = (_cache[jobId].readChecks[read / 16] >> (16 * (read % 16))) & type(uint16).max;
        for (uint256 i; mask != 0; ++i) {
            if (mask & 1 != 0) checkRes = _judge(jobId, i, _checks[jobId][i], checkRes);
            mask >>= 1;
        }
        return checkRes;
    }

    /// @dev Sets check `i`'s result from the values in so far; a missing or unreadable one leaves it UNKNOWN.
    function _judge(uint256 jobId, uint256 i, PackedCheck memory chk, uint32 checkRes) internal view returns (uint32) {
        Answer memory b;
        if (chk.right != 0) b = _sum(jobId, chk.right);
        return JobSpecLib.setCheck(
            checkRes, i, JobSpecLib.checkResult(chk.evaluation, chk.operation, chk.target, _sum(jobId, chk.left), b)
        );
    }

    /// @dev The sum of the reads in `mask`: not ok if any is missing or unreadable, or the sum overflows.
    function _sum(uint256 jobId, uint256 mask) internal view returns (Answer memory total) {
        total.ok = true;
        for (uint256 r; mask != 0; ++r) {
            if (mask & 1 != 0) {
                Answer storage v = _answers[jobId][r];
                if (!v.ok) return Answer({ok: false, value: 0});
                (total.ok, total.value) = JobSpecLib.add(total.value, v.value);
                if (!total.ok) return total;
            }
            mask >>= 1;
        }
    }

    /// @dev Records the verdict `v` (worked out from the per-check results), then tries to apply PASS or FAIL on the
    ///      kernel.
    function _finish(uint256 jobId, Verdict v) internal {
        Evaluation storage e = _evals[jobId];
        e.done = true;
        e.verdict = v;
        OwnerCheck oc = _ownerCheck(jobId);
        e.ownerCheck = oc;
        bytes32 reason = _reason(jobId, v, oc);
        emit Verified(jobId, v, oc, reason);

        if (v == Verdict.INCONCLUSIVE) return; // the provider retries; otherwise the job ends through the kernel
        (bool ok, bytes memory err) = _apply(jobId, v, reason);
        if (!ok) emit SettleFailed(jobId, err); // anyone can `settle` later
    }

    /// @dev PASS completes the job, FAIL rejects it. Returns the kernel's revert data if it refused.
    function _apply(uint256 jobId, Verdict v, bytes32 reason) internal returns (bool ok, bytes memory err) {
        bytes4 action = v == Verdict.PASS ? IAgenticCommerce.complete.selector : IAgenticCommerce.reject.selector;
        (ok, err) = address(KERNEL).call(abi.encodeWithSelector(action, jobId, reason, bytes("")));
        if (ok) _evals[jobId].applied = true; // the kernel emits JobCompleted / JobRejected
    }

    /// @dev Recorded, not acted on. UNKNOWN when either read of the wallet's counter failed.
    function _ownerCheck(uint256 jobId) internal view returns (OwnerCheck) {
        JobCache storage c = _cache[jobId];
        if (!c.checkpointOk) return OwnerCheck.UNKNOWN;
        (bool ok, uint64 nowCount) = _readCheckpoint(c.client);
        if (!ok) return OwnerCheck.UNKNOWN;
        return nowCount == c.checkpointAtFund ? OwnerCheck.CLEAN : OwnerCheck.TOUCHED;
    }

    /// @dev A raw, gas-capped staticcall, so a wallet without the counter is "unknown" instead of a revert.
    function _readCheckpoint(address wallet) internal view returns (bool, uint64) {
        (bool ok, bytes memory ret) =
            wallet.staticcall{gas: CHECKPOINT_GAS}(abi.encodeCall(IAGWCheckpoints.checkpointCount, ()));
        if (!ok || ret.length < 32) return (false, 0);
        uint256 v = abi.decode(ret, (uint256));
        if (v > type(uint64).max) return (false, 0);
        // forge-lint: disable-next-line(unsafe-typecast)
        return (true, uint64(v)); // safe: checked on the line above
    }

    /// @dev The kernel `reason`: the job, the exact frozen spec, every read's evidence in index order, the verdict
    ///      and the owner check. Independent of the order answers arrived in.
    function _reason(uint256 jobId, Verdict v, OwnerCheck oc) internal view returns (bytes32) {
        uint256 n = _evals[jobId].reads;
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            leaves[i] = _leaf[jobId][i];
        }
        return keccak256(abi.encode(jobId, _cache[jobId].specHash, leaves, v, oc));
    }

    function _setHeight(uint256[8] storage heights, uint256 read, uint64 h) internal {
        uint256 shift = 64 * (read % 4);
        heights[read / 4] = (heights[read / 4] & ~(uint256(type(uint64).max) << shift)) | (uint256(h) << shift);
    }

    function _height(uint256[8] storage heights, uint256 read) internal view returns (uint64) {
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(heights[read / 4] >> (64 * (read % 4))); // safe: masked to 64 bits by the cast
    }
}
