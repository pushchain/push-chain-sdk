// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    TransparentUpgradeableProxy,
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {
    OwnerIntent,
    OWNER_LANE_FLAG,
    AssetCap,
    AllowedCall,
    ArgPin,
    PinOp,
    UniversalTerms
} from "@push-agw/libraries/Types.sol";
import {KernelBase} from "./KernelBase.t.sol";
import {TemplateParts} from "./helpers/TemplateParts.sol";
import {RulesFixtures, SessionSkeleton} from "./helpers/RulesFixtures.sol";
import {MockAGWFactory} from "./mocks/MockAGWFactory.sol";
import {MockAGW} from "./mocks/MockAGW.sol";
import {MockSmartSession} from "./mocks/MockSmartSession.sol";
import {MockPRC20Source} from "./mocks/MockPRC20Source.sol";
import {IAgenticCommerce} from "../../src/agentic-commerce-8183/interfaces/IAgenticCommerce.sol";
import {RulesBindingHook} from "../../src/agentic-commerce-8183/hooks/RulesBindingHook.sol";
import {UniversalMarketplace} from "../../src/agentic-commerce-8183/UniversalMarketplace.sol";
import {UniversalMarketplaceRules} from "../../src/agentic-commerce-8183/UniversalMarketplaceRules.sol";
import {IUniversalMarketplace} from "../../src/agentic-commerce-8183/interfaces/IUniversalMarketplace.sol";
import {UniversalMarketplaceErrors} from "../../src/agentic-commerce-8183/libraries/Errors.sol";
import {JobSpecBuilder} from "../../src/agentic-commerce-8183/libraries/JobSpecBuilder.sol";
import {
    Evaluation,
    Operation,
    LogicKind,
    AllowedMutability,
    JobSpec
} from "../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol";
import {Session, ActionData, PolicyData} from "../../src/agentic-commerce-8183/interfaces/external/IAGW.sol";
import {CEAFactory} from "../../src/cea/CEAFactory.sol";
import {
    AgentCard,
    AgentCardRules,
    AgentCardView,
    JobInputs,
    OpenJobParams,
    IntentRequest,
    InitParams,
    ReadTemplate,
    TargetSource,
    CheckTemplate,
    ParamBounds,
    JobSpecTemplate,
    BuildContext,
    MARKER_WALLET
} from "../../src/agentic-commerce-8183/libraries/Types.sol";

/// @notice TEST ONLY: runs JobSpecBuilder as the marketplace does, with CEAs from the real marketplace, so a test can
///         compute the description a job must carry.
contract MarketJobSpecBuilder {
    IUniversalMarketplace internal immutable MARKET;

    constructor(IUniversalMarketplace market) {
        MARKET = market;
    }

    function build(bytes memory jobSpecTemplate, BuildContext memory ctx) external view returns (bytes memory) {
        return JobSpecBuilder.build(jobSpecTemplate, ctx);
    }

    function computeCEA(address agw, bytes32 chainHash) external view returns (address) {
        return MARKET.computeCEA(agw, chainHash);
    }
}

/// @title MarketplaceFixtures — shared setup and builders for the marketplace unit and invariant suites.
/// @notice Real kernel, real RulesBindingHook, real rules helper and JobSpecBuilder library, real CEAFactory. The AGW
///         factory and wallet are mocks that enforce the rules the marketplace relies on and verify no signature;
///         `UniversalMarketplace.fork.t.sol` runs the real AGW v6 stack.
abstract contract MarketplaceFixtures is KernelBase, TemplateParts, RulesFixtures {
    UniversalMarketplace internal mkt;
    UniversalMarketplaceRules internal rulesHelper;
    MarketJobSpecBuilder internal expectedBuilder;
    RulesBindingHook internal hook;
    MockAGWFactory internal factory;
    MockSmartSession internal engine;
    CEAFactory internal ceaFactory;
    MockPRC20Source internal pUSDC; // the principal asset: pUSDC.sepolia, 6 decimals
    MockPRC20Source internal pETH; // a second asset, 18 decimals

    address internal user = makeAddr("userUEA");
    address internal relayer = makeAddr("relayer");
    address internal mktAdmin = makeAddr("mktAdmin");
    address internal provider2 = makeAddr("provider2");
    address internal universalEvaluator = makeAddr("universalEvaluator");
    address internal ceaProxyImpl = makeAddr("ceaProxyImpl");
    address internal pool = makeAddr("aavePool.sepolia");
    address internal aUSDC = makeAddr("aUSDC.sepolia");
    address internal usdc = makeAddr("USDC.sepolia");
    address internal weth = makeAddr("WETH.sepolia");
    address internal gateway = makeAddr("universalGatewayPC");
    address internal urp = makeAddr("urp");
    address internal validator = makeAddr("sessionValidator");

    string internal constant SEPOLIA_ID = "11155111";
    bytes4 internal constant SEND_OUTBOUND =
        bytes4(keccak256("sendUniversalTxOutbound((bytes,address,uint256,uint256,uint256,uint256,bytes,address))"));
    bytes4 internal constant WITHDRAW = bytes4(keccak256("withdraw(address,uint256,address)"));

    uint256 internal constant PRINCIPAL = 500e6;
    uint256 internal constant FEE = 2e6;

    function setUp() public virtual override {
        super.setUp();
        factory = new MockAGWFactory();
        engine = new MockSmartSession();
        RulesBindingHook hookImpl = new RulesBindingHook();
        hook = RulesBindingHook(
            address(
                new TransparentUpgradeableProxy(
                    address(hookImpl),
                    makeAddr("hookAdmin"),
                    abi.encodeCall(RulesBindingHook.initialize, (address(kernel), address(factory), address(engine)))
                )
            )
        );
        vm.prank(admin);
        kernel.setHookWhitelist(address(hook), true);

        rulesHelper = new UniversalMarketplaceRules();
        mkt = UniversalMarketplace(
            address(
                new TransparentUpgradeableProxy(
                    address(new UniversalMarketplace()),
                    mktAdmin,
                    abi.encodeCall(UniversalMarketplace.initialize, (_initParams()))
                )
            )
        );

        CEAFactory ceaImpl = new CEAFactory();
        ceaFactory = CEAFactory(
            address(
                new TransparentUpgradeableProxy(
                    address(ceaImpl),
                    makeAddr("ceaAdmin"),
                    abi.encodeCall(
                        CEAFactory.initialize,
                        (admin, admin, makeAddr("vault"), ceaProxyImpl, makeAddr("ceaImpl"), makeAddr("gateway"))
                    )
                )
            )
        );
        vm.prank(admin);
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), ceaProxyImpl);
        expectedBuilder = new MarketJobSpecBuilder(IUniversalMarketplace(address(mkt)));

        pUSDC = new MockPRC20Source("pUSDC.sepolia", SEPOLIA, 6);
        pETH = new MockPRC20Source("pETH.sepolia", SEPOLIA, 18);
        pUSDC.mint(user, 1e15);
        token.mint(user, 1e15);
        vm.deal(user, 100 ether);
    }

    function _initParams() internal view returns (InitParams memory) {
        return InitParams({
            agwFactory: address(factory),
            kernel: address(kernel),
            hook: address(hook),
            evaluator: universalEvaluator,
            rules: address(rulesHelper),
            admin: admin
        });
    }

    // ═════════════════════════════ cards ═════════════════════════════

    /// @dev The lending card, on Sepolia, paid in the kernel's token. `minDuration` is 3 h so that a job at the
    ///      shortest expiry still fits `minExecuteWindow + settleWindow` (10 min + 2 h).
    function _card() internal view returns (AgentCard memory c) {
        c.jobType = keccak256("LENDING_DEPOSIT");
        c.metadataURI = "ipfs://card";
        c.metadataHash = keccak256("card.json");
        c.chainNamespace = SEPOLIA;
        c.providerFee = FEE;
        c.paymentToken = address(token);
        c.principalMin = 100e6;
        c.principalMax = 1_000e6;
        c.minDuration = 3 hours;
        c.maxDuration = 30 days;
        c.minExecuteWindow = 10 minutes;
        c.settleWindow = 2 hours;
    }

    /// @dev PRD 12 §6.1: pUSDC (both caps the marker); approve USDC → Pool ≤ principal; supply onBehalfOf = wallet;
    ///      transfer to the wallet by the beneficiary field.
    function _rules() internal view returns (AgentCardRules memory) {
        return _cardRules(address(pUSDC), usdc, pool);
    }

    /// @dev `_rules()` plus `{pETH, 0, 0}` as asset 1.
    function _rulesTwoAssets() internal view returns (AgentCardRules memory) {
        return _cardRulesTwoAssets(address(pUSDC), usdc, pool, address(pETH));
    }

    /// @dev The V2 doc's lending criteria on Sepolia: aUSDC.balanceOf(CEA) ≥ 99.99% of principal AND rate ≥ 4%.
    function _lendingTemplate() internal view returns (JobSpecTemplate memory t) {
        t.reads = new ReadTemplate[](2);
        t.reads[0] = _balanceOfCEA(SEPOLIA_ID, aUSDC);
        t.reads[1] =
            _read(SEPOLIA_ID, pool, GET_RESERVE_DATA, abi.encode(usdc), _noFills(), _reserveDataOut(), _f2(0, 2));
        t.checks = new CheckTemplate[](2);
        t.checks[0] =
            _chk(0, Evaluation.COMPARE, Operation.GREATER_OR_EQUAL, TargetSource.PRINCIPAL_BPS, 9999);
        t.checks[1] = _chk(1, Evaluation.COMPARE, Operation.GREATER_OR_EQUAL, TargetSource.FIXED, 0.04e27);
        t.logic = _rootOf(LogicKind.ALL, _kids(0, 1));
        t.allowedMutability = AllowedMutability.NONE;
        t.params = new ParamBounds[](0);
    }

    /// @dev The V2 doc's swap criteria on Sepolia: the CEA's WETH grows by at least `minOut`, the job's param 0.
    function _swapTemplate() internal view returns (JobSpecTemplate memory t) {
        t.reads = new ReadTemplate[](1);
        t.reads[0] = _balanceOfCEA(SEPOLIA_ID, weth);
        t.reads[0].minConfirmations = 3;
        t.checks = new CheckTemplate[](1);
        t.checks[0] = _chk(0, Evaluation.NUMBER, Operation.GREATER_OR_EQUAL, TargetSource.PARAM, 0);
        t.logic = _rootOf(LogicKind.ALL, _one(0));
        t.params = new ParamBounds[](1);
        t.params[0] = ParamBounds({min: 1, max: 1e30});
    }

    function _registerAs(address who, AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t)
        internal
        returns (uint256 id)
    {
        bytes memory rules = abi.encode(r);
        bytes memory template = abi.encode(t);
        vm.prank(who);
        id = mkt.registerAgentCard(c, rules, template);
    }

    function _register(AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t)
        internal
        returns (uint256)
    {
        return _registerAs(provider, c, r, t);
    }

    function _registerLending() internal returns (uint256) {
        return _register(_card(), _rules(), _lendingTemplate());
    }

    function _registerSwap() internal returns (uint256) {
        AgentCard memory c = _card();
        c.jobType = keccak256("SWAP");
        return _register(c, _rules(), _swapTemplate());
    }

    /// @dev The provider's lending card, registering it on first use (one card per provider).
    function _lendingId() internal returns (uint256 id) {
        id = mkt.agentCardOf(provider);
        if (id == 0) id = _registerLending();
    }

    // ═════════════════════════════ jobs ═════════════════════════════

    /// @dev Expires in 7 days; execute within 1 hour; no params.
    function _inputs(uint256 principal) internal view returns (JobInputs memory j) {
        j.principal = principal;
        j.expiredAt = uint48(block.timestamp + 7 days);
        j.executeBy = uint48(block.timestamp + 1 hours);
        j.params = new int256[](0);
    }

    function _swapInputs(int256 minOut) internal view returns (JobInputs memory j) {
        j = _inputs(PRINCIPAL);
        j.params = new int256[](1);
        j.params[0] = minOut;
    }

    /// @dev The unit-suite session skeleton: fields the marketplace never checks (the AGW pins them at grant).
    function _skeleton() internal view returns (SessionSkeleton memory) {
        return SessionSkeleton({
            validator: validator, actionTarget: gateway, actionSelector: SEND_OUTBOUND, policy: urp
        });
    }

    /// @dev The terms an honest SDK signs for `r` and this job: markers filled, the marketplace's CEA.
    function _termsFor(AgentCardRules memory r, address agw, JobInputs memory job)
        internal
        view
        returns (UniversalTerms memory)
    {
        return _fillTerms(r, job.principal, job.expiredAt, mkt.computeCEA(agw, SEPOLIA_HASH));
    }

    /// @dev `t` in a v6 envelope on Sepolia, for `agent`, with the unit skeleton.
    function _sessionAs(address agent, UniversalTerms memory t) internal view returns (Session memory) {
        return _wrapSession(_envelope(t, SEPOLIA), agent, _skeleton());
    }

    function _sessionOf(UniversalTerms memory t) internal view returns (Session memory) {
        return _sessionAs(provider, t);
    }

    /// @dev PRD 12 §6.1: the session the SDK builds for card rules `r`, wallet `agw` and this job.
    function _sessionFor(AgentCardRules memory r, address agw, JobInputs memory job)
        internal
        view
        returns (Session memory)
    {
        return _sessionOf(_termsFor(r, agw, job));
    }

    function _params(uint256 cardId, uint96 index, JobInputs memory job, Session memory s)
        internal
        view
        returns (OpenJobParams memory p)
    {
        p.cardId = cardId;
        p.cardVersion = mkt.agentCardVersion(cardId);
        p.job = job;
        p.session = s;
        p.intent = mkt.previewIntent(
            IntentRequest({
                cardId: cardId,
                owner: user,
                index: index,
                job: job,
                deadline: uint48(block.timestamp + 1 hours),
                signerChainId: 1
            }),
            s
        );
        p.sig = hex"01";
        p.label = "job";
    }

    /// @dev An honest, signed openJob for wallet `index` of the user, for the card's own agent.
    function _readyAt(uint256 cardId, uint96 index, AgentCardRules memory r, JobInputs memory job)
        internal
        view
        returns (OpenJobParams memory)
    {
        (address agw,) = factory.predictWallet(user, index);
        address agent = mkt.getAgentCard(cardId).card.provider;
        return _params(cardId, index, job, _sessionAs(agent, _termsFor(r, agw, job)));
    }

    /// @dev An honest, signed openJob on the user's next (fresh) wallet.
    function _ready(uint256 cardId) internal view returns (OpenJobParams memory) {
        return _readyAt(cardId, uint96(factory.walletCount(user)), _rules(), _inputs(PRINCIPAL));
    }

    function _open(OpenJobParams memory p) internal returns (uint256 jobId, address agw) {
        vm.prank(relayer);
        (jobId, agw,) = mkt.openJob(p);
    }

    function _expectOpen(OpenJobParams memory p, bytes memory err) internal {
        vm.prank(relayer);
        vm.expectRevert(err);
        mkt.openJob(p);
    }

    /// @dev The 8183 continuation outside the marketplace: the provider prices, the AGW funds with its rulesId.
    function _budgetAndFund(uint256 jobId, address agw, uint256 amount) internal {
        vm.prank(provider);
        kernel.setBudget(jobId, amount, "");
        _fund(jobId, agw, amount);
    }

    function _fund(uint256 jobId, address agw, uint256 amount) internal {
        engine.setPermission(MockAGW(payable(agw)).RULES_ID(), agw, true);
        token.mint(agw, amount);
        vm.startPrank(agw);
        token.approve(address(kernel), amount);
        kernel.fund(jobId, amount, abi.encode(mkt.rulesOfJob(jobId)));
        vm.stopPrank();
    }

    /// @dev The JobSpec bytes the card's template must give for this job.
    function _expectedDescription(
        JobSpecTemplate memory t,
        uint256 cardId,
        uint256 cardVersion,
        address agw,
        JobInputs memory job
    ) internal view returns (bytes memory) {
        return expectedBuilder.build(
            abi.encode(t),
            BuildContext({
                agw: agw,
                principal: job.principal,
                executeBy: job.executeBy,
                settleWindow: _card().settleWindow,
                params: job.params,
                origin: keccak256(abi.encode(address(mkt), cardId, cardVersion, job.principal))
            })
        );
    }

    function _calldataHash(uint256 cardId, uint96 index, JobInputs memory job) internal view returns (bytes32) {
        (, bytes memory cd) = mkt.buildCreateJobCalldata(cardId, user, index, job);
        return keccak256(cd);
    }

    /// @dev The policy terms the wallet was last granted, decoded from the v6 envelope.
    function _granted(address agw) internal view returns (UniversalTerms memory) {
        (,, bytes memory body) = abi.decode(MockAGW(payable(agw)).lastPolicyInitData(), (uint16, string, bytes));
        return abi.decode(body, (UniversalTerms));
    }

    /// @dev Pure on purpose: an external read here would consume a pending `vm.prank`.
    function _adminRevert(address who) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, who, keccak256("ADMIN_ROLE")
            );
    }
}

