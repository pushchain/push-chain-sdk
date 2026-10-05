// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { UniversalRulesPolicyErrors } from "../../src/libraries/Errors.sol";

import { BaseTest } from "../Base.t.sol";
import { AGW } from "../../src/AGW.sol";
import { IUniversalRulesPolicy } from "../../src/interfaces/IUniversalRulesPolicy.sol";
import { AllowedCall, AssetCapState, Config, MAX_ASSETS, Multicall, OwnerIntent } from "../../src/libraries/Types.sol";
import { ModeLib, ModeCode } from "../../src/libraries/ModeLib.sol";
import { ExecutionLib } from "../../src/libraries/ExecutionLib.sol";
import { ConfigId, Session } from "smartsessions/DataTypes.sol";
import { ISmartSession } from "smartsessions/ISmartSession.sol";
import { MockPRC20 } from "../mocks/MockUniversalGateway.sol";
import { MockPRC20Source } from "../mocks/MockPRC20Source.sol";

/**
 * @title  MultiAssetTest — one UNIVERSAL rules set, several tokens (the multi-asset branch)
 * @notice A rules set lists 1..MAX_ASSETS PRC20s, each with its own per-call cap, lifetime cap and
 *         spend counter. These tests pin the three properties the change must not lose:
 *         - THE CHAIN STAYS PINNED. The gateway routes by `req.token`, so every listed token is
 *           chain-checked at grant and every request's token must be listed — zero amount included.
 *           An empty list is refused for the same reason.
 *         - TOKENS ARE ISOLATED. One token's spend, cap, credit or exhaustion never touches another's.
 *         - "TOTAL" IS GROSS. A lifetime cap counts what was sent out; money coming back to the wallet
 *           never restores room (only `creditRevert` lowers a counter).
 */
