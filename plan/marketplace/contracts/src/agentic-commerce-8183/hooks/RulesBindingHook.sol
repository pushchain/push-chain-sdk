// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseERC8183Hook} from "./BaseERC8183Hook.sol";
import {IAgenticCommerce} from "../interfaces/IAgenticCommerce.sol";
import {IAGWFactory} from "../interfaces/external/IAGWFactory.sol";
import {ISmartSession} from "../interfaces/external/ISmartSession.sol";
import {RulesBindingHookErrors, ERC8183HookErrors} from "../libraries/Errors.sol";

/// @title RulesBindingHook
/// @notice Binds each job to the funding AGW's rules set and allows one live job per AGW.
/// @dev - Acts only in `beforeAction(fund)` (H-09); every other action passes through.
///      - Scope (D-25): the rule covers jobs that name this hook; hookless jobs are invisible to it.
///      - An AGW is freed by reading kernel job status (H-05), so unhooked `claimRefund` frees it too.
///      - Deployed behind `TransparentUpgradeableProxy` (D-15); storage continues the base at slot 50.
contract RulesBindingHook is BaseERC8183Hook {
    /// @notice The job ↔ rules set record. `rulesId` is the AGW's rules id (the engine's `permissionId`).
    struct Binding {
        address agw;
        bytes32 rulesId;
    }

    /// @notice A job was bound to an AGW's rules set at `fund`.
    event RulesBound(uint256 indexed jobId, address indexed agw, bytes32 indexed rulesId);

    // ───────── storage — slots 50..103 (base owns 0..49) ─────────

    /// @notice AGW factory, used to prove the client is an AGW. Set once, at initialization.
    address public AGW_FACTORY;
    /// @notice SmartSession engine, used to prove the rules set is live. Set once, at initialization.
    address public SESSION_ENGINE;
    /// @dev Job id → bound rules set. `rulesId` is not globally unique across wallets; always read with `agw`.
    mapping(uint256 => Binding) internal _bindingOf;
    /// @dev AGW → last job bound; live only while that job is Funded or Submitted. Read through `activeJobOf`.
    mapping(address => uint256) internal _liveJobOf;
    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the proxy.
    /// @param kernel_ The kernel proxy.
    /// @param agwFactory_ The AGW factory proxy.
    /// @param sessionEngine_ The SmartSession engine.
    function initialize(address kernel_, address agwFactory_, address sessionEngine_) external initializer {
        if (kernel_ == address(0) || agwFactory_ == address(0) || sessionEngine_ == address(0)) {
            revert ERC8183HookErrors.ZeroAddress();
        }
        __BaseERC8183Hook_init(kernel_);
        AGW_FACTORY = agwFactory_;
        SESSION_ENGINE = sessionEngine_;
    }

    /// @notice The rules set bound to `jobId` at fund, or zero.
    function rulesOfJob(uint256 jobId) external view returns (bytes32) {
        return _bindingOf[jobId].rulesId;
    }

    /// @notice The AGW bound to `jobId` at fund, or zero.
    function agwOfJob(uint256 jobId) external view returns (address) {
        return _bindingOf[jobId].agw;
    }

    /// @notice The AGW's live job under this hook (Funded or Submitted), or 0.
    /// @dev Narrower than the marketplace's `activeJobOf`, which also counts an Open, unexpired job: this hook binds
    ///      at `fund`, the marketplace at `openJob`. Both are intended.
    /// @param agw The wallet.
    /// @return The job id, or 0 if the AGW may fund another job here.
    function activeJobOf(address agw) public view returns (uint256) {
        uint256 id = _liveJobOf[agw];
        if (id == 0) return 0;
        IAgenticCommerce.JobStatus s = IAgenticCommerce(KERNEL).getJob(id).status;
        return s == IAgenticCommerce.JobStatus.Funded || s == IAgenticCommerce.JobStatus.Submitted ? id : 0;
    }

    /// @dev Checks, in order: optParams length · client is an AGW · rules set live · AGW has no live job.
    ///      - `caller` is the job's client — the kernel checks it before calling the hook.
    ///      - Runs in `beforeAction`, so any revert leaves the job Open with no escrow moved.
    function _preFund(uint256 jobId, address caller, bytes memory optParams) internal override {
        if (optParams.length != 32) revert RulesBindingHookErrors.InvalidOptParams(optParams.length);
        bytes32 rulesId = abi.decode(optParams, (bytes32));
        if (!IAGWFactory(AGW_FACTORY).isWallet(caller)) revert RulesBindingHookErrors.CallerIsNotAGW(caller);
        if (!ISmartSession(SESSION_ENGINE).isPermissionEnabled(rulesId, caller)) {
            revert RulesBindingHookErrors.RulesNotLive(caller, rulesId);
        }
        uint256 live = activeJobOf(caller);
        if (live != 0) revert RulesBindingHookErrors.AGWHasLiveJob(caller, live);

        _bindingOf[jobId] = Binding({agw: caller, rulesId: rulesId});
        _liveJobOf[caller] = jobId;
        emit RulesBound(jobId, caller, rulesId);
    }
}
