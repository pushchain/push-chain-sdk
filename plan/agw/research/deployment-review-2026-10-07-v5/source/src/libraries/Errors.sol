// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ConfigId } from "smartsessions/DataTypes.sol";

import { RulesType, VmFamily } from "./Types.sol";

/**
 * @title  Errors — every custom error in the AGW system, one library per contract.
 * @notice `AGWErrors` (the wallet), `AGWFactoryErrors`, `UniversalRulesPolicyErrors` (URP) and
 *         `AgentValidatorErrors`. Moving an error into a library does not change its selector: a
 *         selector is `bytes4(keccak256(name ‖ argument types))`, independent of where the error
 *         is declared.
 */

/// @title AGWErrors
/// @notice Custom errors of the AGW (wallet).
/// @dev    Errors used by ExecutionLib live here too, so the libraries do not need an error home
///         of their own.
/// @dev    THE ERRORS BELOW ARE NEVER TRUNCATED. They revert directly from the wallet, not through
///         the engine's 32-byte `PolicyCheckReverted` wrapper, so every argument survives intact.
///         URP's diagnostic-first argument ordering (which exists only because of that truncation)
///         deliberately does NOT apply here — do not reorder these for consistency with it.
library AGWErrors {
    // ───────────────────── access control ─────────────────────

    error CallerIsNotOwner();
    error CallerIsNotFactory();

    // ─────────────────── initialisation ───────────────────

    error AlreadyInitialized();
    /// @dev Zero address, or a codeless target on install. Also raised by the wallet's constructor
    ///      when any of the four wiring addresses is zero.
    error InvalidModuleAddress();

    // ──────────────────────── label ────────────────────────

    /// @dev `setLabel`, or a deploy with a label: the label is longer than `MAX_LABEL_BYTES` bytes.
    error LabelTooLong(uint256 length);

    // ──────────────────── module manager ────────────────────

    error ModuleAlreadyInstalled(address module);
    error UnsupportedModuleType(uint256 moduleTypeId);
    error ValidatorNotInstalled(address validator);
    /// @dev The engine-scoped uninstall guard: uninstalling the permission engine while it still
    ///      holds live permissions would strand rows it then refuses to reinstall over. Revoke
    ///      everything first.
    error EngineStillHoldsPermissions();

    // ──────────────────── execution modes ────────────────────

    /// @dev ONE error for every rejected mode — delegatecall, static, try-exec, and, on the agent
    ///      door specifically, batch.
    error UnsupportedExecutionMode();

    // ──────────────────── the agent door ────────────────────

    /// @dev `executeAsAgent`: the caller is not the agent named by `rulesId` on this wallet —
    ///      including when the id is unknown, revoked, or names a session validator other than the
    ///      canonical one (all of which have no agent). Carries both values: this error is raised by
    ///      the wallet directly and is never truncated.
    error CallerIsNotAgent(bytes32 rulesId, address caller);
    /// @dev `executeWithSig`: the intent's sequence number is not the owner lane's next one.
    error InvalidNonce(uint192 nonceKey, uint64 expected, uint64 provided);
    error ValidationFailed(address authorizer);
    error OutsideTimeWindow(uint48 validAfter, uint48 validUntil);

    // ──────────────────── rules set lifecycle ────────────────────

    error UnknownPermission(bytes32 rulesId);
    /// @dev Raised by grantRules's canonical-shape check — the granted session deviates from the
    ///      shape this system accepts for the DERIVED `RulesType`. Stays for the rules COMMON to
    ///      both types: user-op policies, ERC-7739, the paymaster permit, the session validator, and
    ///      the action-policy count. A target that is wrong FOR THE DERIVED TYPE is
    ///      `RulesTypeMismatch` instead — that distinction is the invariant, stated once.
    error MalformedSessionShape();

    // ──────────────────── native rules set shape (grantRules) ────────────────────

    /// @dev Action count outside 1..MAX_NATIVE_ACTIONS. Zero is refused too: a rules set that
    ///      authorises nothing is a misconfiguration, not a valid ascetic grant.
    ///
    ///      ZERO IS NOW CHECKED FOR BOTH MODES, BEFORE THE MODE IS KNOWN. The mode is derived from
    ///      action 0's envelope, so action 0 must exist before anything can be derived — with no
    ///      actions there is no envelope, no chain, and therefore no mode. A universal session with
    ///      zero actions consequently reports `TooManyActions(0)` rather than
    ///      `MalformedSessionShape`.
    error TooManyActions(uint256 count);

    /// @dev The same (target, selector) pair twice in one rules set. Both would hash to one actionId,
    ///      so the second config would overwrite the first — or be refused — depending on engine
    ///      internals. Refused here instead, where the error can name the pair.
    error DuplicateAction(address target, bytes4 selector);

    /// @dev A NATIVE action naming a target no rules set may ever reach: the zero address, the
    ///      engine's fallback flag, the wallet itself, the engine, URP, the validator, or the
    ///      factory. Self and engine are the severe ones — both would let an agent reach the
    ///      wallet's own lifecycle functions through `onlyOwnerOrSelf`.
    error ForbiddenActionTarget(address target);

    /// @dev A NATIVE action naming one of the engine's fallback selectors. `0xFFFFFFFF`
    ///      (value-only) is permitted and is not one of these.
    error ForbiddenActionSelector(bytes4 selector);

    /// @dev The type DERIVED from the envelope's chain does not match the action set: a gateway
    ///      target under the Push chain, or a non-gateway target under a foreign chain. Carries the
    ///      offending action's index and target, which is why it is distinct from
    ///      `MalformedSessionShape` — with up to eight actions, "something was wrong" is not a
    ///      usable diagnostic.
    ///
    ///      IF YOU MEANT A NATIVE MANDATE AND SEE `UNIVERSAL` HERE, THE CHAIN STRING IS NOT
    ///      BYTE-EXACT `eip155:<chainid>` OF THIS CHAIN. `"EIP155:42101"`, `"eip155:042101"` and a
    ///      leading space all hash to not-Push and therefore derive UNIVERSAL. That is deliberate:
    ///      the hash comparison is the whole rule, and a string parser would be a second rulebook
    ///      and a heuristic. The SDK prechecks this so a user sees the real cause.
    ///
    ///      ORDER NOTE: under UNIVERSAL the `n != 1` shape rule runs BEFORE the target check, so a
    ///      malformed chain string on a multi-action session reports `MalformedSessionShape`.
    error RulesTypeMismatch(RulesType derived, uint256 actionIndex, address target);

    /// @dev `grantRules`: action 0's policy envelope declares an empty chain string. The wallet
    ///      performs no other validation of it — a malformed non-empty string derives UNIVERSAL and
    ///      is then refused against the targets, or against the asset by URP at init.
    error EmptyChain();

    /// @dev `grantRules`: action `actionIndex` declares a different chain than action 0. A rules set
    ///      is one thing, on one chain, in one mode — which is what makes mixed rules sets impossible
    ///      by construction rather than by a rule.
    error InconsistentChain(uint256 actionIndex);

    // ──────────────────── the agent door, dispatch ────────────────────

    /// @dev The validated execution's target is the wallet itself or the engine. Fires in
    ///      `_gateAndDispatch`, AFTER validation — it is the last layer, and it holds even for a
    ///      session the owner enabled directly on the engine through the owner door, bypassing
    ///      `grantRules` entirely. Do not move this check before `_validate`.
    error ForbiddenDispatchTarget(address target);

    // ─────────────────── the owner-intent doors ───────────────────
    //
    // One shape per name, shared with AGWFactory and UniversalMarketplace, so a test encodes one
    // selector whichever contract reverts first.

    /// @dev `intent.deadline` has passed.
    error OwnerSigExpired(uint48 deadline);
    /// @dev The signature is not the owner's over the intent.
    error InvalidOwnerSignature();
    /// @dev `intent.wallet` is not this wallet.
    error IntentWalletMismatch(address expected, address provided);
    /// @dev Presented by someone other than `intent.executor`, or `intent.executor` is zero.
    error ExecutorMismatch(address expected, address actual);
    /// @dev `intent.sessionHash` is zero or is not the hash of the session being granted.
    error IntentSessionMismatch(bytes32 actual);
    /// @dev `intent.grantNonce` is not the wallet's current grant nonce.
    error IntentGrantNonceMismatch(uint64 expected, uint64 provided);
    /// @dev `intent.execCalldataHash` is zero or does not match, or `intent.mode` does not match.
    error IntentExecMismatch(bytes32 actualCalldataHash);
    /// @dev `executeWithSig` on a nonce key without `OWNER_LANE_FLAG`.
    error OwnerLaneRequired(uint192 nonceKey);

    // ──────────────────── used by ExecutionLib ────────────────────

    /// @dev ExecutionLib.decodeBatch — the only error any library in src/ actually references.
    error MalformedBatchCalldata();
}

