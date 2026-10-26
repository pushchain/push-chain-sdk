// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import {OwnerIntent, OWNER_LANE_FLAG} from "@push-agw/libraries/Types.sol";
import {IPRC20} from "../Interfaces/IPRC20.sol";
import {IUniversalMarketplace} from "./interfaces/IUniversalMarketplace.sol";
import {UniversalMarketplaceErrors} from "./libraries/Errors.sol";
import {
    AgentCard,
    AgentCardView,
    CEADeployment,
    JobInputs,
    OpenJobParams,
    IntentRequest,
    InitParams,
    SessionContext,
    BuildContext
} from "./libraries/Types.sol";
import {IAgenticCommerce} from "./interfaces/IAgenticCommerce.sol";
import {IUniversalMarketplaceRules} from "./interfaces/IUniversalMarketplaceRules.sol";
import {JobSpecBuilder} from "./libraries/JobSpecBuilder.sol";
import {IAGWFactory} from "./interfaces/external/IAGWFactory.sol";
import {IAGW, Session} from "./interfaces/external/IAGW.sol";

/// @title UniversalMarketplace
/// @notice Agent cards, and `openJob`: one relayed call that, on one owner-signed OwnerIntent, deploys the
///         user's AGW if needed, grants it the card's rules, and creates the ERC-8183 job with the AGW as client.
/// @dev - Moves no funds. Wallet funding and 8183 `setBudget` / `fund` happen elsewhere.
///      - Never owns anything: it presents the owner's intent to the factory and wallet, which verify the
///        signature themselves and accept it only from the intent's `executor` (this contract).
///      - Rules = card: the owner signs a session they cannot read, so this contract proves it is the card's, with
///        the card's markers filled for this job. Card ⊆ job: the job's criteria are BUILT here (JobSpecBuilder) from
///        the card's stored `jobSpecTemplate`, never supplied. The template itself is not judged: whether the
///        evaluator can run it is the provider's responsibility, reviewed through the verified tag.
///      - The card's content lives on-chain. The rules side is checked by `RULES`, a stateless helper split out
///        for EIP-170.
///      - One card per provider.
///      - Deployed behind `TransparentUpgradeableProxy`. Storage is append-only from this layout.
contract UniversalMarketplace is
    Initializable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    IUniversalMarketplace
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    /// @notice The owner lane `openJob` executes `createJob` on (owner lane, key 0).
    uint192 public constant OPENJOB_LANE = OWNER_LANE_FLAG;
    /// @notice ERC-7579 single call, default exec type: all four mode components are zero.
    bytes32 public constant MODE_SINGLE = bytes32(0);

    uint32 internal constant MIN_DURATION = 1 hours;
    bytes7 internal constant EVM_PREFIX = "eip155:";

    // ───────── storage: append-only ─────────

    IAGWFactory public AGW_FACTORY;
    IAgenticCommerce public KERNEL;
    address public hook;
    /// @notice The 8183 evaluator of every job opened here.
    address public evaluator;
    /// @notice keccak256("eip155:" ‖ decimal(block.chainid)): Push itself, which no card may name.
    bytes32 public PUSH_CHAIN_HASH;
    IUniversalMarketplaceRules public RULES;
    uint256 public agentCardCount;
    mapping(uint256 => AgentCard) internal _cards;
    mapping(uint256 => bytes) internal _agentCardRules;
    mapping(uint256 => bytes) internal _jobSpecTemplates;
    /// @notice 1 at registration, +1 per update. Bound into the job's criteria (`origin`).
    mapping(uint256 => uint256) public agentCardVersion;
    /// @notice Verified by the admin at the CURRENT version. Cleared by every update.
    mapping(uint256 => bool) public isAgentCardVerified;
    /// @notice Disabled by the admin. Permanent: the provider cannot reactivate the card.
    mapping(uint256 => bool) public isAgentCardDisabled;
    mapping(bytes32 => CEADeployment) public ceaDeployment;
    /// @dev Slot 14: the removed per-chain pause. Reserved, always zero.
    uint256 private __reserved14;
    /// @dev AGW → the last job opened here for it. Read through `activeJobOf`.
    mapping(address => uint256) internal _lastJobOf;
    mapping(uint256 => uint256) public cardOfJob;
    mapping(uint256 => address) public agwOfJob;
    mapping(uint256 => bytes32) public rulesOfJob;
    /// @notice Provider → their card id; 0 for none. Never cleared, so a disabled provider cannot register again.
    mapping(address => uint256) public agentCardOf;
    mapping(uint256 => uint256) public cardVersionOfJob;
    mapping(address => uint256) internal _agentRating;
    uint256[27] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the proxy.
    /// @param p The addresses; every one non-zero, and `p.hook` whitelisted on the kernel.
    function initialize(InitParams calldata p) external initializer {
        if (p.agwFactory == address(0) || p.kernel == address(0) || p.rules == address(0) || p.admin == address(0)) {
            revert UniversalMarketplaceErrors.ZeroAddress();
        }
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();

        AGW_FACTORY = IAGWFactory(p.agwFactory);
        KERNEL = IAgenticCommerce(p.kernel);
        RULES = IUniversalMarketplaceRules(p.rules);
        PUSH_CHAIN_HASH = keccak256(abi.encodePacked("eip155:", Strings.toString(block.chainid)));
        _setHook(p.hook);
        _setEvaluator(p.evaluator);
        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
        _grantRole(ADMIN_ROLE, p.admin);
    }

    // ═════════════════════════════════ admin ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplace
    /// @dev Jobs keep the hook they were created with; new jobs get this one.
    function setHook(address hook_) external onlyRole(ADMIN_ROLE) {
        _setHook(hook_);
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev Not checked against providers: `openJob` refuses a card whose provider is the evaluator.
    function setEvaluator(address evaluator_) external onlyRole(ADMIN_ROLE) {
        _setEvaluator(evaluator_);
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev - The derived CEA is the `MARKER_WALLET` value and expected CEA of every rules grant on `chainHash`, and
    ///        the CEA the job's criteria read. The SDK derives it from the destination CEAFactory; `openJob` refuses
    ///        a mismatch.
    ///      - Both zero clears the chain: registration, update, `computeCEA` and `openJob` then revert
    ///        `ChainNotSupported`. Exactly one zero reverts `ZeroAddress`.
    ///      - Rotation runbook: `pause()` → rotate on the destination → this → `unpause()`.
    function setCEADeployment(bytes32 chainHash, address ceaFactory, address ceaProxyImpl)
        external
        onlyRole(ADMIN_ROLE)
    {
        if (ceaFactory == address(0) && ceaProxyImpl == address(0)) {
            delete ceaDeployment[chainHash];
        } else if (ceaFactory == address(0) || ceaProxyImpl == address(0)) {
            revert UniversalMarketplaceErrors.ZeroAddress();
        } else {
            ceaDeployment[chainHash] = CEADeployment({ceaFactory: ceaFactory, ceaProxyImpl: ceaProxyImpl});
        }
        emit CEADeploymentSet(chainHash, ceaFactory, ceaProxyImpl);
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev Placeholder until VerifiedRatings is wired (page 2 M12).
    function setAgentRating(address agent, uint256 rating) external onlyRole(ADMIN_ROLE) {
        _agentRating[agent] = rating;
        emit AgentRatingSet(agent, rating);
    }

    /// @inheritdoc IUniversalMarketplace
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /// @inheritdoc IUniversalMarketplace
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev The per-card kill switch. Permanent, so a compromised provider cannot switch it back on. Keeps
    ///      `agentCardOf[provider]`: one card per provider, so a disabled provider cannot register again.
    function disableAgentCard(uint256 cardId) external onlyRole(ADMIN_ROLE) {
        _requireCard(cardId);
        isAgentCardDisabled[cardId] = true;
        _cards[cardId].active = false;
        _clearVerified(cardId);
        emit AgentCardDisabled(cardId);
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev - A tag, not a gate: `openJob` treats verified and unverified cards alike.
    ///      - `cardVersion` is the one the admin reviewed: an update in between makes this revert.
    ///      - Refused for a disabled card; allowed for one its provider switched off.
    function verifyAgentCard(uint256 cardId, uint256 cardVersion) external onlyRole(ADMIN_ROLE) {
        _requireCard(cardId);
        if (isAgentCardDisabled[cardId]) revert UniversalMarketplaceErrors.AgentCardDisabled(cardId);
        uint256 current = agentCardVersion[cardId];
        if (cardVersion != current) revert UniversalMarketplaceErrors.AgentCardVersionMismatch(cardVersion, current);
        isAgentCardVerified[cardId] = true;
        emit AgentCardVerified(cardId, cardVersion);
    }

    /// @inheritdoc IUniversalMarketplace
    function revokeAgentCardVerification(uint256 cardId) external onlyRole(ADMIN_ROLE) {
        _requireCard(cardId);
        _clearVerified(cardId);
    }

    // ═════════════════════════════════ cards ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplace
    function registerAgentCard(AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate)
        external
        whenNotPaused
        returns (uint256 cardId)
    {
        if (agentCardOf[msg.sender] != 0) revert UniversalMarketplaceErrors.AgentCardAlreadyRegistered(msg.sender);
        _validateCard(c, rules);

        cardId = ++agentCardCount;
        _cards[cardId] = c;
        AgentCard storage stored = _cards[cardId];
        stored.provider = msg.sender;
        stored.active = true;
        _agentCardRules[cardId] = rules;
        _jobSpecTemplates[cardId] = jobSpecTemplate;
        agentCardVersion[cardId] = 1;
        agentCardOf[msg.sender] = cardId;

        emit AgentCardRegistered(
            cardId,
            msg.sender,
            c.jobType,
            c.chainNamespace,
            keccak256(rules),
            keccak256(jobSpecTemplate),
            c.metadataHash,
            c.providerFee
        );
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev - Provider only; refused for a disabled card and while paused.
    ///      - `chainNamespace` identifies the card: another chain is another card. `provider` and `active` stay.
    ///      - The version is part of every job's criteria (`origin`), so an intent signed against the old
    ///        version fails `openJob`. Jobs already opened are untouched.
    function updateAgentCard(uint256 cardId, AgentCard calldata c, bytes calldata rules, bytes calldata jobSpecTemplate)
        external
        whenNotPaused
    {
        AgentCard storage stored = _cards[cardId];
        if (stored.provider == address(0) || msg.sender != stored.provider) {
            revert UniversalMarketplaceErrors.CallerIsNotProvider();
        }
        if (isAgentCardDisabled[cardId]) revert UniversalMarketplaceErrors.AgentCardDisabled(cardId);
        if (keccak256(bytes(c.chainNamespace)) != keccak256(bytes(stored.chainNamespace))) {
            revert UniversalMarketplaceErrors.AgentCardIdentityImmutable();
        }
        _validateCard(c, rules);

        stored.jobType = c.jobType;
        stored.metadataURI = c.metadataURI;
        stored.metadataHash = c.metadataHash;
        stored.providerFee = c.providerFee;
        stored.paymentToken = c.paymentToken;
        stored.principalMin = c.principalMin;
        stored.principalMax = c.principalMax;
        stored.minDuration = c.minDuration;
        stored.maxDuration = c.maxDuration;
        stored.minExecuteWindow = c.minExecuteWindow;
        stored.settleWindow = c.settleWindow;
        _agentCardRules[cardId] = rules;
        _jobSpecTemplates[cardId] = jobSpecTemplate;

        uint256 newVersion = ++agentCardVersion[cardId];
        _clearVerified(cardId);

        emit AgentCardUpdated(
            cardId, newVersion, keccak256(rules), keccak256(jobSpecTemplate), c.metadataHash, c.providerFee
        );
    }

    /// @inheritdoc IUniversalMarketplace
    function setAgentCardActive(uint256 cardId, bool active) external {
        AgentCard storage c = _cards[cardId];
        if (c.provider == address(0) || msg.sender != c.provider) {
            revert UniversalMarketplaceErrors.CallerIsNotProvider();
        }
        if (active && isAgentCardDisabled[cardId]) revert UniversalMarketplaceErrors.AgentCardDisabled(cardId);
        c.active = active;
        emit AgentCardStatusChanged(cardId, active);
    }

    /// @inheritdoc IUniversalMarketplace
    function getAgentCard(uint256 cardId) external view returns (AgentCardView memory v) {
        v.card = _cards[cardId];
        v.rules = _agentCardRules[cardId];
        v.jobSpecTemplate = _jobSpecTemplates[cardId];
        v.version = agentCardVersion[cardId];
        v.verified = isAgentCardVerified[cardId];
        v.disabled = isAgentCardDisabled[cardId];
    }

    // ═════════════════════════════════ openJob ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplace
    /// @dev Normative order, every check before the first state change:
    ///      1-6 card, version, ranges, evaluator · 7 wallet · 8 no active job · 9-10 build the job · 11 bind the intent ·
    ///      12 rules = card · ── 13 deploy or check owner · 14 grant · 15 create, verified · 16 record.
    function openJob(OpenJobParams calldata p)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 jobId, address agw, bytes32 rulesId)
    {
        AgentCard storage c = _cards[p.cardId];
        bytes32 chainHash = _checkCardAndJob(c, p);
        bool deployed;
        (agw, deployed) = _resolveWallet(p);
        uint256 active = activeJobOf(agw);
        if (active != 0) revert UniversalMarketplaceErrors.WalletHasActiveJob(agw, active);
        (bytes32 mode, bytes memory execCalldata) = _buildCreateJob(p.cardId, agw, p.job);
        _bindIntent(p, mode, execCalldata);
        _checkRules(c, p, agw, chainHash);

        _deployOrCheckOwner(p, agw, deployed);
        rulesId = IAGW(agw).grantRulesWithSig(p.session, p.intent, p.sig);
        jobId = _createJob(c, agw, mode, execCalldata, p.intent, p.sig);

        _lastJobOf[agw] = jobId;
        cardOfJob[jobId] = p.cardId;
        agwOfJob[jobId] = agw;
        rulesOfJob[jobId] = rulesId;
        cardVersionOfJob[jobId] = p.cardVersion;
        emit JobOpened(p.cardId, p.intent.owner, agw, jobId, rulesId, p.job.principal, p.cardVersion);
    }

    // ═════════════════════════════════ views ═════════════════════════════════

    /// @inheritdoc IUniversalMarketplace
    /// @dev Active while the last job opened here is Funded, Submitted, or Open and not yet expired.
    function activeJobOf(address agw) public view returns (uint256) {
        uint256 id = _lastJobOf[agw];
        if (id == 0) return 0;
        IAgenticCommerce.Job memory j = KERNEL.getJob(id);
        if (j.status == IAgenticCommerce.JobStatus.Funded || j.status == IAgenticCommerce.JobStatus.Submitted) {
            return id;
        }
        if (j.status == IAgenticCommerce.JobStatus.Open && block.timestamp < j.expiredAt) return id;
        return 0;
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev Mirrors `CEAFactory._computeCEAInternal`: an OZ minimal proxy of `ceaProxyImpl`, salt
    ///      `keccak256(abi.encode(pushAccount))`, deployer = the CEA factory. Stale after a destination
    ///      implementation rotation until `setCEADeployment`: pause first.
    function computeCEA(address agw, bytes32 chainHash) public view returns (address) {
        CEADeployment memory d = ceaDeployment[chainHash];
        if (d.ceaFactory == address(0)) revert UniversalMarketplaceErrors.ChainNotSupported(chainHash);
        return Clones.predictDeterministicAddress(d.ceaProxyImpl, keccak256(abi.encode(agw)), d.ceaFactory);
    }

    /// @inheritdoc IUniversalMarketplace
    function getAgentRating(address agent) external view returns (uint256) {
        return _agentRating[agent];
    }

    /// @inheritdoc IUniversalMarketplace
    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    /// @inheritdoc IUniversalMarketplace
    function buildCreateJobCalldata(uint256 cardId, address owner, uint96 index, JobInputs calldata job)
        external
        view
        returns (bytes32 mode, bytes memory executionCalldata)
    {
        _requireCard(cardId);
        (address agw,) = AGW_FACTORY.predictWallet(owner, index);
        return _buildCreateJob(cardId, agw, job);
    }

    /// @inheritdoc IUniversalMarketplace
    /// @dev The SDK signs exactly what this returns. Nonces are 0 for a wallet not yet deployed.
    function previewIntent(IntentRequest calldata r, Session calldata s) external view returns (OwnerIntent memory i) {
        _requireCard(r.cardId);
        (address wallet, bool deployed) = AGW_FACTORY.predictWallet(r.owner, r.index);
        (bytes32 mode, bytes memory cd) = _buildCreateJob(r.cardId, wallet, r.job);
        i.owner = r.owner;
        i.wallet = wallet;
        i.executor = address(this);
        i.index = r.index;
        i.sessionHash = keccak256(abi.encode(s));
        i.mode = mode;
        i.execCalldataHash = keccak256(cd);
        i.nonceKey = OPENJOB_LANE;
        i.nonceSeq = deployed ? IAGW(wallet).getNonce(OPENJOB_LANE) : 0;
        i.grantNonce = deployed ? IAGW(wallet).grantNonce() : 0;
        i.deadline = r.deadline;
        i.signerChainId = r.signerChainId;
    }

    // ═════════════════════════════════ internal: config and cards ═════════════════════════════════

    function _setHook(address hook_) internal {
        if (hook_ == address(0)) revert UniversalMarketplaceErrors.ZeroAddress();
        if (!KERNEL.whitelistedHooks(hook_)) revert UniversalMarketplaceErrors.HookNotWhitelisted();
        hook = hook_;
        emit HookUpdated(hook_);
    }

    function _setEvaluator(address evaluator_) internal {
        if (evaluator_ == address(0)) revert UniversalMarketplaceErrors.ZeroAddress();
        evaluator = evaluator_;
        emit EvaluatorUpdated(evaluator_);
    }

    /// @dev `AgentCardInactive` for a card that was never registered.
    function _requireCard(uint256 cardId) internal view {
        if (_cards[cardId].provider == address(0)) revert UniversalMarketplaceErrors.AgentCardInactive();
    }

    /// @dev Clears the verified tag, emitting only when there was one to clear.
    function _clearVerified(uint256 cardId) internal {
        if (!isAgentCardVerified[cardId]) return;
        isAgentCardVerified[cardId] = false;
        emit AgentCardVerificationRevoked(cardId);
    }

    /// @dev Registration and update checks, in order. The caller is the provider. The `jobSpecTemplate` is stored
    ///      as given.
    function _validateCard(AgentCard calldata c, bytes calldata rules) internal view {
        if (c.jobType == bytes32(0)) revert UniversalMarketplaceErrors.InvalidAgentCard("job type zero");
        if (bytes(c.metadataURI).length == 0) revert UniversalMarketplaceErrors.InvalidAgentCard("metadata uri empty");
        if (c.metadataHash == bytes32(0)) revert UniversalMarketplaceErrors.InvalidAgentCard("metadata hash zero");
        bytes calldata ns = bytes(c.chainNamespace);
        if (ns.length <= EVM_PREFIX.length || bytes7(ns[:7]) != EVM_PREFIX) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("chain namespace");
        }
        bytes32 chainHash = keccak256(ns);
        if (chainHash == PUSH_CHAIN_HASH || ceaDeployment[chainHash].ceaFactory == address(0)) {
            revert UniversalMarketplaceErrors.ChainNotSupported(chainHash);
        }
        // Until the kernel's K-12, every job is paid in the kernel's token; a card may not advertise another.
        if (c.paymentToken != address(KERNEL.paymentToken())) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("payment token");
        }
        _validateWindows(c);
        address[] memory tokens = RULES.validateAgentCardRules(rules);
        for (uint256 i; i < tokens.length; ++i) {
            _requireAssetOnChain(tokens[i], chainHash);
        }
    }

    /// @dev The provider is not the evaluator, and the principal and time windows are coherent.
    function _validateWindows(AgentCard calldata c) internal view {
        if (msg.sender == evaluator) revert UniversalMarketplaceErrors.InvalidAgentCard("provider is evaluator");
        if (c.principalMax == 0 || c.principalMin > c.principalMax) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("principal range");
        }
        if (c.minDuration < MIN_DURATION || c.minDuration > c.maxDuration) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("duration range");
        }
        if (c.settleWindow == 0) revert UniversalMarketplaceErrors.InvalidAgentCard("settle window");
        if (uint256(c.minExecuteWindow) + c.settleWindow > c.maxDuration) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("execute window");
        }
    }

    /// @dev The asset is a PRC20 of the card's chain. A raw staticcall, not try/catch: a non-string answer must
    ///      fail as "asset", and a try clause cannot catch its own return-data decoding. A codeless asset answers
    ///      empty, so it fails the length check.
    function _requireAssetOnChain(address asset, bytes32 chainHash) internal view {
        (bool ok, bytes memory ret) = asset.staticcall(abi.encodeCall(IPRC20.SOURCE_CHAIN_NAMESPACE, ()));
        if (!ok || ret.length < 64) revert UniversalMarketplaceErrors.InvalidAgentCard("asset");
        (uint256 offset, uint256 len) = abi.decode(ret, (uint256, uint256));
        if (offset != 32 || len > ret.length - 64) revert UniversalMarketplaceErrors.InvalidAgentCard("asset");
        if (keccak256(abi.decode(ret, (bytes))) != chainHash) {
            revert UniversalMarketplaceErrors.InvalidAgentCard("asset chain");
        }
    }

    // ═════════════════════════════════ internal: openJob ═════════════════════════════════

    /// @dev Steps 1-6. Returns the card's chain hash.
    function _checkCardAndJob(AgentCard storage c, OpenJobParams calldata p) internal view returns (bytes32) {
        if (!c.active) revert UniversalMarketplaceErrors.AgentCardInactive();
        uint256 current = agentCardVersion[p.cardId];
        if (p.cardVersion != current) {
            revert UniversalMarketplaceErrors.AgentCardVersionMismatch(p.cardVersion, current);
        }
        _checkJobWindows(c, p.job);
        if (c.provider == evaluator) revert UniversalMarketplaceErrors.ProviderIsEvaluator();
        return keccak256(bytes(c.chainNamespace));
    }

    /// @dev Steps 3-5: principal, expiry and executeBy inside the card's windows.
    function _checkJobWindows(AgentCard storage c, JobInputs calldata job) internal view {
        if (job.principal < c.principalMin || job.principal > c.principalMax) {
            revert UniversalMarketplaceErrors.PrincipalOutOfRange();
        }
        uint256 expiredAt = job.expiredAt;
        if (expiredAt < block.timestamp + c.minDuration || expiredAt > block.timestamp + c.maxDuration) {
            revert UniversalMarketplaceErrors.ExpiryOutOfRange();
        }
        uint256 executeBy = job.executeBy;
        if (executeBy < block.timestamp + c.minExecuteWindow || executeBy + c.settleWindow > expiredAt) {
            revert UniversalMarketplaceErrors.ExecuteByOutOfRange();
        }
    }

    /// @dev Step 7: the intent names the wallet derived from its owner and index, and this executor.
    function _resolveWallet(OpenJobParams calldata p) internal view returns (address agw, bool deployed) {
        (agw, deployed) = AGW_FACTORY.predictWallet(p.intent.owner, p.intent.index);
        if (p.intent.wallet != agw) revert UniversalMarketplaceErrors.IntentWalletMismatch(agw, p.intent.wallet);
        if (p.intent.executor != address(this)) {
            revert UniversalMarketplaceErrors.ExecutorMismatch(p.intent.executor, address(this));
        }
    }

    /// @dev Steps 9-10: the job's criteria, built from the card's template, inside `createJob` as an ERC-7579
    ///      single execution. Everything the owner signs per job (principal, times, params, card version and
    ///      the wallet, through its CEA) is in this calldata, so the intent's calldata hash binds all of it.
    function _buildCreateJob(uint256 cardId, address agw, JobInputs calldata job)
        internal
        view
        returns (bytes32 mode, bytes memory executionCalldata)
    {
        AgentCard storage c = _cards[cardId];
        bytes memory description = JobSpecBuilder.build(
            _jobSpecTemplates[cardId],
            BuildContext({
                agw: agw,
                principal: job.principal,
                executeBy: job.executeBy,
                settleWindow: c.settleWindow,
                params: job.params,
                origin: keccak256(abi.encode(address(this), cardId, agentCardVersion[cardId], job.principal))
            })
        );
        bytes memory call = abi.encodeCall(
            IAgenticCommerce.createJob, (c.provider, evaluator, uint256(job.expiredAt), string(description), hook)
        );
        mode = MODE_SINGLE;
        executionCalldata = abi.encodePacked(address(KERNEL), uint256(0), call);
    }

    /// @dev Step 11: the intent's exec fields name exactly this createJob, on the openJob lane, and its
    ///      session hash is this session. The wallet re-checks both; this names the error before state moves.
    function _bindIntent(OpenJobParams calldata p, bytes32 mode, bytes memory execCalldata) internal pure {
        bytes32 cdHash = keccak256(execCalldata);
        if (p.intent.mode != mode || p.intent.execCalldataHash != cdHash || p.intent.nonceKey != OPENJOB_LANE) {
            revert UniversalMarketplaceErrors.IntentExecMismatch(cdHash);
        }
        bytes32 sessionHash = keccak256(abi.encode(p.session));
        if (p.intent.sessionHash != sessionHash) revert UniversalMarketplaceErrors.IntentSessionMismatch(sessionHash);
    }

    /// @dev Step 12: the signed session is the card's rules with its markers filled for this job, for the card's
    ///      agent, bound to this job and CEA.
    function _checkRules(AgentCard storage c, OpenJobParams calldata p, address agw, bytes32 chainHash)
        internal
        view
    {
        RULES.checkRulesMatchCard(
            _agentCardRules[p.cardId],
            p.session,
            SessionContext({
                agent: c.provider,
                chainHash: chainHash,
                principal: p.job.principal,
                expiredAt: p.job.expiredAt,
                expectedCEA: computeCEA(agw, chainHash)
            })
        );
    }

    /// @dev Step 13: deploy the predicted wallet, or check the factory's owner of the existing one.
    function _deployOrCheckOwner(OpenJobParams calldata p, address agw, bool deployed) internal {
        if (!deployed) {
            address d = AGW_FACTORY.deployWalletWithSig(p.intent, p.sig, p.label);
            if (d != agw) revert UniversalMarketplaceErrors.AGWMismatch(agw, d);
            return;
        }
        address owner = AGW_FACTORY.ownerOf(agw);
        if (owner != p.intent.owner) revert UniversalMarketplaceErrors.WalletOwnerMismatch(p.intent.owner, owner);
    }

    /// @dev Step 15: the AGW creates the job; exactly one job appeared, with this AGW as client and the card's
    ///      provider, this hook and this evaluator.
    function _createJob(
        AgentCard storage c,
        address agw,
        bytes32 mode,
        bytes memory execCalldata,
        OwnerIntent calldata intent,
        bytes calldata sig
    ) internal returns (uint256 jobId) {
        uint256 before = KERNEL.jobCounter();
        IAGW(agw).executeWithSig(mode, execCalldata, intent, sig);
        jobId = KERNEL.jobCounter();
        if (jobId != before + 1) revert UniversalMarketplaceErrors.UnexpectedJobCount(before, jobId);
        IAgenticCommerce.Job memory j = KERNEL.getJob(jobId);
        if (j.client != agw || j.provider != c.provider || j.hook != hook || j.evaluator != evaluator) {
            revert UniversalMarketplaceErrors.JobMismatch();
        }
    }
}