contract MultiAssetTest is BaseTest {
    bytes4 internal constant SWAP_SELECTOR = bytes4(keccak256("swap(uint256,address)"));
    uint16 internal constant BENEFICIARY_OFFSET = 36;
    ConfigId internal constant CID = ConfigId.wrap(bytes32(uint256(0xA55E7)));
    uint48 internal constant VALID_UNTIL = 2_000_000_000;

    string internal constant CHAIN_ARBITRUM_SEPOLIA = "eip155:421614";

    address internal account;
    address internal cea;
    address internal protocol;

    /// @dev Two Sepolia PRC20s (the defaults of `MockPRC20`) and one PRC20 of ANOTHER chain.
    address internal usdc;
    address internal usdt;
    address internal arbUsdc;

    function setUp() public override {
        super.setUp();
        account = makeAddr("agentWallet");
        cea = makeAddr("destinationAccount");
        protocol = makeAddr("farChainProtocol");
        usdc = address(new MockPRC20());
        usdt = address(new MockPRC20());
        arbUsdc = address(new MockPRC20Source(CHAIN_ARBITRUM_SEPOLIA));
        vm.warp(1_000_000_000);
    }

    // ───────────────────────────── builders ─────────────────────────────

    function _rules() internal view returns (AllowedCall[] memory r) {
        r = new AllowedCall[](1);
        r[0] = AllowedCall({
            target: protocol,
            selector: SWAP_SELECTOR,
            beneficiaryOffset: BENEFICIARY_OFFSET,
            hasBeneficiary: true,
            maxValue: 0
        });
    }

    /// @dev The confirmed example: "on Ethereum, move 1000 USDC and 500 USDT". USDC 100/1000, USDT 50/500.
    function _two() internal view returns (AssetCapState[] memory a) {
        a = new AssetCapState[](2);
        a[0] = AssetCapState({ token: usdc, maxPerCall: 100e6, maxTotal: 1000e6, spent: 0 });
        a[1] = AssetCapState({ token: usdt, maxPerCall: 50e6, maxTotal: 500e6, spent: 0 });
    }

    function _config(AssetCapState[] memory assets) internal view returns (Config memory) {
        return Config({
            initialized: false,
            validUntil: VALID_UNTIL,
            expectedCEA: cea,
            maxGasPerCall: 5 ether,
            assets: assets,
            allowedCalls: _rules()
        });
    }

    function _init(AssetCapState[] memory assets) internal {
        _initAt(CID, assets);
    }

    function _initAt(ConfigId id, AssetCapState[] memory assets) internal {
        vm.prank(address(engine));
        urp.initializeWithMultiplexer(account, id, universalInitData(_config(assets)));
    }

    function _initReverts(bytes memory err, AssetCapState[] memory assets) internal {
        vm.prank(address(engine));
        vm.expectRevert(err);
        urp.initializeWithMultiplexer(account, CID, universalInitData(_config(assets)));
    }

    function _calls() internal view returns (Multicall[] memory c) {
        c = new Multicall[](1);
        c[0] = Multicall({ to: protocol, value: 0, data: abi.encodeWithSelector(SWAP_SELECTOR, uint256(1), cea) });
    }

    function _req(address token, uint256 amount) internal view returns (bytes memory) {
        return outboundRequest(token, amount, 1 ether, account, _calls());
    }

    function _check(address token, uint256 amount) internal {
        vm.prank(address(engine));
        urp.checkAction(CID, account, GATEWAY, 0, _req(token, amount));
    }

    function _checkReverts(bytes memory err, address token, uint256 amount) internal {
        vm.prank(address(engine));
        vm.expectRevert(err);
        urp.checkAction(CID, account, GATEWAY, 0, _req(token, amount));
    }

    function _spent(uint256 i) internal view returns (uint256) {
        return urp.getConfig(CID, account).assets[i].spent;
    }

    function _spentPair(uint256 a, uint256 b) internal pure returns (uint256[] memory s) {
        s = new uint256[](2);
        s[0] = a;
        s[1] = b;
    }

    /// @dev `n` distinct Sepolia PRC20s, each 1/1 capped.
    function _many(uint256 n) internal returns (AssetCapState[] memory a) {
        a = new AssetCapState[](n);
        for (uint256 i; i < n; ++i) {
            a[i] = AssetCapState({ token: address(new MockPRC20()), maxPerCall: 1, maxTotal: 1, spent: 0 });
        }
    }

    // ═══════════════════════════════ grant time ═══════════════════════════════

    function test_MA01_twoAssetsStoredInOrderWithZeroSpent() public {
        _init(_two());
        Config memory got = urp.getConfig(CID, account);
        assertEq(got.assets.length, 2, "two entries");
        assertEq(got.assets[0].token, usdc, "order kept: USDC first");
        assertEq(got.assets[0].maxPerCall, 100e6, "USDC per-call");
        assertEq(got.assets[0].maxTotal, 1000e6, "USDC total");
        assertEq(got.assets[1].token, usdt, "USDT second");
        assertEq(got.assets[1].maxPerCall, 50e6, "USDT per-call");
        assertEq(got.assets[1].maxTotal, 500e6, "USDT total");
        assertEq(got.assets[0].spent + got.assets[1].spent, 0, "every counter starts at zero");
        assertEq(got.maxGasPerCall, 5 ether, "maxGasPerCall stored");
    }

    /**
     * ⚠️ NEVER-DELETE. The token is what the gateway routes by, so a rules set with no token pins no
     * chain. §4c's "empty = call contracts, move nothing" is refused; move-nothing is one entry with
     * a zero `maxPerCall` (MA11).
     */
    function test_MA02_emptyAssetListRefused() public {
        _initReverts(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetListOutOfRange.selector, uint256(0)),
            new AssetCapState[](0)
        );
    }

    function test_MA03_listBoundIsMaxAssets() public {
        assertEq(MAX_ASSETS, 8, "the bound the SDK encodes against");
        _init(_many(MAX_ASSETS));
        assertEq(urp.getConfig(CID, account).assets.length, MAX_ASSETS, "eight accepted");

        AssetCapState[] memory nine = _many(MAX_ASSETS + 1);
        vm.prank(address(engine));
        vm.expectRevert(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetListOutOfRange.selector, MAX_ASSETS + 1));
        urp.initializeWithMultiplexer(account, ConfigId.wrap(bytes32(uint256(2))), universalInitData(_config(nine)));
    }

    /// The duplicate is NOT adjacent: the check compares every pair, not neighbours.
    function test_MA04_duplicateTokenRefused() public {
        AssetCapState[] memory a = new AssetCapState[](3);
        a[0] = AssetCapState({ token: usdc, maxPerCall: 1, maxTotal: 1, spent: 0 });
        a[1] = AssetCapState({ token: usdt, maxPerCall: 1, maxTotal: 1, spent: 0 });
        a[2] = AssetCapState({ token: usdc, maxPerCall: 9, maxTotal: 9, spent: 0 });
        _initReverts(abi.encodeWithSelector(UniversalRulesPolicyErrors.DuplicateAsset.selector, usdc), a);
    }

    /**
     * ⚠️ NEVER-DELETE. Every listed token is chain-checked, not just the first: a Sepolia rules set
     * whose SECOND token is an Arbitrum PRC20 would let the agent route to Arbitrum by naming it.
     */
    function test_MA05_everyTokenIsChainChecked() public {
        AssetCapState[] memory a = _two();
        a[1].token = arbUsdc;
        _initReverts(
            abi.encodeWithSelector(
                UniversalRulesPolicyErrors.ChainMismatch.selector,
                keccak256(bytes(CHAIN_SEPOLIA)),
                keccak256(bytes(CHAIN_ARBITRUM_SEPOLIA))
            ),
            a
        );
    }

    function test_MA06_codelessOrZeroTokenRefusedAtAnyPosition() public {
        address codeless = makeAddr("typoedToken");
        AssetCapState[] memory a = _two();
        a[1].token = codeless;
        _initReverts(abi.encodeWithSelector(UniversalRulesPolicyErrors.InvalidAsset.selector, codeless), a);

        a = _two();
        a[1].token = address(0);
        _initReverts(abi.encodeWithSelector(UniversalRulesPolicyErrors.InvalidAsset.selector, address(0)), a);
    }

    // ═══════════════════════════════ check time ═══════════════════════════════

    /**
     * ⚠️ NEVER-DELETE. THE CHAIN-ESCAPE GUARD. A zero-amount request moves nothing, but its token
     * still decides the destination chain. If gate 5 ran only for "the token being moved" (§4c's
     * wording), an agent could send the rules set's calls to Arbitrum by naming an Arbitrum token
     * with amount 0.
     */
    function test_MA07_unlistedTokenRefusedEvenAtZeroAmount() public {
        _init(_two());
        _checkReverts(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, arbUsdc), arbUsdc, 0);

        // An unlisted token of the RIGHT chain is refused too: the list is the owner's statement.
        address otherSepolia = address(new MockPRC20());
        _checkReverts(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, otherSepolia), otherSepolia, 0
        );

        // A listed token at amount 0 passes and writes nothing.
        vm.recordLogs();
        _check(usdt, 0);
        assertEq(vm.getRecordedLogs().length, 0, "no OutboundMetered for a zero-amount request");
        assertEq(_spent(1), 0, "nothing metered");
    }

    function test_MA08_eachTokenIsMeteredOnItsOwnCounter() public {
        _init(_two());

        vm.expectEmit(true, true, true, true, address(urp));
        emit IUniversalRulesPolicy.OutboundMetered(CID, address(engine), account, usdc, 60e6);
        _check(usdc, 60e6);

        vm.expectEmit(true, true, true, true, address(urp));
        emit IUniversalRulesPolicy.OutboundMetered(CID, address(engine), account, usdt, 30e6);
        _check(usdt, 30e6);

        _check(usdc, 40e6);

        assertEq(_spent(0), 100e6, "USDC counter: 60 + 40");
        assertEq(_spent(1), 30e6, "USDT counter: 30, untouched by USDC");
    }

    function test_MA09_perCallCapIsTheMatchedTokens() public {
        _init(_two());
        // 51 is within USDC's per-call cap (100) and above USDT's (50).
        _check(usdc, 51e6);
        _checkReverts(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AmountExceedsCap.selector, uint256(51e6), uint256(50e6)),
            usdt,
            51e6
        );
    }

    function test_MA10_exhaustingOneTokenLeavesTheOthersUsable() public {
        _init(_two());
        for (uint256 i; i < 10; ++i) {
            _check(usdc, 100e6);
        }
        _checkReverts(
            abi.encodeWithSelector(
                UniversalRulesPolicyErrors.TotalSpendCapExceeded.selector, uint256(1000e6 + 1), uint256(1000e6)
            ),
            usdc,
            1
        );
        _check(usdt, 50e6);
        assertEq(_spent(1), 50e6, "USDT still spends after USDC is exhausted");
    }

    /// Move-nothing: the token pins the chain, the zero per-call cap forbids moving it.
    function test_MA11_zeroPerCallTokenRoutesButNeverMoves() public {
        AssetCapState[] memory a = new AssetCapState[](1);
        a[0] = AssetCapState({ token: usdc, maxPerCall: 0, maxTotal: 0, spent: 0 });
        _init(a);

        _check(usdc, 0);
        _checkReverts(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AmountExceedsCap.selector, uint256(1), uint256(0)),
            usdc,
            1
        );
    }

    /// Unlimited is `type(uint256).max`, with no special branch; a zero total means NOTHING moves.
    function test_MA12_unlimitedIsMaxUintAndZeroTotalMovesNothing() public {
        AssetCapState[] memory a = new AssetCapState[](2);
        a[0] = AssetCapState({ token: usdc, maxPerCall: type(uint256).max, maxTotal: type(uint256).max, spent: 0 });
        a[1] = AssetCapState({ token: usdt, maxPerCall: 100e6, maxTotal: 0, spent: 0 });
        _init(a);

        _check(usdc, 1e30);
        assertEq(_spent(0), 1e30, "unlimited really is unlimited");

        _checkReverts(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.TotalSpendCapExceeded.selector, uint256(1), uint256(0)),
            usdt,
            1
        );
    }

    /**
     * The bridge-back edge case raised in review: limit 1000, agent sends 600, 300 comes back to the wallet. The agent has
     * 400 left, not 700. URP never sees inflows; it could not tell an agent's return from the
     * owner's top-up, and counting inflows would let any deposit raise the agent's limit.
     */
    function test_MA13_moneyComingBackDoesNotRestoreRoom() public {
        AssetCapState[] memory a = new AssetCapState[](1);
        a[0] = AssetCapState({ token: usdc, maxPerCall: 1000e6, maxTotal: 1000e6, spent: 0 });
        _init(a);

        _check(usdc, 600e6);
        MockPRC20(usdc).mint(account, 300e6); // the 300 coming back, landing on the wallet
        assertEq(_spent(0), 600e6, "an inflow changes nothing");

        _checkReverts(
            abi.encodeWithSelector(
                UniversalRulesPolicyErrors.TotalSpendCapExceeded.selector, uint256(1001e6), uint256(1000e6)
            ),
            usdc,
            401e6
        );
        _check(usdc, 400e6);
    }

    // ═══════════════════════════ assertSpent / creditRevert ═══════════════════════════

    function test_MA14_assertSpentIsExactPerAsset() public {
        _init(_two());
        _check(usdc, 70e6);
        _check(usdt, 20e6);

        urp.assertSpent(CID, account, _spentPair(70e6, 20e6));

        vm.expectRevert(
            abi.encodeWithSelector(
                UniversalRulesPolicyErrors.AssetSpentMismatch.selector, usdt, uint256(21e6), uint256(20e6)
            )
        );
        urp.assertSpent(CID, account, _spentPair(70e6, 21e6));

        // A prefix is not accepted: one entry per listed asset, exactly.
        vm.expectRevert(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.SpentLengthMismatch.selector, uint256(2), uint256(1))
        );
        urp.assertSpent(CID, account, oneSpent(70e6));

        uint256[] memory three = new uint256[](3);
        vm.expectRevert(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.SpentLengthMismatch.selector, uint256(2), uint256(3))
        );
        urp.assertSpent(CID, account, three);
    }

    function test_MA15_creditRevertTouchesOnlyItsToken() public {
        _init(_two());
        _check(usdc, 100e6);
        _check(usdt, 50e6);

        bytes32 txId = keccak256("failed-USDT-outbound");

        // An unlisted token is refused; the revert leaves the id uncredited, so the credit stays retryable.
        vm.prank(EXECUTOR_MODULE);
        vm.expectRevert(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, arbUsdc));
        urp.creditRevert(CID, account, txId, arbUsdc, 20e6);
        assertFalse(urp.isCredited(txId), "a misrouted credit does not burn the id");

        vm.expectEmit(true, true, true, true, address(urp));
        emit IUniversalRulesPolicy.RevertCredited(txId, CID, account, usdt, 20e6);
        vm.prank(EXECUTOR_MODULE);
        urp.creditRevert(CID, account, txId, usdt, 20e6);

        assertEq(_spent(1), 30e6, "USDT credited");
        assertEq(_spent(0), 100e6, "USDC untouched");

        // Precedence: the token is resolved before the idempotency check, so an already-credited id
        // sent with an unlisted token reports the token, not `AlreadyCredited`.
        vm.prank(EXECUTOR_MODULE);
        vm.expectRevert(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, arbUsdc));
        urp.creditRevert(CID, account, txId, arbUsdc, 1);
    }

    /// Per-token isolation under arbitrary amounts: spending one token never moves another's counter.
    function testFuzz_MA16_perTokenIsolation(uint256 a, uint256 b) public {
        a = bound(a, 0, 100e6);
        b = bound(b, 0, 50e6);
        _init(_two());

        _check(usdc, a);
        assertEq(_spent(1), 0, "USDT untouched by a USDC spend");
        _check(usdt, b);
        assertEq(_spent(0), a, "USDC untouched by a USDT spend");
        assertEq(_spent(1), b, "USDT exact");
    }

    // ═══════════════════════════ through the wallet ═══════════════════════════

    /// The point of the change: ONE rulesId moves two tokens, through the real engine path.
    function test_MA17_oneRulesIdMovesTwoTokensThroughTheWallet() public {
        (address agent,) = ecdsaKey("multiAssetAgent");
        address owner = makeAddr("multiAssetOwner");
        AGW wallet = newWallet(owner);
        cea = makeAddr("walletCea");

        Config memory cfg = _config(_two());
        vm.prank(owner);
        bytes32 rulesId = wallet.grantRules(canonicalSession(agentConfig(agent), universalInitData(cfg)));

        etchCallRecorder(GATEWAY);
        bytes32 mode = ModeCode.unwrap(ModeLib.encodeSimpleSingle());
        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, usdc, 80e6));
        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, usdt, 40e6));

        ConfigId cid = _walletConfigId(wallet, rulesId);
        Config memory got = urp.getConfig(cid, address(wallet));
        assertEq(got.assets[0].spent, 80e6, "USDC metered under the one rulesId");
        assertEq(got.assets[1].spent, 40e6, "USDT metered under the same rulesId");

        // An unlisted token through the wallet dies at gate 5, named through the engine.
        expectUrpGate(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, arbUsdc));
        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, arbUsdc, 0));
    }

    function _walletEcd(AGW wallet, address token, uint256 amount) internal view returns (bytes memory) {
        return ExecutionLib.encodeSingle(GATEWAY, 0, outboundRequest(token, amount, 1 ether, address(wallet), _calls()));
    }

    function _walletConfigId(AGW wallet, bytes32 rulesId) internal view returns (ConfigId) {
        bytes32 actionId = keccak256(abi.encodePacked(GATEWAY, SEND_OUTBOUND_SELECTOR));
        bytes32 actionPolicyId = keccak256(abi.encodePacked(rulesId, actionId));
        return ConfigId.wrap(keccak256(abi.encodePacked(address(wallet), actionPolicyId)));
    }

    // ═══════════════════ C1: every rule lists at least one token ═══════════════════

    /**
     * ⚠️ NEVER-DELETE. C1: A CROSS-CHAIN RULE MUST LIST AT LEAST ONE TOKEN.
     *
     * The gateway picks the destination chain from the request's token alone; the request has no
     * chain field. A rule with no token therefore pins no chain, and an agent could run its calls on
     * any chain by naming that chain's token at amount 0. URP refuses the empty list at grant
     * (`AssetListOutOfRange(0)`); this pins that EVERY grant path reaches that refusal:
     *   1. `grantRules`;
     *   2. `grantRulesWithSig`, a relayer presenting the owner's signed intent;
     *   3. the owner door enabling the session on the engine directly, bypassing `grantRules`.
     * The revert unwinds everything: the grant nonce and the checkpoint counter do not move.
     */
    function test_MA19_ruleWithNoTokenRefusedOnEveryGrantPath() public {
        (address owner, uint256 ownerPk) = ecdsaKey("noTokenOwner");
        address relayer = makeAddr("noTokenRelayer");
        AGW wallet = newWallet(owner);
        Session memory s =
            canonicalSession(agentConfig(makeAddr("noTokenAgent")), universalInitData(_config(new AssetCapState[](0))));
        bytes memory refused =
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetListOutOfRange.selector, uint256(0));
        uint64 grantNonceBefore = wallet.grantNonce();
        uint64 checkpointsBefore = wallet.checkpointCount();

        // 1. grantRules
        vm.prank(owner);
        vm.expectRevert(refused);
        wallet.grantRules(s);

        // 2. grantRulesWithSig
        OwnerIntent memory intent = blankIntent(owner, address(wallet), relayer);
        intent.sessionHash = keccak256(abi.encode(s));
        intent.grantNonce = wallet.grantNonce();
        bytes memory sig = signIntent(ownerPk, intent);
        vm.prank(relayer);
        vm.expectRevert(refused);
        wallet.grantRulesWithSig(s, intent, sig);

        // 3. the owner door, straight to the engine
        Session[] memory sessions = new Session[](1);
        sessions[0] = s;
        bytes memory direct =
            ExecutionLib.encodeSingle(address(engine), 0, abi.encodeCall(ISmartSession.enableSessions, (sessions)));
        vm.prank(owner);
        vm.expectRevert(refused);
        wallet.execute(ModeCode.unwrap(ModeLib.encodeSimpleSingle()), direct);

        assertEq(wallet.grantNonce(), grantNonceBefore, "no grant nonce consumed");
        assertEq(wallet.checkpointCount(), checkpointsBefore, "no checkpoint recorded");
    }

    /**
     * The SDK's "no tokens" rule, end to end. A user who wants a rule that moves nothing gets one
     * token, the destination chain's gas token, with `maxPerCall = 0` and `maxTotal = 0`. The token
     * pins the chain; the zero limits mean the agent can make payload-only calls and never move it.
     * Through the real wallet and engine: amount 0 passes, amount 1 is refused, and another chain's
     * token is refused even at amount 0.
     */
    function test_MA20_noMovementRuleIsOneZeroLimitToken() public {
        (address agent,) = ecdsaKey("noMovementAgent");
        address owner = makeAddr("noMovementOwner");
        AGW wallet = newWallet(owner);
        address gasToken = address(new MockPRC20()); // stands in for the chain's gas token PRC20

        AssetCapState[] memory pin = new AssetCapState[](1);
        pin[0] = AssetCapState({ token: gasToken, maxPerCall: 0, maxTotal: 0, spent: 0 });
        vm.prank(owner);
        bytes32 rulesId = wallet.grantRules(canonicalSession(agentConfig(agent), universalInitData(_config(pin))));

        etchCallRecorder(GATEWAY);
        bytes32 mode = ModeCode.unwrap(ModeLib.encodeSimpleSingle());

        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, gasToken, 0));
        assertEq(urp.getConfig(_walletConfigId(wallet, rulesId), address(wallet)).assets[0].spent, 0, "nothing moved");

        expectUrpGate(
            abi.encodeWithSelector(UniversalRulesPolicyErrors.AmountExceedsCap.selector, uint256(1), uint256(0))
        );
        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, gasToken, 1));

        expectUrpGate(abi.encodeWithSelector(UniversalRulesPolicyErrors.AssetNotAllowed.selector, arbUsdc));
        vm.prank(agent);
        wallet.executeAsAgent(rulesId, mode, _walletEcd(wallet, arbUsdc, 0));
    }

    // ═══════════════════════════════ gas ═══════════════════════════════

    /// @dev Marginal gate-5 cost of one more listed token ahead of the matched one, budget = measured
    ///      +10%. Two budgets, because the mode decides warmth: in a plain run the whole test is one
    ///      transaction, so the slots init just wrote are WARM (measured 402); under `--isolate` /
    ///      `--gas-report` every call is its own transaction and the entry's `token` slot is a COLD
    ///      read, as on a real agent call (measured 2,402). Worst case, eight listed tokens and the
    ///      last one matched: about 16.8k gas over a first-entry match.
    uint256 internal constant GATE5_SCAN_GAS_PER_ENTRY_BUDGET = 443;
    uint256 internal constant GATE5_SCAN_GAS_PER_ENTRY_BUDGET_ISOLATED = 2_643;

    /**
     * The scan is linear: a token at index 7 costs seven extra cold reads over one at index 0.
     * Measured on two FRESH configs, each with eight tokens, after a warm-up check on a third, so
     * both measured checks start equally cold and differ only in where the match sits. Amount 0, so
     * neither check writes.
     */
    function test_gas_MA18_gate5ScanCostPerListedToken() public {
        AssetCapState[] memory a = _many(MAX_ASSETS);
        ConfigId warm = ConfigId.wrap(bytes32(uint256(0xF0)));
        ConfigId first = ConfigId.wrap(bytes32(uint256(0xF1)));
        ConfigId last = ConfigId.wrap(bytes32(uint256(0xF8)));
        _initAt(warm, a);
        _initAt(first, a);
        _initAt(last, a);

        // Pay the costs both measured checks share — the proxy and implementation accounts, the
        // gateway slot — once, on a third config, so they land on neither measurement.
        vm.prank(address(engine));
        urp.checkAction(warm, account, GATEWAY, 0, _req(a[0].token, 0));

        bytes memory hitFirst = _req(a[0].token, 0);
        bytes memory hitLast = _req(a[MAX_ASSETS - 1].token, 0);

        vm.prank(address(engine));
        uint256 g0 = gasleft();
        urp.checkAction(first, account, GATEWAY, 0, hitFirst);
        g0 -= gasleft();

        vm.prank(address(engine));
        uint256 g7 = gasleft();
        urp.checkAction(last, account, GATEWAY, 0, hitLast);
        g7 -= gasleft();

        uint256 perEntry = (g7 - g0) / (MAX_ASSETS - 1);
        emit log_named_uint("gate-5 scan gas per listed token ahead of the match", perEntry);
        emit log_named_uint("checkAction gas, match at index 0 of 8", g0);
        emit log_named_uint("checkAction gas, match at index 7 of 8", g7);
        uint256 budget = isolatedCalls() ? GATE5_SCAN_GAS_PER_ENTRY_BUDGET_ISOLATED : GATE5_SCAN_GAS_PER_ENTRY_BUDGET;
        assertLe(perEntry, budget, "gate-5 scan per entry");
    }
}