/// @title UniversalMarketplace — unit suite (PRD 12 §6.2, §6.5).
contract UniversalMarketplaceTest is MarketplaceFixtures {
    // ═════════════════════════════ MR · registration ═════════════════════════════

    function test_MR01_registerAgentCard_storesEverythingAndEmits() public {
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardRegistered(
            1, provider, c.jobType, SEPOLIA, keccak256(r), keccak256(e), c.metadataHash, FEE
        );
        vm.prank(provider);
        uint256 id = mkt.registerAgentCard(c, r, e);

        assertEq(id, 1);
        assertEq(mkt.agentCardCount(), 1);
        assertEq(mkt.agentCardOf(provider), id);
        AgentCardView memory v = mkt.getAgentCard(id);
        assertEq(v.card.provider, provider);
        assertEq(v.card.jobType, c.jobType);
        assertEq(v.card.metadataURI, c.metadataURI);
        assertEq(v.card.metadataHash, c.metadataHash);
        assertEq(v.card.chainNamespace, SEPOLIA);
        assertEq(v.card.providerFee, FEE);
        assertEq(v.card.paymentToken, address(token));
        assertEq(v.card.principalMin, c.principalMin);
        assertEq(v.card.principalMax, c.principalMax);
        assertEq(v.card.minDuration, c.minDuration);
        assertEq(v.card.maxDuration, c.maxDuration);
        assertEq(v.card.minExecuteWindow, c.minExecuteWindow);
        assertEq(v.card.settleWindow, c.settleWindow);
        assertTrue(v.card.active);
        assertEq(v.rules, r, "rules stored byte-equal");
        assertEq(v.jobSpecTemplate, e, "template stored byte-equal");
        assertEq(v.version, 1);
        assertFalse(v.verified);
        assertFalse(v.disabled);
        assertEq(mkt.agentCardVersion(id), 1);
    }

    function test_MR02_providerAndActiveAreContractWritten() public {
        AgentCard memory c = _card();
        c.provider = stranger;
        c.active = false;
        uint256 id = _register(c, _rules(), _lendingTemplate());
        assertEq(mkt.getAgentCard(id).card.provider, provider);
        assertTrue(mkt.getAgentCard(id).card.active);
        assertEq(mkt.agentCardOf(stranger), 0);
    }

    function _expectInvalidCard(AgentCard memory c, string memory reason) internal {
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.InvalidAgentCard.selector, reason));
        mkt.registerAgentCard(c, r, e);
    }

    function test_MR03_eachInvalidCardField_reverts() public {
        AgentCard memory c = _card();
        c.jobType = bytes32(0);
        _expectInvalidCard(c, "job type zero");
        c = _card();
        c.metadataURI = "";
        _expectInvalidCard(c, "metadata uri empty");
        c = _card();
        c.metadataHash = bytes32(0);
        _expectInvalidCard(c, "metadata hash zero");

        string[5] memory badChains =
            ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "eip155:", "eip155", "EIP155:11155111", ""];
        for (uint256 i; i < badChains.length; ++i) {
            c = _card();
            c.chainNamespace = badChains[i];
            _expectInvalidCard(c, "chain namespace");
        }

        vm.prank(admin);
        mkt.setEvaluator(provider);
        _expectInvalidCard(_card(), "provider is evaluator");
        vm.prank(admin);
        mkt.setEvaluator(universalEvaluator);

        c = _card();
        c.principalMin = 0;
        c.principalMax = 0;
        _expectInvalidCard(c, "principal range");
        c = _card();
        c.principalMin = 2;
        c.principalMax = 1;
        _expectInvalidCard(c, "principal range");
        c = _card();
        c.minDuration = 1 hours - 1;
        _expectInvalidCard(c, "duration range");
        c = _card();
        c.minDuration = 2 days;
        c.maxDuration = 1 days;
        _expectInvalidCard(c, "duration range");
        c = _card();
        c.settleWindow = 0;
        _expectInvalidCard(c, "settle window");
        c = _card();
        c.minExecuteWindow = 30 days - 2 hours + 1;
        _expectInvalidCard(c, "execute window");

        // every boundary passes: principal min == max, min duration 1 h, min == max duration, window == max
        c = _card();
        c.principalMin = 7;
        c.principalMax = 7;
        c.minDuration = 1 hours;
        c.minExecuteWindow = 30 days - 2 hours;
        _register(c, _rules(), _lendingTemplate());
        c = _card();
        c.minDuration = 30 days;
        _registerAs(provider2, c, _rules(), _lendingTemplate()); // one card per provider: a second provider
    }

    function test_MR04_pushChain_refused() public {
        string memory push = string.concat("eip155:", Strings.toString(block.chainid));
        bytes32 pushHash = keccak256(bytes(push));
        assertEq(mkt.PUSH_CHAIN_HASH(), pushHash);
        vm.prank(admin);
        mkt.setCEADeployment(pushHash, address(ceaFactory), ceaProxyImpl); // refused even with a deployment
        AgentCard memory c = _card();
        c.chainNamespace = push;
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.ChainNotSupported.selector, pushHash));
        mkt.registerAgentCard(c, r, e);
    }

    function test_MR05_unsupportedEvmChain_refused() public {
        AgentCard memory c = _card();
        c.chainNamespace = "eip155:137";
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider);
        vm.expectRevert(
            abi.encodeWithSelector(UniversalMarketplaceErrors.ChainNotSupported.selector, keccak256("eip155:137"))
        );
        mkt.registerAgentCard(c, r, e);
    }

    function _expectInvalidRules(AgentCardRules memory r, string memory reason) internal {
        bytes memory rules = abi.encode(r);
        bytes memory e = abi.encode(_lendingTemplate());
        AgentCard memory c = _card();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.InvalidAgentCard.selector, reason));
        mkt.registerAgentCard(c, rules, e);
    }

    function test_MR06_assetTeeth() public {
        AgentCardRules memory r = _rules();
        r.assets[0].token = makeAddr("codelessAsset");
        _expectInvalidRules(r, "asset");

        MockPRC20Source.Answer[4] memory malformed = [
            MockPRC20Source.Answer.Reverts,
            MockPRC20Source.Answer.Short,
            MockPRC20Source.Answer.BadOffset,
            MockPRC20Source.Answer.Overlong
        ];
        for (uint256 i; i < malformed.length; ++i) {
            pUSDC.setAnswer(malformed[i]);
            _expectInvalidRules(_rules(), "asset");
        }
        pUSDC.setAnswer(MockPRC20Source.Answer.Namespace);
        pUSDC.setNamespace("eip155:1");
        _expectInvalidRules(_rules(), "asset chain");

        pUSDC.setNamespace(SEPOLIA);
        _registerLending();
    }

    function test_MR07_rulesErrorsSurface() public {
        AgentCardRules memory r = _rules();
        r.allowedCalls[0].pins[1].op = PinOp.EQ; // the approve amount is no longer a ceiling
        _expectInvalidRules(r, "approve amount not capped");
    }

    /// @dev The criteria template is stored as given: registration never judges it. A template that writes a fill
    ///      outside its args registers, and fails only when a job is built from it.
    function test_MR08_criteriaNotJudgedAtRegistration() public {
        JobSpecTemplate memory t = _lendingTemplate();
        ReadTemplate[] memory reads = new ReadTemplate[](3);
        reads[0] = t.reads[0];
        reads[1] = t.reads[1];
        reads[2] = _balanceOfCEA(SEPOLIA_ID, weth); // read by no check
        t.reads = reads;
        t.reads[0].fills[0].word = 1; // args are one word long
        uint256 id = _register(_card(), _rules(), t);
        assertEq(mkt.getAgentCard(id).jobSpecTemplate, abi.encode(t), "stored byte-equal");

        JobInputs memory job = _inputs(PRINCIPAL);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.FillOutOfBounds.selector, 0, 0));
        mkt.buildCreateJobCalldata(id, user, 0, job); // the same build openJob runs at step 9
    }

    function test_MR09_assetIndependent() public {
        assertTrue(address(pETH) != address(kernel.paymentToken()), "pETH is not the kernel's payment token");
        AgentCardRules memory r = _rules();
        r.assets[0].token = address(pETH);
        uint256 id = _register(_card(), r, _lendingTemplate());
        OpenJobParams memory p = _readyAt(id, 0, r, _inputs(PRINCIPAL));
        (uint256 jobId, address agw) = _open(p);
        assertEq(kernel.getJob(jobId).client, agw);
        assertEq(abi.decode(mkt.getAgentCard(id).rules, (AgentCardRules)).assets[0].token, address(pETH));
    }

    function test_MR10_paused() public {
        vm.prank(admin);
        mkt.pause();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        AgentCard memory c = _card();
        vm.prank(provider);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        mkt.registerAgentCard(c, r, e);
    }

    function test_MR11_onePerProvider() public {
        uint256 id = _registerLending();
        assertEq(mkt.agentCardOf(provider), id);

        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_swapTemplate());
        AgentCard memory c = _card();
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardAlreadyRegistered.selector, provider));
        mkt.registerAgentCard(c, r, e);

        uint256 id2 = _registerAs(provider2, _card(), _rules(), _swapTemplate());
        assertEq(mkt.agentCardOf(provider2), id2);
        assertEq(mkt.agentCardOf(provider), id, "unchanged");

        vm.prank(admin);
        mkt.disableAgentCard(id);
        assertEq(mkt.agentCardOf(provider), id, "a disabled card still counts");
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardAlreadyRegistered.selector, provider));
        mkt.registerAgentCard(c, r, e);
    }

    function test_MR12_paymentTokenGuard() public {
        address[2] memory bad = [address(pUSDC), address(0)];
        for (uint256 i; i < 2; ++i) {
            AgentCard memory c = _card();
            c.paymentToken = bad[i];
            _expectInvalidCard(c, "payment token");
        }
        uint256 id = _registerLending();
        assertEq(mkt.getAgentCard(id).card.paymentToken, address(kernel.paymentToken()));

        AgentCard memory u = _card();
        u.paymentToken = address(pUSDC);
        _expectInvalidUpdate(id, u, abi.encode(_rules()), abi.encode(_lendingTemplate()), "payment token");
        _update(id, _card(), _rules(), _lendingTemplate());
        assertEq(mkt.agentCardVersion(id), 2);
    }

    function test_MR13_everyAssetOnChain() public {
        pETH.setNamespace("eip155:1");
        _expectInvalidRules(_rulesTwoAssets(), "asset chain");
        pETH.setNamespace(SEPOLIA);

        AgentCardRules memory r = _rulesTwoAssets();
        r.assets[1].token = makeAddr("codelessAsset1");
        _expectInvalidRules(r, "asset");

        uint256 id = _register(_card(), _rulesTwoAssets(), _lendingTemplate());
        assertEq(abi.decode(mkt.getAgentCard(id).rules, (AgentCardRules)).assets.length, 2);
    }

    function test_MR14_rulesErrorsSurface() public {
        AgentCardRules memory r = _rules();
        r.assets = new AssetCap[](0);
        _expectInvalidRules(r, "asset count");
        r = _rules();
        r.allowedCalls[1].pins[0].op = PinOp.MAX;
        _expectInvalidRules(r, "wallet marker op");
        r = _rules();
        r.assets[0].maxTotal = PRINCIPAL;
        _expectInvalidRules(r, "principal total not marker");

        uint256 id = _registerLending();
        r = _rules();
        r.allowedCalls[0].selector = INCREASE_ALLOWANCE;
        _expectInvalidUpdate(id, _card(), abi.encode(r), abi.encode(_lendingTemplate()), "increaseAllowance");
    }

    // ═════════════════════════════ ML · card lifecycle ═════════════════════════════

    function test_ML01_setAgentCardActive() public {
        uint256 id = _registerLending();
        vm.prank(stranger);
        vm.expectRevert(UniversalMarketplaceErrors.CallerIsNotProvider.selector);
        mkt.setAgentCardActive(id, false);
        vm.prank(provider);
        vm.expectRevert(UniversalMarketplaceErrors.CallerIsNotProvider.selector);
        mkt.setAgentCardActive(999, false);

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardStatusChanged(id, false);
        vm.prank(provider);
        mkt.setAgentCardActive(id, false);
        assertFalse(mkt.getAgentCard(id).card.active);
        vm.prank(provider);
        mkt.setAgentCardActive(id, true);
        assertTrue(mkt.getAgentCard(id).card.active);

        vm.prank(admin);
        mkt.disableAgentCard(id);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardDisabled.selector, id));
        mkt.setAgentCardActive(id, true);
        vm.prank(provider);
        mkt.setAgentCardActive(id, false); // switching off stays allowed
    }

    function test_ML02_disableAgentCard() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        vm.prank(admin);
        mkt.verifyAgentCard(id, 1);

        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.disableAgentCard(id);

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardVerificationRevoked(id);
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardDisabled(id);
        vm.prank(admin);
        mkt.disableAgentCard(id);

        AgentCardView memory v = mkt.getAgentCard(id);
        assertTrue(v.disabled);
        assertTrue(mkt.isAgentCardDisabled(id));
        assertFalse(v.card.active);
        assertFalse(v.verified);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardInactive.selector));

        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.AgentCardInactive.selector);
        mkt.disableAgentCard(999);
    }

    function test_ML03_verifyAgentCard() public {
        uint256 id = _registerLending();
        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.verifyAgentCard(id, 1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardVersionMismatch.selector, 2, 1));
        mkt.verifyAgentCard(id, 2);
        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.AgentCardInactive.selector);
        mkt.verifyAgentCard(999, 1);

        vm.prank(provider);
        mkt.setAgentCardActive(id, false); // a card its provider switched off can still be verified
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardVerified(id, 1);
        vm.prank(admin);
        mkt.verifyAgentCard(id, 1);
        assertTrue(mkt.isAgentCardVerified(id));
        assertTrue(mkt.getAgentCard(id).verified);

        uint256 disabled = _registerAs(provider2, _card(), _rules(), _lendingTemplate());
        vm.startPrank(admin);
        mkt.disableAgentCard(disabled);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardDisabled.selector, disabled));
        mkt.verifyAgentCard(disabled, 1);
        vm.stopPrank();
    }

    function test_ML04_verify_racedByUpdate() public {
        uint256 id = _registerLending();
        _update(id, _card(), _rules(), _lendingTemplate());
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardVersionMismatch.selector, 1, 2));
        mkt.verifyAgentCard(id, 1);
        vm.prank(admin);
        mkt.verifyAgentCard(id, 2);
        assertTrue(mkt.isAgentCardVerified(id));
    }

    function test_ML05_revokeVerification() public {
        uint256 id = _registerLending();
        vm.prank(admin);
        mkt.verifyAgentCard(id, 1);
        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.revokeAgentCardVerification(id);

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardVerificationRevoked(id);
        vm.prank(admin);
        mkt.revokeAgentCardVerification(id);
        assertFalse(mkt.isAgentCardVerified(id));

        vm.recordLogs();
        vm.prank(admin);
        mkt.revokeAgentCardVerification(id);
        assertEq(vm.getRecordedLogs().length, 0, "revoking an unverified card logs nothing");

        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.AgentCardInactive.selector);
        mkt.revokeAgentCardVerification(999);
    }

    function _update(uint256 id, AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t) internal {
        bytes memory rules = abi.encode(r);
        bytes memory template = abi.encode(t);
        vm.prank(provider);
        mkt.updateAgentCard(id, c, rules, template);
    }

    /// @dev Every mutable field changed, two assets, a fourth (withdraw) call, and the swap criteria.
    function _updated()
        internal
        view
        returns (AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t)
    {
        c = _card();
        c.jobType = keccak256("SWAP");
        c.metadataURI = "ipfs://card-v2";
        c.metadataHash = keccak256("card-v2.json");
        c.providerFee = FEE * 3;
        c.principalMin = 200e6;
        c.principalMax = 2_000e6;
        c.minDuration = 4 hours;
        c.maxDuration = 10 days;
        c.minExecuteWindow = 20 minutes;
        c.settleWindow = 3 hours;
        r = _rulesTwoAssets();
        r.maxGasPerCall = 2 ether;
        r.allowedCalls =
            _appendCall(r.allowedCalls, _allowed(pool, WITHDRAW, 0, false, _pins1(68, PinOp.EQ, MARKER_WALLET)));
        t = _swapTemplate();
        t.allowedMutability = AllowedMutability.CLIENT;
    }

    function _appendCall(AllowedCall[] memory calls, AllowedCall memory c)
        internal
        pure
        returns (AllowedCall[] memory out)
    {
        out = new AllowedCall[](calls.length + 1);
        for (uint256 i; i < calls.length; ++i) {
            out[i] = calls[i];
        }
        out[calls.length] = c;
    }

    function test_ML06_update_updatesEveryMutableField() public {
        uint256 id = _registerLending();
        vm.prank(provider);
        mkt.setAgentCardActive(id, false);
        (AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t) = _updated();
        c.provider = stranger; // ignored
        c.active = true; // ignored: the provider's switch stays off
        bytes memory rules = abi.encode(r);
        bytes memory template = abi.encode(t);

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardUpdated(
            id, 2, keccak256(rules), keccak256(template), c.metadataHash, c.providerFee
        );
        vm.prank(provider);
        mkt.updateAgentCard(id, c, rules, template);

        AgentCardView memory v = mkt.getAgentCard(id);
        assertEq(v.card.provider, provider, "provider kept");
        assertEq(v.card.chainNamespace, SEPOLIA, "chain kept");
        assertFalse(v.card.active, "active kept");
        assertEq(v.card.jobType, c.jobType);
        assertEq(v.card.metadataURI, c.metadataURI);
        assertEq(v.card.metadataHash, c.metadataHash);
        assertEq(v.card.providerFee, c.providerFee);
        assertEq(v.card.paymentToken, c.paymentToken);
        assertEq(v.card.principalMin, c.principalMin);
        assertEq(v.card.principalMax, c.principalMax);
        assertEq(v.card.minDuration, c.minDuration);
        assertEq(v.card.maxDuration, c.maxDuration);
        assertEq(v.card.minExecuteWindow, c.minExecuteWindow);
        assertEq(v.card.settleWindow, c.settleWindow);
        assertEq(v.rules, rules);
        assertEq(v.jobSpecTemplate, template);
        assertEq(v.version, 2);
        assertEq(mkt.agentCardCount(), 1, "no new card");

        // and an active card stays active when the input says inactive
        vm.prank(provider);
        mkt.setAgentCardActive(id, true);
        c.active = false;
        _update(id, c, r, t);
        assertTrue(mkt.getAgentCard(id).card.active);
        assertEq(mkt.agentCardVersion(id), 3);
    }

    function test_ML07_update_clearsVerification() public {
        uint256 id = _registerLending();
        vm.prank(admin);
        mkt.verifyAgentCard(id, 1);
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardVerificationRevoked(id);
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentCardUpdated(id, 2, keccak256(r), keccak256(e), c.metadataHash, c.providerFee);
        vm.prank(provider);
        mkt.updateAgentCard(id, c, r, e);
        assertFalse(mkt.isAgentCardVerified(id));
    }

    function test_ML08_update_access() public {
        uint256 id = _registerLending();
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());

        vm.prank(stranger);
        vm.expectRevert(UniversalMarketplaceErrors.CallerIsNotProvider.selector);
        mkt.updateAgentCard(id, c, r, e);
        vm.prank(provider);
        vm.expectRevert(UniversalMarketplaceErrors.CallerIsNotProvider.selector);
        mkt.updateAgentCard(999, c, r, e);

        vm.prank(admin);
        mkt.pause();
        vm.prank(provider);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        mkt.updateAgentCard(id, c, r, e);
        vm.prank(admin);
        mkt.unpause();

        vm.prank(admin);
        mkt.disableAgentCard(id);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardDisabled.selector, id));
        mkt.updateAgentCard(id, c, r, e);
    }

    function test_ML09_update_chainImmutable() public {
        uint256 id = _registerLending();
        bytes32 baseSepolia = keccak256("eip155:84532");
        vm.prank(admin);
        mkt.setCEADeployment(baseSepolia, address(ceaFactory), ceaProxyImpl);
        AgentCard memory c = _card();
        c.chainNamespace = "eip155:84532";
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider);
        vm.expectRevert(UniversalMarketplaceErrors.AgentCardIdentityImmutable.selector);
        mkt.updateAgentCard(id, c, r, e);
    }

    function test_ML10_update_validatesLikeRegistration() public {
        uint256 id = _registerLending();
        AgentCard memory c = _card();
        c.settleWindow = 0;
        _expectInvalidUpdate(id, c, abi.encode(_rules()), abi.encode(_lendingTemplate()), "settle window");

        AgentCardRules memory r = _rules();
        r.allowedCalls[0].selector = INCREASE_ALLOWANCE;
        _expectInvalidUpdate(id, _card(), abi.encode(r), abi.encode(_lendingTemplate()), "increaseAllowance");

        assertEq(mkt.agentCardVersion(id), 1, "no failed update bumped the version");
    }

    function _expectInvalidUpdate(uint256 id, AgentCard memory c, bytes memory r, bytes memory e, string memory reason)
        internal
    {
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSelector(UniversalMarketplaceErrors.InvalidAgentCard.selector, reason));
        mkt.updateAgentCard(id, c, r, e);
    }

    function test_ML11_update_invalidatesOldIntents() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        _update(id, _card(), _rules(), _lendingTemplate()); // same content, version 2

        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardVersionMismatch.selector, 1, 2));
        p.cardVersion = 2;
        _expectOpen(
            p,
            abi.encodeWithSelector(UniversalMarketplaceErrors.IntentExecMismatch.selector, _calldataHash(id, 0, p.job))
        );
        assertEq(factory.walletCount(user), 0, "nothing deployed");
    }

    function test_ML12_update_leavesOpenedJobsUntouched() public {
        uint256 id = _registerLending();
        (uint256 jobId, address agw) = _open(_ready(id));
        IAgenticCommerce.Job memory before = kernel.getJob(jobId);

        (AgentCard memory c, AgentCardRules memory r, JobSpecTemplate memory t) = _updated();
        _update(id, c, r, t);

        IAgenticCommerce.Job memory afterJob = kernel.getJob(jobId);
        assertEq(afterJob.provider, before.provider);
        assertEq(afterJob.evaluator, before.evaluator);
        assertEq(afterJob.description, before.description);
        assertEq(afterJob.hook, before.hook);
        assertEq(mkt.cardOfJob(jobId), id);
        assertEq(mkt.agwOfJob(jobId), agw);
        assertEq(mkt.activeJobOf(agw), jobId);
        assertEq(mkt.rulesOfJob(jobId), MockAGW(payable(agw)).RULES_ID());
        assertEq(mkt.cardVersionOfJob(jobId), 1, "the version the job was opened against");
    }

    function test_ML13_openJob_afterUpdate_usesNewContent() public {
        uint256 id = _registerLending();
        JobSpecTemplate memory t = _lendingTemplate();
        t.checks[1].value = 0.05e27;
        AgentCardRules memory r = _rules();
        r.maxGasPerCall = 2 ether;
        _update(id, _card(), r, t);

        OpenJobParams memory p = _readyAt(id, 0, r, _inputs(PRINCIPAL));
        (uint256 jobId, address agw) = _open(p);
        bytes memory description = bytes(kernel.getJob(jobId).description);
        assertEq(description, _expectedDescription(t, id, 2, agw, p.job));
        JobSpec memory spec = abi.decode(description, (JobSpec));
        assertEq(spec.checks[1].target, 0.05e27, "the new criteria");
        assertEq(spec.origin, keccak256(abi.encode(address(mkt), id, uint256(2), PRINCIPAL)), "origin carries v2");
        assertEq(mkt.cardVersionOfJob(jobId), 2);
        assertEq(_granted(agw).maxGasPerCall, 2 ether, "the new rules");
    }

    // ═════════════════════════════ MS · openJob ═════════════════════════════

    function test_MS01_freshWallet_happyPath() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        address agw = p.intent.wallet;
        uint256 expectedJobId = kernel.jobCounter() + 1;

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.JobOpened(id, user, agw, expectedJobId, keccak256("mock-rules"), PRINCIPAL, 1);
        vm.prank(relayer);
        (uint256 jobId, address got, bytes32 rulesId) = mkt.openJob(p);

        assertEq(jobId, expectedJobId);
        assertEq(got, agw, "deployed at the predicted address");
        assertEq(factory.ownerOf(agw), user);
        MockAGW w = MockAGW(payable(agw));
        assertEq(rulesId, w.RULES_ID());
        assertEq(w.lastSessionHash(), keccak256(abi.encode(p.session)));
        assertEq(w.lastGrantIntentHash(), keccak256(abi.encode(p.intent)), "grant got the signed intent");
        assertEq(w.lastExecIntentHash(), keccak256(abi.encode(p.intent)), "exec got the same intent");
        assertEq(w.lastGrantCaller(), address(mkt));
        assertEq(w.lastExecCalldataHash(), _calldataHash(id, 0, p.job));

        IAgenticCommerce.Job memory j = kernel.getJob(jobId);
        assertEq(j.client, agw);
        assertEq(j.provider, provider);
        assertEq(j.evaluator, universalEvaluator);
        assertEq(j.hook, address(hook));
        assertEq(j.expiredAt, p.job.expiredAt);
        assertEq(j.budget, 0);
        assertEq(uint8(j.status), uint8(IAgenticCommerce.JobStatus.Open));
        assertEq(bytes(j.description), _expectedDescription(_lendingTemplate(), id, 1, agw, p.job));

        assertEq(mkt.activeJobOf(agw), jobId);
        assertEq(mkt.cardOfJob(jobId), id);
        assertEq(mkt.agwOfJob(jobId), agw);
        assertEq(mkt.rulesOfJob(jobId), rulesId);
        assertEq(mkt.cardVersionOfJob(jobId), 1);
    }

    function test_MS02_movesNoFunds() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        address agw = p.intent.wallet;
        address[3] memory who = [user, agw, address(mkt)];
        uint256[3] memory tokenBefore;
        uint256[3] memory assetBefore;
        uint256[3] memory ethBefore;
        for (uint256 i; i < 3; ++i) {
            tokenBefore[i] = token.balanceOf(who[i]);
            assetBefore[i] = pUSDC.balanceOf(who[i]);
            ethBefore[i] = who[i].balance;
        }
        assertEq(token.allowance(user, address(mkt)), 0, "no allowance");
        assertEq(pUSDC.allowance(user, address(mkt)), 0, "no allowance");
        assertEq(agw.balance, 0, "no PC in the AGW");

        _open(p);

        for (uint256 i; i < 3; ++i) {
            assertEq(token.balanceOf(who[i]), tokenBefore[i], "payment token moved");
            assertEq(pUSDC.balanceOf(who[i]), assetBefore[i], "rules asset moved");
            assertEq(who[i].balance, ethBefore[i], "PC moved");
        }
        assertEq(token.balanceOf(address(mkt)), 0);
        assertEq(address(mkt).balance, 0);
    }

    function test_MS03_existingWallet_skipsDeploy() public {
        uint256 id = _registerLending();
        (uint256 job1, address agw) = _open(_ready(id));
        vm.prank(provider);
        kernel.reject(job1, bytes32(0), "");

        OpenJobParams memory p = _readyAt(id, 0, _rules(), _inputs(PRINCIPAL));
        assertEq(p.intent.grantNonce, 1, "preview reads the live grant nonce");
        assertEq(p.intent.nonceSeq, 1, "preview reads the live lane");
        (uint256 job2, address again) = _open(p);
        assertEq(again, agw);
        assertEq(factory.walletCount(user), 1, "no second wallet");
        assertEq(job2, job1 + 1);
        assertEq(MockAGW(payable(agw)).grantNonce(), 2, "rules granted again");
        assertEq(mkt.activeJobOf(agw), job2);
    }

    function test_MS04_existingWallet_wrongOwner() public {
        uint256 id = _registerLending();
        (uint256 job1, address agw) = _open(_ready(id));
        vm.prank(provider);
        kernel.reject(job1, bytes32(0), "");
        OpenJobParams memory p = _readyAt(id, 0, _rules(), _inputs(PRINCIPAL));
        // the factory's registry disagrees with the derivation (MockAGWFactory.ownerOf is slot 2)
        vm.store(address(factory), keccak256(abi.encode(agw, uint256(2))), bytes32(uint256(uint160(stranger))));
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.WalletOwnerMismatch.selector, user, stranger));
    }

    function test_MS04b_factoryDeploysElsewhere_agwMismatch() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        factory.setMisdeploy(true);
        bytes32 salt = keccak256(abi.encode(keccak256(abi.encode(user, uint96(0)))));
        address elsewhere = vm.computeCreate2Address(
            salt, keccak256(abi.encodePacked(type(MockAGW).creationCode, abi.encode(user))), address(factory)
        );
        _expectOpen(
            p, abi.encodeWithSelector(UniversalMarketplaceErrors.AGWMismatch.selector, p.intent.wallet, elsewhere)
        );
    }

    function test_MS05_cardInactive_unknown() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);

        vm.prank(provider);
        mkt.setAgentCardActive(id, false);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardInactive.selector));
        vm.prank(provider);
        mkt.setAgentCardActive(id, true);

        p.cardId = 999;
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardInactive.selector));
        p.cardId = id;
        _open(p);
    }

    function test_MS06_cardVersionMismatch() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        p.cardVersion = 2;
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardVersionMismatch.selector, 2, 1));
        p.cardVersion = 0;
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentCardVersionMismatch.selector, 0, 1));
    }

    function test_MS07_principalOutOfRange() public {
        uint256 id = _registerLending();
        uint256[2] memory bad = [uint256(100e6 - 1), 1_000e6 + 1];
        for (uint256 i; i < 2; ++i) {
            OpenJobParams memory p = _readyAt(id, uint96(factory.walletCount(user)), _rules(), _inputs(bad[i]));
            _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.PrincipalOutOfRange.selector));
        }
        _open(_readyAt(id, 0, _rules(), _inputs(100e6)));
        _open(_readyAt(id, 1, _rules(), _inputs(1_000e6)));
    }

    function _withTimes(uint256 expiredAt, uint256 executeBy) internal view returns (JobInputs memory j) {
        j = _inputs(PRINCIPAL);
        // forge-lint: disable-next-line(unsafe-typecast)
        j.expiredAt = uint48(expiredAt); // a timestamp within 31 days of now
        // forge-lint: disable-next-line(unsafe-typecast)
        j.executeBy = uint48(executeBy); // a timestamp within 31 days of now
    }

    function test_MS08_expiryOutOfRange() public {
        uint256 id = _registerLending();
        uint256 t = block.timestamp;
        JobInputs memory tooSoon = _withTimes(t + 3 hours - 1, t + 10 minutes);
        JobInputs memory tooLate = _withTimes(t + 30 days + 1, t + 10 minutes);
        _expectOpen(
            _readyAt(id, 0, _rules(), tooSoon),
            abi.encodeWithSelector(UniversalMarketplaceErrors.ExpiryOutOfRange.selector)
        );
        _expectOpen(
            _readyAt(id, 0, _rules(), tooLate),
            abi.encodeWithSelector(UniversalMarketplaceErrors.ExpiryOutOfRange.selector)
        );
        _open(_readyAt(id, 0, _rules(), _withTimes(t + 3 hours, t + 10 minutes)));
        _open(_readyAt(id, 1, _rules(), _withTimes(t + 30 days, t + 10 minutes)));
    }

    function test_MS09_executeByOutOfRange() public {
        uint256 id = _registerLending();
        uint256 t = block.timestamp;
        uint256 expiry = t + 7 days;
        _expectOpen(
            _readyAt(id, 0, _rules(), _withTimes(expiry, t + 10 minutes - 1)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.ExecuteByOutOfRange.selector)
        );
        _expectOpen(
            _readyAt(id, 0, _rules(), _withTimes(expiry, expiry - 2 hours + 1)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.ExecuteByOutOfRange.selector)
        );
        _open(_readyAt(id, 0, _rules(), _withTimes(expiry, t + 10 minutes)));
        _open(_readyAt(id, 1, _rules(), _withTimes(expiry, expiry - 2 hours)));
    }

    function test_MS10_params() public {
        uint256 id = _registerSwap();

        OpenJobParams memory p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.params = new int256[](0);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.ParamCountMismatch.selector, 1, 0));
        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.params = new int256[](2);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.ParamCountMismatch.selector, 1, 2));

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.params[0] = 0;
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.ParamOutOfRange.selector, 0, int256(0)));
        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.params[0] = 1e30 + 1;
        _expectOpen(
            p, abi.encodeWithSelector(UniversalMarketplaceErrors.ParamOutOfRange.selector, 0, int256(1e30 + 1))
        );

        (uint256 jobA,) = _open(_readyAt(id, 0, _rules(), _swapInputs(1)));
        (uint256 jobB,) = _open(_readyAt(id, 1, _rules(), _swapInputs(1e30)));
        assertEq(abi.decode(bytes(kernel.getJob(jobA).description), (JobSpec)).checks[0].target, 1);
        assertEq(abi.decode(bytes(kernel.getJob(jobB).description), (JobSpec)).checks[0].target, 1e30);
    }

    function test_MS11_intentWalletAndExecutor() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        address agw = p.intent.wallet;
        p.intent.wallet = stranger;
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.IntentWalletMismatch.selector, agw, stranger));
        p = _ready(id);
        p.intent.executor = stranger;
        _expectOpen(
            p, abi.encodeWithSelector(UniversalMarketplaceErrors.ExecutorMismatch.selector, stranger, address(mkt))
        );
    }

    function _expectExecMismatch(OpenJobParams memory p, uint96 index) internal {
        _expectOpen(
            p,
            abi.encodeWithSelector(
                UniversalMarketplaceErrors.IntentExecMismatch.selector, _calldataHash(p.cardId, index, p.job)
            )
        );
    }

    function test_MS12_intentExecMismatch_everyBoundInput() public {
        uint256 id = _registerSwap();
        JobInputs memory job = _swapInputs(0.5e18);

        OpenJobParams memory p = _readyAt(id, 0, _rules(), job);
        p.job.principal = PRINCIPAL + 1;
        _expectExecMismatch(p, 0);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.executeBy += 1;
        _expectExecMismatch(p, 0);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.expiredAt += 1;
        _expectExecMismatch(p, 0);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.job.params[0] += 1;
        _expectExecMismatch(p, 0);

        // another wallet of the same owner: its CEA is in the criteria
        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.intent.index = 1;
        (p.intent.wallet,) = factory.predictWallet(user, 1);
        _expectExecMismatch(p, 1);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.intent.mode = bytes32(uint256(1));
        _expectExecMismatch(p, 0);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.intent.nonceKey = 0;
        _expectExecMismatch(p, 0);

        p = _readyAt(id, 0, _rules(), _swapInputs(0.5e18));
        p.intent.execCalldataHash = keccak256("another call");
        _expectExecMismatch(p, 0);
    }

    function test_MS13_intentSessionMismatch_noStateOnFailure() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        p.session.salt = bytes32(uint256(1));
        uint256 jobsBefore = kernel.jobCounter();
        _expectOpen(
            p,
            abi.encodeWithSelector(
                UniversalMarketplaceErrors.IntentSessionMismatch.selector, keccak256(abi.encode(p.session))
            )
        );
        assertEq(factory.walletCount(user), 0, "no wallet");
        assertEq(kernel.jobCounter(), jobsBefore, "no job");
        assertEq(mkt.activeJobOf(p.intent.wallet), 0);
    }

    function _expectActive(uint256 id, address agw, uint256 jobId) internal {
        assertEq(mkt.activeJobOf(agw), jobId);
        _expectOpen(
            _readyAt(id, 0, _rules(), _inputs(PRINCIPAL)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.WalletHasActiveJob.selector, agw, jobId)
        );
    }

    function test_MS14_oneLiveJob() public {
        uint256 id = _registerLending();

        // Open → active; expired Open → free
        (uint256 job1, address agw) = _open(_ready(id));
        _expectActive(id, agw, job1);
        vm.warp(kernel.getJob(job1).expiredAt);
        assertEq(mkt.activeJobOf(agw), 0, "free after an expired Open job");

        // Open → Rejected → free
        (uint256 job2,) = _open(_readyAt(id, 0, _rules(), _inputs(PRINCIPAL)));
        vm.prank(provider);
        kernel.reject(job2, bytes32(0), "");
        assertEq(mkt.activeJobOf(agw), 0, "free after Rejected");

        // Funded → active; Submitted → active; Completed → free
        (uint256 job3,) = _open(_readyAt(id, 0, _rules(), _inputs(PRINCIPAL)));
        _budgetAndFund(job3, agw, FEE);
        assertEq(uint8(_status(job3)), uint8(IAgenticCommerce.JobStatus.Funded));
        _expectActive(id, agw, job3);
        vm.prank(provider);
        kernel.submit(job3, keccak256("deliverable"), "");
        _expectActive(id, agw, job3);
        vm.prank(universalEvaluator);
        kernel.complete(job3, bytes32(0), "");
        assertEq(mkt.activeJobOf(agw), 0, "free after Completed");
        _open(_readyAt(id, 0, _rules(), _inputs(PRINCIPAL)));
    }

    function test_MS15_jobVerification() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        vm.prank(user);
        factory.deployWalletWithSig(p.intent, "", "");
        MockAGW(payable(p.intent.wallet)).setMode(MockAGW.Mode.TwoJobs);
        uint256 n = kernel.jobCounter();
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.UnexpectedJobCount.selector, n, n + 2));

        MockAGW(payable(p.intent.wallet)).setMode(MockAGW.Mode.ForeignClient);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.JobMismatch.selector));

        MockAGW(payable(p.intent.wallet)).setMode(MockAGW.Mode.OtherEvaluator);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.JobMismatch.selector));
    }

    function test_MS16_providerIsEvaluator_afterSetEvaluator() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        vm.prank(admin);
        mkt.setEvaluator(provider);
        _expectOpen(p, abi.encodeWithSelector(UniversalMarketplaceErrors.ProviderIsEvaluator.selector));
    }

    function test_MS17_8183Continuation_feeEnforcedAtFund() public {
        uint256 id = _registerLending();
        (uint256 jobId, address agw) = _open(_ready(id));
        uint256 fee = mkt.getAgentCard(id).card.providerFee;

        // a provider who prices above the card cannot be funded: the owner's expectedBudget is the card fee
        vm.prank(provider);
        kernel.setBudget(jobId, fee + 1, "");
        engine.setPermission(MockAGW(payable(agw)).RULES_ID(), agw, true);
        token.mint(agw, fee + 1);
        bytes memory optParams = abi.encode(mkt.rulesOfJob(jobId));
        vm.startPrank(agw);
        token.approve(address(kernel), fee + 1);
        vm.expectRevert(IAgenticCommerce.BudgetMismatch.selector);
        kernel.fund(jobId, fee, optParams);
        vm.stopPrank();

        uint256 escrowBefore = kernel.totalEscrowed();
        _budgetAndFund(jobId, agw, fee);
        assertEq(uint8(_status(jobId)), uint8(IAgenticCommerce.JobStatus.Funded));
        assertEq(kernel.totalEscrowed() - escrowBefore, fee, "the kernel escrows the card fee");
        assertEq(kernel.getJob(jobId).budget, fee);
    }

    /// @dev Ceilings = measured + 5%, rounded up to 10k (PRD 12 §6.5). Measured 2026-10-16 with the mock wallet
    ///      and factory, two-asset card: registerAgentCard 2,564,983 · openJob fresh 4,231,625 · openJob existing
    ///      1,797,405. MockAGW now stores the granted initData (`lastPolicyInitData`), which is part of both
    ///      openJob figures.
    uint256 internal constant REGISTER_GAS_CEILING = 2_700_000;
    uint256 internal constant OPEN_FRESH_GAS_CEILING = 4_450_000;
    uint256 internal constant OPEN_EXISTING_GAS_CEILING = 1_890_000;

    function test_MS18_gasCeilings() public {
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rulesTwoAssets());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider);
        uint256 g = gasleft();
        uint256 id = mkt.registerAgentCard(c, r, e);
        uint256 used = g - gasleft();
        emit log_named_uint("registerAgentCard (two-asset lending card)", used);
        assertLe(used, REGISTER_GAS_CEILING, "registerAgentCard (two-asset lending card)");

        OpenJobParams memory p = _readyAt(id, 0, _rulesTwoAssets(), _inputs(PRINCIPAL));
        vm.prank(relayer);
        g = gasleft();
        (uint256 jobId,,) = mkt.openJob(p);
        used = g - gasleft();
        emit log_named_uint("openJob (fresh wallet)", used);
        assertLe(used, OPEN_FRESH_GAS_CEILING, "openJob (fresh wallet)");

        vm.prank(provider);
        kernel.reject(jobId, bytes32(0), "");
        p = _readyAt(id, 0, _rulesTwoAssets(), _inputs(PRINCIPAL));
        vm.prank(relayer);
        g = gasleft();
        mkt.openJob(p);
        used = g - gasleft();
        emit log_named_uint("openJob (existing wallet)", used);
        assertLe(used, OPEN_EXISTING_GAS_CEILING, "openJob (existing wallet)");
    }

    function test_MS19_openJob_twoAssets_principalMarkers() public {
        uint256 id = _register(_card(), _rulesTwoAssets(), _lendingTemplate());
        OpenJobParams memory p = _readyAt(id, 0, _rulesTwoAssets(), _inputs(PRINCIPAL));
        address agw = p.intent.wallet;
        uint256 expectedJobId = kernel.jobCounter() + 1;

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.JobOpened(id, user, agw, expectedJobId, keccak256("mock-rules"), PRINCIPAL, 1);
        (uint256 jobId,) = _open(p);

        assertEq(MockAGW(payable(agw)).lastSessionHash(), keccak256(abi.encode(p.session)));
        assertEq(mkt.cardVersionOfJob(jobId), 1);
        UniversalTerms memory t = _granted(agw);
        assertEq(t.assets.length, 2);
        assertEq(t.assets[0].token, address(pUSDC));
        assertEq(t.assets[0].maxPerCall, PRINCIPAL, "principal per-call: marker filled");
        assertEq(t.assets[0].maxTotal, PRINCIPAL, "principal total: marker filled");
        assertEq(t.assets[1].token, address(pETH));
        assertEq(t.assets[1].maxPerCall, 0);
        assertEq(t.assets[1].maxTotal, 0);
        assertEq(t.allowedCalls[0].pins[1].value, bytes32(PRINCIPAL), "approve amount pin filled");
        assertEq(t.allowedCalls[1].pins[0].value, _word(mkt.computeCEA(agw, SEPOLIA_HASH)), "wallet pin filled");
        assertEq(t.expectedCEA, mkt.computeCEA(agw, SEPOLIA_HASH));
    }

    function test_MS20_openJob_trancheCard() public {
        AgentCardRules memory r = _rules();
        r.assets[0].maxPerCall = 100e6;
        uint256 id = _register(_card(), r, _lendingTemplate());
        JobInputs memory job = _inputs(PRINCIPAL);
        (address agw,) = factory.predictWallet(user, 0);

        UniversalTerms memory t = _termsFor(r, agw, job);
        assertEq(t.assets[0].maxPerCall, 100e6, "an SDK copies a fixed per-call cap");
        t.assets[0].maxPerCall = PRINCIPAL;
        _expectOpen(
            _params(id, 0, job, _sessionOf(t)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.PrincipalCapMismatch.selector)
        );

        (, address opened) = _open(_readyAt(id, 0, r, job));
        assertEq(_granted(opened).assets[0].maxPerCall, 100e6);
        assertEq(_granted(opened).assets[0].maxTotal, PRINCIPAL);
    }

    function test_MS21_activeJobOf() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        address agw = p.intent.wallet;
        assertEq(mkt.activeJobOf(agw), 0, "before");

        (uint256 job1,) = _open(p);
        assertEq(mkt.activeJobOf(agw), job1, "Open");
        _expectOpen(
            _readyAt(id, 0, _rules(), _inputs(PRINCIPAL)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.WalletHasActiveJob.selector, agw, job1)
        );
        vm.warp(kernel.getJob(job1).expiredAt - 1);
        assertEq(mkt.activeJobOf(agw), job1, "Open, one second before expiry");
        vm.warp(kernel.getJob(job1).expiredAt);
        assertEq(mkt.activeJobOf(agw), 0, "Open, expired");

        (uint256 job2,) = _open(_readyAt(id, 0, _rules(), _inputs(PRINCIPAL)));
        _budgetAndFund(job2, agw, FEE);
        assertEq(mkt.activeJobOf(agw), job2, "Funded");
        vm.prank(provider);
        kernel.submit(job2, keccak256("deliverable"), "");
        vm.prank(universalEvaluator);
        kernel.complete(job2, bytes32(0), "");
        assertEq(mkt.activeJobOf(agw), 0, "Completed");

        (uint256 job3,) = _open(_readyAt(id, 0, _rules(), _inputs(PRINCIPAL)));
        vm.prank(provider);
        kernel.reject(job3, bytes32(0), "");
        assertEq(mkt.activeJobOf(agw), 0, "Rejected");
        assertEq(mkt.activeJobOf(makeAddr("neverSeen")), 0);
    }

    function test_MS22_envelopeVersion_named() public {
        uint256 id = _registerLending();
        JobInputs memory job = _inputs(PRINCIPAL);
        (address agw,) = factory.predictWallet(user, 0);
        bytes memory preV6 = abi.encode(SEPOLIA, abi.encode(_termsFor(_rules(), agw, job))); // (string, bytes)
        Session memory s = _wrapSession(preV6, provider, _skeleton());
        _expectOpen(
            _params(id, 0, job, s), abi.encodeWithSelector(UniversalMarketplaceErrors.EnvelopeVersionMismatch.selector, 64)
        );
        assertEq(factory.walletCount(user), 0, "nothing deployed");
    }

    // ═════════════════════════════ MB · rules = card, through the marketplace ═════════════════════════════

    function _sessionCase(function(Session memory) internal view mutate, bytes memory err) internal {
        uint256 id = _lendingId();
        JobInputs memory job = _inputs(PRINCIPAL);
        (address agw,) = factory.predictWallet(user, 0);
        Session memory s = _sessionFor(_rules(), agw, job);
        mutate(s);
        _expectOpen(_params(id, 0, job, s), err);
    }

    function _termsCase(function(UniversalTerms memory) internal view mutate, bytes memory err) internal {
        uint256 id = _lendingId();
        JobInputs memory job = _inputs(PRINCIPAL);
        (address agw,) = factory.predictWallet(user, 0);
        UniversalTerms memory t = _termsFor(_rules(), agw, job);
        mutate(t);
        _expectOpen(_params(id, 0, job, _sessionOf(t)), err);
    }

    function _otherAgent(Session memory s) internal view {
        s.sessionValidatorInitData = abi.encode(stranger);
    }

    function _wideInitData(Session memory s) internal view {
        s.sessionValidatorInitData = abi.encode(provider, provider);
    }

    function _noActions(Session memory s) internal pure {
        s.actions = new ActionData[](0);
    }

    function _twoActions(Session memory s) internal pure {
        ActionData[] memory a = new ActionData[](2);
        a[0] = s.actions[0];
        a[1] = s.actions[0];
        s.actions = a;
    }

    function _twoPolicies(Session memory s) internal pure {
        PolicyData[] memory p = new PolicyData[](2);
        p[0] = s.actions[0].actionPolicies[0];
        p[1] = s.actions[0].actionPolicies[0];
        s.actions[0].actionPolicies = p;
    }

    function _otherChain(Session memory s) internal pure {
        (uint16 v,, bytes memory body) = abi.decode(s.actions[0].actionPolicies[0].initData, (uint16, string, bytes));
        s.actions[0].actionPolicies[0].initData = abi.encode(v, "eip155:1", body);
    }

    function test_MB01_agentMismatch() public {
        _sessionCase(_otherAgent, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentMismatch.selector));
        _sessionCase(_wideInitData, abi.encodeWithSelector(UniversalMarketplaceErrors.AgentMismatch.selector));
    }

    function test_MB02_shape() public {
        _sessionCase(_noActions, abi.encodeWithSelector(UniversalMarketplaceErrors.ActionCount.selector));
        _sessionCase(_twoActions, abi.encodeWithSelector(UniversalMarketplaceErrors.ActionCount.selector));
        _sessionCase(_twoPolicies, abi.encodeWithSelector(UniversalMarketplaceErrors.PolicyShape.selector, 0));
        _sessionCase(_otherChain, abi.encodeWithSelector(UniversalMarketplaceErrors.ChainMismatch.selector, 0));
    }

    function _otherAsset(UniversalTerms memory t) internal view {
        t.assets[0].token = address(pETH);
    }

    function _gasCapUp(UniversalTerms memory t) internal pure {
        t.maxGasPerCall += 1;
    }

    function _extraCall(UniversalTerms memory t) internal view {
        t.allowedCalls = _appendCall(t.allowedCalls, _allowed(pool, WITHDRAW, 68, true, new ArgPin[](0)));
    }

    function _missingCall(UniversalTerms memory t) internal pure {
        t.allowedCalls = new AllowedCall[](0);
    }

    function _valueChanged(UniversalTerms memory t) internal pure {
        t.allowedCalls[0].maxValue = 1;
    }

    function _totalNotPrincipal(UniversalTerms memory t) internal pure {
        t.assets[0].maxTotal -= 1;
    }

    function _perCallOverPrincipal(UniversalTerms memory t) internal pure {
        t.assets[0].maxPerCall += 1;
    }

    function _validUntilMoved(UniversalTerms memory t) internal pure {
        t.validUntil += 1;
    }

    function _attackerCEA(UniversalTerms memory t) internal pure {
        t.expectedCEA = address(0xBAD);
    }

    function test_MB03_terms() public {
        _termsCase(_otherAsset, abi.encodeWithSelector(UniversalMarketplaceErrors.AssetMismatch.selector, 0));
        _termsCase(_gasCapUp, abi.encodeWithSelector(UniversalMarketplaceErrors.GasCapMismatch.selector));
        _termsCase(_extraCall, abi.encodeWithSelector(UniversalMarketplaceErrors.ActionsMismatch.selector));
        _termsCase(_missingCall, abi.encodeWithSelector(UniversalMarketplaceErrors.ActionsMismatch.selector));
        _termsCase(_valueChanged, abi.encodeWithSelector(UniversalMarketplaceErrors.ActionsMismatch.selector));
        _termsCase(
            _totalNotPrincipal, abi.encodeWithSelector(UniversalMarketplaceErrors.PrincipalCapMismatch.selector)
        );
        _termsCase(
            _perCallOverPrincipal, abi.encodeWithSelector(UniversalMarketplaceErrors.PrincipalCapMismatch.selector)
        );
        _termsCase(_validUntilMoved, abi.encodeWithSelector(UniversalMarketplaceErrors.ExpiryMismatch.selector));
        (address agw,) = factory.predictWallet(user, 0);
        _termsCase(
            _attackerCEA,
            abi.encodeWithSelector(
                UniversalMarketplaceErrors.ExpectedCEAMismatch.selector, ceaFactory.computeCEA(agw), address(0xBAD)
            )
        );

        // reordered: a four-call card, the session lists two calls the other way round
        (, AgentCardRules memory four,) = _updated();
        uint256 id = _lendingId();
        _update(id, _card(), four, _lendingTemplate());
        JobInputs memory job = _inputs(PRINCIPAL);
        UniversalTerms memory t = _termsFor(four, agw, job);
        (t.allowedCalls[1], t.allowedCalls[3]) = (t.allowedCalls[3], t.allowedCalls[1]);
        _expectOpen(
            _params(id, 0, job, _sessionOf(t)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.ActionsMismatch.selector)
        );
    }

    /// @dev D3 flips the old "per-call below principal passes": the card's per-call cap is `MARKER_PRINCIPAL`, so
    ///      the session's must EQUAL the principal.
    function test_MB04_perCallMustEqualPrincipal() public {
        uint256 id = _registerLending();
        JobInputs memory job = _inputs(PRINCIPAL);
        (address agw,) = factory.predictWallet(user, 0);
        UniversalTerms memory t = _termsFor(_rules(), agw, job);
        t.assets[0].maxPerCall = PRINCIPAL / 4;
        _expectOpen(
            _params(id, 0, job, _sessionOf(t)),
            abi.encodeWithSelector(UniversalMarketplaceErrors.PrincipalCapMismatch.selector)
        );
        t.assets[0].maxPerCall = PRINCIPAL;
        _open(_params(id, 0, job, _sessionOf(t)));
    }

    // ═════════════════════════════ MV · views, admin, upgrade ═════════════════════════════

    function test_MV01_getAgentCard_fullView() public {
        uint256 id = _registerLending();
        vm.prank(admin);
        mkt.verifyAgentCard(id, 1);
        AgentCardView memory v = mkt.getAgentCard(id);
        AgentCard memory expected = _card();
        expected.provider = provider;
        expected.active = true;
        assertEq(abi.encode(v.card), abi.encode(expected), "card");
        assertEq(v.rules, abi.encode(_rules()));
        assertEq(v.jobSpecTemplate, abi.encode(_lendingTemplate()));
        assertEq(v.version, 1);
        assertTrue(v.verified);
        assertFalse(v.disabled);

        AgentCardView memory none = mkt.getAgentCard(999);
        AgentCardView memory zero;
        assertEq(abi.encode(none), abi.encode(zero), "an unknown card reads all zero");
    }

    function test_MV02_computeCEA() public {
        address agw = makeAddr("anyAGW");
        assertEq(mkt.computeCEA(agw, SEPOLIA_HASH), ceaFactory.computeCEA(agw));
        (address cea,) = ceaFactory.getCEAForPushAccount(agw);
        assertEq(mkt.computeCEA(agw, SEPOLIA_HASH), cea);
        vm.expectRevert(
            abi.encodeWithSelector(UniversalMarketplaceErrors.ChainNotSupported.selector, bytes32(uint256(1)))
        );
        mkt.computeCEA(agw, bytes32(uint256(1)));
    }

    /// @dev After a destination implementation rotation, the stale config is refused until updated; the runbook is
    ///      `pause()` → rotate → `setCEADeployment` → `unpause()`.
    function test_MV03_ceaRotation_staleCaught() public {
        uint256 id = _registerLending();
        OpenJobParams memory signedBefore = _ready(id);
        address newImpl = makeAddr("ceaProxyImplV2");
        vm.prank(admin);
        ceaFactory.setCEAProxyImplementation(newImpl);

        // not paused: an SDK reading the destination factory signs the NEW CEA, into the wallet pin and the
        // expected CEA; the marketplace still derives the old one, and the pin (C12) is the first to differ
        JobInputs memory job = _inputs(PRINCIPAL);
        address agw = signedBefore.intent.wallet;
        Session memory s = _sessionOf(_fillTerms(_rules(), PRINCIPAL, job.expiredAt, ceaFactory.computeCEA(agw)));
        assertTrue(ceaFactory.computeCEA(agw) != mkt.computeCEA(agw, SEPOLIA_HASH), "stale");
        _expectOpen(_params(id, 0, job, s), abi.encodeWithSelector(UniversalMarketplaceErrors.PinMismatch.selector, 1, 0));

        // the runbook
        vm.prank(admin);
        mkt.pause();
        _expectOpen(signedBefore, abi.encodeWithSelector(PausableUpgradeable.EnforcedPause.selector));
        vm.prank(admin);
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), newImpl);
        vm.prank(admin);
        mkt.unpause();
        assertEq(mkt.computeCEA(agw, SEPOLIA_HASH), ceaFactory.computeCEA(agw), "fresh");
        // an intent signed before the rotation names the old CEA in its criteria: refused
        _expectOpen(
            signedBefore,
            abi.encodeWithSelector(UniversalMarketplaceErrors.IntentExecMismatch.selector, _calldataHash(id, 0, job))
        );
        _open(_ready(id)); // re-signed: the criteria's CEA moved too
    }

    function test_MV04_buildCreateJobCalldata() public {
        uint256 id = _registerSwap();
        JobInputs memory job = _swapInputs(0.5e18);
        (bytes32 mode, bytes memory cd) = mkt.buildCreateJobCalldata(id, user, 0, job);
        (address agw,) = factory.predictWallet(user, 0);
        assertEq(mode, bytes32(0));
        bytes memory call = abi.encodeCall(
            IAgenticCommerce.createJob,
            (
                provider,
                universalEvaluator,
                uint256(job.expiredAt),
                string(_expectedDescription(_swapTemplate(), id, 1, agw, job)),
                address(hook)
            )
        );
        assertEq(cd, abi.encodePacked(address(kernel), uint256(0), call));

        bytes32 base = keccak256(cd);
        JobInputs memory j = _swapInputs(0.5e18);
        j.principal += 1;
        assertTrue(_calldataHash(id, 0, j) != base, "principal");
        j = _swapInputs(0.5e18);
        j.executeBy += 1;
        assertTrue(_calldataHash(id, 0, j) != base, "executeBy");
        j = _swapInputs(0.5e18);
        j.expiredAt += 1;
        assertTrue(_calldataHash(id, 0, j) != base, "expiredAt");
        assertTrue(_calldataHash(id, 0, _swapInputs(0.5e18 + 1)) != base, "params");
        assertTrue(_calldataHash(id, 1, job) != base, "index");
        (, bytes memory otherOwner) = mkt.buildCreateJobCalldata(id, stranger, 0, job);
        assertTrue(keccak256(otherOwner) != base, "owner");
        _update(id, _card(), _rules(), _swapTemplate());
        assertTrue(_calldataHash(id, 0, job) != base, "card version");

        // what openJob executes is exactly this view's answer
        OpenJobParams memory p = _readyAt(id, 0, _rules(), job);
        (, address opened) = _open(p);
        assertEq(MockAGW(payable(opened)).lastExecCalldataHash(), _calldataHash(id, 0, job));

        vm.expectRevert(UniversalMarketplaceErrors.AgentCardInactive.selector);
        mkt.buildCreateJobCalldata(999, user, 0, job);
    }

    function test_MV05_previewIntent_roundTrips() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        OwnerIntent memory i = p.intent;
        (address agw,) = factory.predictWallet(user, 0);
        assertEq(i.owner, user);
        assertEq(i.wallet, agw);
        assertEq(i.executor, address(mkt));
        assertEq(i.index, 0);
        assertEq(i.sessionHash, keccak256(abi.encode(p.session)));
        assertEq(i.mode, bytes32(0));
        assertEq(i.execCalldataHash, _calldataHash(id, 0, p.job));
        assertEq(i.nonceKey, OWNER_LANE_FLAG);
        assertEq(i.nonceSeq, 0, "fresh wallet");
        assertEq(i.grantNonce, 0, "fresh wallet");
        assertEq(i.deadline, uint48(block.timestamp + 1 hours));
        assertEq(i.signerChainId, 1);
        (uint256 jobId,) = _open(p);

        vm.prank(provider);
        kernel.reject(jobId, bytes32(0), "");
        OwnerIntent memory again = _readyAt(id, 0, _rules(), _inputs(PRINCIPAL)).intent;
        assertEq(again.nonceSeq, 1, "deployed: the live lane");
        assertEq(again.grantNonce, 1, "deployed: the live grant nonce");

        _expectPreviewUnknownCard();
    }

    function _expectPreviewUnknownCard() internal {
        Session memory s;
        IntentRequest memory r =
            IntentRequest({cardId: 999, owner: user, index: 0, job: _inputs(PRINCIPAL), deadline: 0, signerChainId: 1});
        vm.expectRevert(UniversalMarketplaceErrors.AgentCardInactive.selector);
        mkt.previewIntent(r, s);
    }

    function test_MV06_adminSetters() public {
        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.setHook(address(hook));
        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setHook(address(0));
        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.HookNotWhitelisted.selector);
        mkt.setHook(stranger);
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.HookUpdated(address(hook));
        vm.prank(admin);
        mkt.setHook(address(hook));

        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.setEvaluator(stranger);
        vm.prank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setEvaluator(address(0));
        address next = makeAddr("evaluatorV2");
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.EvaluatorUpdated(next);
        vm.prank(admin);
        mkt.setEvaluator(next);
        assertEq(mkt.evaluator(), next);

        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), ceaProxyImpl);
        vm.startPrank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setCEADeployment(SEPOLIA_HASH, address(0), ceaProxyImpl);
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), address(0));
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.CEADeploymentSet(SEPOLIA_HASH, address(ceaFactory), ceaProxyImpl);
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), ceaProxyImpl);
        vm.stopPrank();
        (address f, address impl) = mkt.ceaDeployment(SEPOLIA_HASH);
        assertEq(f, address(ceaFactory));
        assertEq(impl, ceaProxyImpl);
    }

    function test_MV07_pause() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id);
        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.pause();
        vm.prank(admin);
        mkt.pause();

        _expectOpen(p, abi.encodeWithSelector(PausableUpgradeable.EnforcedPause.selector));
        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider2);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        mkt.registerAgentCard(c, r, e);
        vm.prank(provider);
        vm.expectRevert(PausableUpgradeable.EnforcedPause.selector);
        mkt.updateAgentCard(id, c, r, e);

        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.unpause();
        vm.prank(admin);
        mkt.unpause();
        _open(p);
    }

    function _expectInitRevert(InitParams memory ip, bytes4 err) internal {
        address impl = address(new UniversalMarketplace());
        vm.expectRevert(err);
        new TransparentUpgradeableProxy(impl, mktAdmin, abi.encodeCall(UniversalMarketplace.initialize, (ip)));
    }

    function test_MV08_initialize() public {
        bytes4 zero = UniversalMarketplaceErrors.ZeroAddress.selector;
        InitParams memory ip = _initParams();
        ip.agwFactory = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.kernel = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.hook = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.evaluator = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.rules = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.admin = address(0);
        _expectInitRevert(ip, zero);
        ip = _initParams();
        ip.hook = stranger;
        _expectInitRevert(ip, UniversalMarketplaceErrors.HookNotWhitelisted.selector);

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        mkt.initialize(_initParams());
        UniversalMarketplace impl = new UniversalMarketplace();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(_initParams());

        assertEq(address(mkt.AGW_FACTORY()), address(factory));
        assertEq(address(mkt.KERNEL()), address(kernel));
        assertEq(mkt.hook(), address(hook));
        assertEq(mkt.evaluator(), universalEvaluator);
        assertEq(address(mkt.RULES()), address(rulesHelper));
        assertTrue(mkt.hasRole(mkt.ADMIN_ROLE(), admin));
        assertTrue(mkt.hasRole(mkt.DEFAULT_ADMIN_ROLE(), admin));
    }

    /// ⚠️ NEVER-DELETE. Every slot of the layout (PRD 12 Appendix C) is pinned by position after an exercise that
    ///    writes every variable, so an insertion, reorder or forgotten gap decrement fails here instead of on the
    ///    first upgrade. Append-only: extend this test, never loosen it.
    function test_MV09_storageLayout_bySlot() public {
        uint256 id = _registerLending();
        uint256 id2 = _registerAs(provider2, _card(), _rules(), _lendingTemplate());
        (uint256 jobId, address agw) = _open(_ready(id));
        _update(id, _card(), _rules(), _lendingTemplate()); // version 2
        vm.startPrank(admin);
        mkt.verifyAgentCard(id, 2);
        mkt.disableAgentCard(id2);
        mkt.setAgentRating(provider, 77);
        mkt.pause(); // the old per-chain pause's slot stays unwritten by every path
        mkt.unpause();
        vm.stopPrank();

        address m = address(mkt);
        assertEq(_word(m, 0), uint256(uint160(address(factory))), "0 AGW_FACTORY");
        assertEq(_word(m, 1), uint256(uint160(address(kernel))), "1 KERNEL");
        assertEq(_word(m, 2), uint256(uint160(address(hook))), "2 hook");
        assertEq(_word(m, 3), uint256(uint160(universalEvaluator)), "3 evaluator");
        assertEq(vm.load(m, bytes32(uint256(4))), mkt.PUSH_CHAIN_HASH(), "4 PUSH_CHAIN_HASH");
        assertEq(_word(m, 5), uint256(uint160(address(rulesHelper))), "5 RULES");
        assertEq(_word(m, 6), 2, "6 agentCardCount");

        // mappings: the entry lives at keccak256(key ‖ slot); a long `bytes` stores 2·length + 1
        assertEq(_entry(m, id, 7), uint256(uint160(provider)), "7 _cards[id].provider");
        assertEq(_entry(m, id, 8), abi.encode(_rules()).length * 2 + 1, "8 _agentCardRules");
        assertEq(_entry(m, id, 9), abi.encode(_lendingTemplate()).length * 2 + 1, "9 _jobSpecTemplates");
        assertEq(_entry(m, id, 10), 2, "10 agentCardVersion");
        assertEq(_entry(m, id2, 10), 1, "10 agentCardVersion (not updated)");
        assertEq(_entry(m, id, 11), 1, "11 isAgentCardVerified");
        assertEq(_entry(m, id2, 12), 1, "12 isAgentCardDisabled");
        assertEq(
            uint256(vm.load(m, keccak256(abi.encode(SEPOLIA_HASH, uint256(13))))),
            uint256(uint160(address(ceaFactory))),
            "13 ceaDeployment.ceaFactory"
        );
        assertEq(_word(m, 14), 0, "14 __reserved14");
        assertEq(uint256(vm.load(m, keccak256(abi.encode(SEPOLIA_HASH, uint256(14))))), 0, "14 never a mapping");
        assertEq(_addrEntry(m, agw, 15), jobId, "15 _lastJobOf");
        assertEq(_entry(m, jobId, 16), id, "16 cardOfJob");
        assertEq(_entry(m, jobId, 17), uint256(uint160(agw)), "17 agwOfJob");
        assertEq(
            vm.load(m, keccak256(abi.encode(jobId, uint256(18)))), MockAGW(payable(agw)).RULES_ID(), "18 rulesOfJob"
        );
        assertEq(_addrEntry(m, provider, 19), id, "19 agentCardOf");
        assertEq(_addrEntry(m, provider2, 19), id2, "19 agentCardOf (second provider)");
        assertEq(_entry(m, jobId, 20), 1, "20 cardVersionOfJob");
        assertEq(_addrEntry(m, provider, 21), 77, "21 _agentRating");
        for (uint256 slot = 7; slot <= 21; ++slot) {
            assertEq(_word(m, slot), 0, "a mapping's base slot (or slot 14) is never written");
        }
        for (uint256 slot = 22; slot <= 49; ++slot) {
            assertEq(_word(m, slot), 0, "gap (22-48) or slot 49 written");
        }
    }

    function _word(address m, uint256 slot) internal view returns (uint256) {
        return uint256(vm.load(m, bytes32(slot)));
    }

    function _entry(address m, uint256 key, uint256 slot) internal view returns (uint256) {
        return uint256(vm.load(m, keccak256(abi.encode(key, slot))));
    }

    function _addrEntry(address m, address key, uint256 slot) internal view returns (uint256) {
        return uint256(vm.load(m, keccak256(abi.encode(key, slot))));
    }

    function test_MV10_upgrade_preservesState() public {
        uint256 id = _registerLending();
        (uint256 jobId, address agw) = _open(_ready(id));
        _update(id, _card(), _rules(), _lendingTemplate());
        vm.prank(admin);
        mkt.setAgentRating(provider, 5);
        bytes memory viewBefore = abi.encode(mkt.getAgentCard(id));

        UniversalMarketplace next = new UniversalMarketplace();
        vm.prank(mktAdmin);
        ProxyAdmin(_proxyAdmin(address(mkt)))
            .upgradeAndCall(ITransparentUpgradeableProxy(address(mkt)), address(next), "");
        assertEq(address(uint160(uint256(vm.load(address(mkt), ERC1967Utils.IMPLEMENTATION_SLOT)))), address(next));

        assertEq(abi.encode(mkt.getAgentCard(id)), viewBefore, "card, blobs, version and tags intact");
        assertEq(mkt.agentCardCount(), 1);
        assertEq(mkt.agentCardOf(provider), id);
        assertEq(mkt.activeJobOf(agw), jobId);
        assertEq(mkt.cardOfJob(jobId), id);
        assertEq(mkt.agwOfJob(jobId), agw);
        assertEq(mkt.rulesOfJob(jobId), MockAGW(payable(agw)).RULES_ID());
        assertEq(mkt.cardVersionOfJob(jobId), 1);
        assertEq(mkt.getAgentRating(provider), 5);
        assertEq(mkt.evaluator(), universalEvaluator);
        _open(_ready(id)); // and it still opens jobs
    }

    function test_MV11_setCEADeployment_clear() public {
        uint256 id = _registerLending();
        OpenJobParams memory p = _ready(id); // signed before the chain is cleared
        address agw = p.intent.wallet;

        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.CEADeploymentSet(SEPOLIA_HASH, address(0), address(0));
        vm.prank(admin);
        mkt.setCEADeployment(SEPOLIA_HASH, address(0), address(0));
        (address f, address impl) = mkt.ceaDeployment(SEPOLIA_HASH);
        assertEq(f, address(0));
        assertEq(impl, address(0));

        bytes memory unsupported =
            abi.encodeWithSelector(UniversalMarketplaceErrors.ChainNotSupported.selector, SEPOLIA_HASH);
        vm.expectRevert(unsupported);
        mkt.computeCEA(agw, SEPOLIA_HASH);

        AgentCard memory c = _card();
        bytes memory r = abi.encode(_rules());
        bytes memory e = abi.encode(_lendingTemplate());
        vm.prank(provider2);
        vm.expectRevert(unsupported);
        mkt.registerAgentCard(c, r, e);

        _expectOpen(p, unsupported);

        vm.startPrank(admin);
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setCEADeployment(SEPOLIA_HASH, address(ceaFactory), address(0));
        vm.expectRevert(UniversalMarketplaceErrors.ZeroAddress.selector);
        mkt.setCEADeployment(SEPOLIA_HASH, address(0), ceaProxyImpl);
        vm.stopPrank();
    }

    function test_MV12_agentRating() public {
        assertEq(mkt.getAgentRating(provider), 0, "default");
        vm.expectEmit(address(mkt));
        emit IUniversalMarketplace.AgentRatingSet(provider, 42);
        vm.prank(admin);
        mkt.setAgentRating(provider, 42);
        assertEq(mkt.getAgentRating(provider), 42);
        assertEq(mkt.getAgentRating(provider2), 0, "per agent");

        vm.prank(stranger);
        vm.expectRevert(_adminRevert(stranger));
        mkt.setAgentRating(provider, 1);
        assertEq(mkt.getAgentRating(provider), 42);
    }

    function test_MV13_version() public view {
        assertEq(mkt.version(), "2.0.0");
        assertEq(mkt.OPENJOB_LANE(), OWNER_LANE_FLAG);
        assertEq(mkt.MODE_SINGLE(), bytes32(0));
    }

    function test_MV14_noPerChainPause() public view {
        string memory json = vm.readFile("out/UniversalMarketplace.sol/UniversalMarketplace.json");
        string memory abiSection = vm.split(json, '"bytecode"')[0];
        assertEq(vm.indexOf(abiSection, "setUniversalPaused"), type(uint256).max, "setUniversalPaused");
        assertEq(vm.indexOf(abiSection, "isUniversalPaused"), type(uint256).max, "isUniversalPaused");
        assertEq(vm.indexOf(abiSection, "UniversalChainPaused"), type(uint256).max, "UniversalChainPaused");
        assertTrue(vm.indexOf(abiSection, "openJob") != type(uint256).max, "the artifact is the new one");
    }
}