/// @title AGWFactoryErrors
/// @notice Custom errors of `AGWFactory`.
library AGWFactoryErrors {
    /// @dev initialize: admin or implementation is zero.
    error ZeroAddress();
    /// @dev deploy/predict called on an uninitialised factory.
    error ImplementationNotSet();
    /// @dev indexOf on an address this factory did not deploy.
    error NotAWallet(address account);
    /// @dev predictWallet beyond the next deployable index.
    error IndexOutOfRange(uint256 index, uint256 next);
    /// @dev deployWalletWithSig: `intent.index` is not the owner's next index.
    error IndexMismatch(uint96 expected, uint96 provided);
    /// @dev deployWalletWithSig: `intent.wallet` is not the address this call would deploy.
    error IntentWalletMismatch(address expected, address provided);
    /// @dev deployWalletWithSig: signature path presented by someone other than `intent.executor`,
    ///      or `intent.executor` is zero.
    error ExecutorMismatch(address expected, address actual);
    /// @dev deployWalletWithSig: signature path after `intent.deadline`.
    error SignatureExpired(uint48 deadline);
    /// @dev deployWalletWithSig: the signature is not the owner's over the intent.
    error InvalidOwnerSignature();
}

/// @title UniversalRulesPolicyErrors
/// @notice Custom errors of the Universal Rules Policy (URP).
/// @dev    Revert data truncates to 32 bytes through the engine (`PolicyLib.sol:139-152`,
///         `_maxCopy: 32`, surfacing as `PolicyCheckReverted(bytes32)`). The 4-byte selector
///         survives; multi-argument custom errors do not round-trip to the caller. Errors below
///         still carry their arguments because URP is also called directly (owner path, executor
///         module, init) where they do survive.
library UniversalRulesPolicyErrors {
    error ZeroAddress();
    error NotInitialized(ConfigId id, address account);
    error AlreadyInitialized(ConfigId id);
    /// @dev init: zero, or not in the future.
    error InvalidExpiry(uint48 validUntil);
    /// @dev init: zero expectedCEA.
    error InvalidConfigField();
    /// @dev init, universal (EVM and SVM): the asset list is empty or longer than MAX_ASSETS. Empty is
    ///      refused because the token is what pins the destination chain: the gateway routes by it.
    error AssetListOutOfRange(uint256 length);
    /// @dev init, universal: the same token listed twice — the second entry's caps would be dead.
    error DuplicateAsset(address token);
    /// @dev init: 0 or > MAX_ALLOWED_CALLS.
    error AllowListOutOfRange(uint256 length);
    error RulesExpired(uint48 validUntil);
    error InvalidTarget(address target);
    /// @dev Gate 4a. Distinct from InvalidSelector: there is no selector to report, and a zero
    ///      sentinel would be indistinguishable from a genuine all-zero-selector payload.
    error CalldataTooShort(uint256 length);
    error InvalidSelector(bytes4 selector);
    /// @dev Gate 4c — body below MIN_OUTBOUND_BODY_LEN.
    error MalformedOutboundRequest(uint256 length);
    /// @dev Gate 5: the request's token is not in the rules set's asset list. Checked on EVERY request,
    ///      zero amount included — the token decides the destination chain, so an unlisted token is a
    ///      chain the owner never approved.
    error AssetNotAllowed(address token);
    error AmountExceedsCap(uint256 amount, uint256 cap);
    error TotalSpendCapExceeded(uint256 wouldBeTotal, uint256 cap);
    error PCValueExceedsCap(uint256 value, uint256 cap);
    error UncappedGasSwapRejected();
    error InvalidRevertRecipient(address expected, address actual);
    error RecipientMustBeEmpty();
    error PayloadNotMulticall();
    error BatchSizeOutOfRange(uint256 count);
    error ForbiddenInnerTarget(address target);
    error CallNotAllowed(address target, bytes4 selector);
    error BeneficiaryMismatch(address expected, address actual);
    error InnerValueExceedsAllowance(uint256 index, uint256 value, uint256 maxValue);
    error MalformedInnerCalldata();
    error SpentMismatch(uint256 expected, uint256 actual);
    /// @dev Universal `assertSpent`: one token's counter differs from what the caller composed against.
    error AssetSpentMismatch(address token, uint256 expected, uint256 actual);
    /// @dev Universal `assertSpent`: the expected array does not have one entry per listed asset.
    error SpentLengthMismatch(uint256 expected, uint256 actual);
    error CallerIsNotUEModule(address caller);
    error AlreadyCredited(bytes32 outboundTxId);

    // ───────────────────────── native mode errors ─────────────────────────
    //
    // DIAGNOSTIC VALUE FIRST. The engine truncates policy revert data to 32 bytes
    // (`PolicyLib.sol:145`), so a caller sees the 4-byte selector plus only the first 28 bytes of
    // the FIRST argument. Putting an index or a length first would surface 28 zero bytes and tell
    // nobody anything; putting the offending value first surfaces the thing you debug with.
    // This ordering applies to URP errors only — wallet errors are never truncated.

    // init
    //
    // NOT TRUNCATED. The 28-byte rule above applies to `checkAction`, which the engine wraps in
    // `PolicyCheckReverted`. `initializeWithMultiplexer` is a plain high-level call from
    // `ConfigLib.sol:98-101` inside `enableSessions`, so init reverts BUBBLE WITH FULL DATA. Tests
    // assert these with a plain `vm.expectRevert(abi.encodeWithSelector(...))` carrying every
    // argument — never `expectUrpGate`.

    /// @dev init: the envelope's `chain` string is empty. The only validation URP performs on the
    ///      string itself; a malformed non-empty string derives UNIVERSAL and is caught by the
    ///      asset check instead.
    error EmptyChain();
    /// @dev init: the envelope's first word is not `ENVELOPE_VERSION`. Read before anything else is
    ///      decoded, so most malformed or pre-version blobs land here, named: a two-field
    ///      `(string, bytes)` envelope starts with its string offset and reports version 64.
    error UnsupportedEnvelopeVersion(uint256 version);

    /// @dev init, universal: the asset reports a different source chain than the envelope declares.
    ///      `declared` first because it is the value the owner can act on.
    error ChainMismatch(bytes32 declared, bytes32 assetChain);

    /// @dev init, universal: the asset has no code, is an EOA, or REVERTED when asked for
    ///      `SOURCE_CHAIN_NAMESPACE()`.
    ///
    ///      AN ASSET THAT *ANSWERS* WITH A NON-STRING, OR WITH NOTHING, REVERTS UNNAMED INSTEAD —
    ///      the returndata fails ABI decoding in URP's own frame, which `catch` does not see. The
    ///      no-code and EOA cases are named only because an explicit `code.length` guard runs first;
    ///      since solc 0.8.10 the compiler omits the `extcodesize` check when return data is
    ///      expected, so `try/catch` alone would let both through as unnamed reverts. Measured.
    error InvalidAsset(address asset);
    /// @dev init: native config with a zero target.
    error NativeTargetZero();
    /// @dev init AND gate N3. A native config may never name the gateway, and a native config may
    ///      never be reached by a gateway-targeted request. The mirror of universal gate 3.
    error NativeTargetIsGateway(address target);
    /// @dev init: a value-only config (`selector == 0xFFFFFFFF`) carrying pins. Refused rather than
    ///      left to fail closed at N7: such a config can NEVER authorise anything, so it is a
    ///      misconfiguration the owner believes they granted, not a valid ascetic config.
    error ValueOnlyWithPins();
    /// @dev init: a value-only config carrying an amount rule. Same reasoning.
    error ValueOnlyWithAmountRule();
    /// @dev init: pins.length > MAX_PINS.
    error TooManyPins(uint256 count);

    // check
    error TargetMismatch(address actual, address expected);
    error SelectorMismatch(bytes4 actual, bytes4 expected);
    /// @dev N5: a value-only action carrying 1..3 bytes of calldata. The engine buckets those under
    ///      `VALUE_SELECTOR` too; URP is where "value-only means empty calldata" becomes true.
    error ValueOnlyCalldataNotEmpty(uint256 length);
    error ValueExceedsCap(uint256 value, uint256 cap);
    error TotalValueExceeded(uint256 newSpent, uint256 cap);
    error CalldataTooShortForPin(uint256 actualLength, uint256 index, uint256 needed);
    error ArgPinMismatch(bytes32 actual, uint256 index, bytes32 expected);
    error CalldataTooShortForAmount(uint256 actualLength, uint256 needed);
    error NativeAmountExceedsCap(uint256 amount, uint256 cap);
    error TotalNativeAmountExceeded(uint256 newSpent, uint256 cap);
    error CallLimitReached(uint32 callsUsed, uint32 maxCalls);

    // views / assertions
    /// @dev A getter or assertion was called against the wrong rulebook — `getConfig` on a native
    ///      slot, or the five-argument `assertSpent` on a universal one. Carries the mode the config
    ///      ACTUALLY is. An EMPTY slot is not this error: it returns a zeroed struct exactly as
    ///      before, because an empty slot is a state while a wrong-mode read is a caller bug.
    error WrongModeForCall(RulesType actual);
    /// @dev A getter or assertion was called against the wrong VM family — `getConfig` on an SVM
    ///      slot, `getSvmConfig` on an EVM one. Carries the family the config ACTUALLY is.
    error WrongVmForCall(VmFamily actual);

    // ───────────────────────── svm mode errors ─────────────────────────

    // init
    /// @dev init: zero expectedCEA or gatewayProgram.
    error InvalidSvmConfigField();
    /// @dev init: 0 or > MAX_ALLOWED_PROGRAMS.
    error ProgramListOutOfRange(uint256 length);
    error TooManySvmPins(uint256 count);
    error TooManySvmDataPins(uint256 count);
    error TooManyCeaAccounts(uint256 count);
    /// @dev init: `discriminatorLen` is 0 without `dataless`, non-zero with it, or above 8.
    error DiscriminatorLenOutOfRange(uint256 rule, uint8 len);
    /// @dev init: two rules on one program that a single request could both match. First-match
    ///      must be EXACT, or the stricter rule is dead and its pins never run.
    error AmbiguousRule(uint256 i, uint256 j);
    /// @dev init: a program the rulebook forbids as a target can never be allow-listed either.
    error ForbiddenProgramInAllowList(uint256 rule, bytes32 program);
    error SvmPinRuleOutOfRange(uint256 pin, uint8 rule);
    /// @dev init: account index at or beyond MAX_SVM_ACCOUNTS, or beyond the rule's `maxAccounts`.
    error SvmPinIndexOutOfRange(uint256 pin, uint8 accountIndex);
    /// @dev init: a rule's fixed account count exceeds the S13 bound, so no request could meet it.
    error SvmMaxAccountsOutOfRange(uint256 rule, uint8 maxAccounts);
    /// @dev init: two account pins name the same (rule, index).
    error DuplicateSvmPin(uint256 first, uint256 second);
    /// @dev init: a `ceaAccounts` entry is zero, repeated, or equal to an allow-listed program.
    error InvalidCeaAccount(uint256 index);
    /// @dev init: `ceaAccounts` does not contain `expectedCEA`, which would switch S18 off for the
    ///      one account that always holds value.
    error CeaAccountsMissExpectedCEA();
    /// @dev init: a data pin with an impossible shape, or a vacuous / impossible comparison value
    ///      (a ceiling or floor outside the field's range, a zero ratio term, an EQ value with bytes
    ///      past `len`). See `SvmDataPin` and `URP._dataPinValueValid`.
    error SvmDataPinInvalid(uint256 pin);
    /// @dev init: every rule must own at least one account pin. HYGIENE, not a guarantee: one
    ///      authority pin always passes. Which positions must be pinned is the compiler's job.
    error RuleWithoutPin(uint256 rule);

    // check
    /// @dev S6b. Solana amounts are u64; the node would truncate. Defence in depth.
    error AmountExceedsU64(uint256 amount);
    /// @dev S11. The recipient must be a 32-byte, non-zero pubkey — the target program.
    error RecipientNotPubkey(uint256 length);
    /// @dev S12. Execute-only: an empty payload is a funds-only withdraw, never admitted (parity
    ///      with EVM gate 12).
    error SvmPayloadEmpty();
    /// @dev S12. 1 = short header, 2 = short account list, 3 = short ix_data, 4 = trailing bytes.
    ///      The grammar is the node's `decodePayload`, byte for byte.
    error MalformedSvmPayload(uint8 code);
    /// @dev S13. Only instruction_id 2 (execute) is admitted.
    error SvmInstructionNotExecute(uint8 instructionId);
    error SvmAccountsOutOfRange(uint256 count);
    error SvmIxDataTooLong(uint256 length);
    /// @dev S14. The node signs the payload's target but finalises with the recipient; they must
    ///      agree or the TSS check fails on Solana at the owner's expense.
    error RecipientTargetMismatch(bytes32 recipient, bytes32 target);
    /// @dev S15. System, SPL Token, Token-2022, Stake, BPF Loader Upgradeable, Address Lookup Table,
    ///      the gateway program and the CEA itself.
    error ForbiddenTargetProgram(bytes32 program);
    /// @dev S16. No rule matches (program, discriminator). Carries the first 8 bytes of ix_data.
    error ProgramNotAllowed(bytes32 program, bytes8 discriminator);
    /// @dev S16. The rule fixes the account count and the request's differs.
    error SvmAccountCountMismatch(uint256 count, uint8 expected);
    /// @dev S17. A pinned index does not exist in the request.
    error SvmAccountCountBelowPin(uint256 pin, uint256 count, uint8 needed);
    error SvmAccountPinMismatch(uint256 pin, uint8 accountIndex, bytes32 expected, bytes32 actual);
    /// @dev S17. ix_data is too short for the pin's field.
    error SvmDataTooShortForPin(uint256 pin, uint256 ixLen);
    error SvmDataPinMismatch(uint256 pin, bytes32 expected, bytes32 actual);
    error SvmDataFloorNotMet(uint256 pin, uint256 actual, uint256 floor);
    error SvmDataCeilingExceeded(uint256 pin, uint256 actual, uint256 ceiling);
    error SvmDataRatioNotMet(uint256 pin, uint256 a, uint256 b, uint64 num, uint64 den);
    /// @dev S18. A CEA-controlled account appears at a position the matched rule does not pin to it.
    error CeaAccountAtUnpinnedIndex(uint256 accountIndex, bytes32 account);
}

/// @title AgentValidatorErrors
/// @notice Custom errors of the session validator.
library AgentValidatorErrors {
    /// @dev The stored config is not exactly `abi.encode(address agent)` with a non-zero agent.
    ///      Unreachable through the wallet's grant path, which runs `validateConfig` first; reachable
    ///      only for a session the owner enabled on the engine directly.
    error MalformedConfig();
}
