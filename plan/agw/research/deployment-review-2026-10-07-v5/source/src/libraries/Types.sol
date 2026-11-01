// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @notice Mirror of push-chain-gateway .../libraries/TypesUGPC.sol
 * @dev MUST match field-for-field and in order. Verified against
 *      contracts/evm-gateway/src/libraries/TypesUGPC.sol.
 */
struct UniversalOutboundTxRequest {
    bytes recipient; // raw destination address on source chain (bytes for SVM compat)
    address token; // PRC20 token address on Push Chain
    uint256 amount; // amount to withdraw (burn on Push, unlock at origin)
    uint256 gasLimit; // gas limit for fee quote; 0 = per-chain default
    uint256 gasPrice; // gas price override; 0 = per-chain default
    uint256 maxPCForGas; // max native PC for gas swap; 0 = no cap
    bytes payload; // ABI-encoded calldata to execute on origin chain
    address revertRecipient; // address to receive funds in case of revert
}

/**
 * @notice Mirror of push-chain-core .../libraries/Types.sol
 * @dev Batch call entry for multicall execution.
 */
struct Multicall {
    address to;
    uint256 value;
    bytes data;
}

/// @dev bytes4(keccak256("UEA_MULTICALL")) — magic prefix for multicall payloads.
bytes4 constant MULTICALL_SELECTOR = bytes4(keccak256("UEA_MULTICALL"));

/**
 * @dev The two kinds of rules set. Declared by the owner at grant, asserted by the wallet, stored by
 *      URP as the config's mode.
 *
 *      DECLARED ONCE, HERE, AND IMPORTED BY BOTH THE WALLET AND `IUniversalRulesPolicy`. Two enums with identical
 *      values that must always agree is the duplication this file exists to prevent — see the note
 *      on `SEND_OUTBOUND_SELECTOR` below. The wallet asserts the declared type against the action
 *      set at grant; URP stores it and branches on it at validation. They must be the same type.
 *
 *      `UNIVERSAL` is the zero value, so an uninitialised slot reads as `UNIVERSAL`. That is why
 *      URP's `ModeSlot` carries an explicit `initialized` flag and never infers emptiness from the
 *      mode alone.
 */
enum RulesType {
    UNIVERSAL,
    NATIVE
}

/**
 * @dev Which destination VM a UNIVERSAL rules set targets. Derived by URP from the envelope's chain
 *      namespace prefix (`eip155:` / `solana:`) at config init; the wallet never reads it, because
 *      its grant rules are identical for every non-Push chain.
 *
 *      `EVM` MUST STAY THE ZERO VALUE. URP's `ModeSlot` entries written before this enum existed
 *      read 0 in the byte that now holds it, and every one of them is an EVM rules set.
 */
enum VmFamily {
    EVM,
    SVM
}

/**
 * @dev Mirrors of engine constants that are not importable — `IdLib.VALUE_SELECTOR` is `internal`
 *      to a library, and the fallback flags are file-level constants in the vendored fork.
 *
 *      MIRRORED, NOT GUESSED: each is pinned by a constant-mirror test against the upstream value,
 *      exactly as `MULTICALL_SELECTOR` is. If the fork moves, the test fails rather than the wallet
 *      silently permitting an action it means to forbid.
 */

/// @dev `IdLib.VALUE_SELECTOR` — the action selector the engine assigns when calldata is under four
///      bytes. A native action carrying this selector is a value-only transfer with EMPTY calldata;
///      a no-argument function like `unstake()` still carries its own four bytes and is a normal
///      selector action.
bytes4 constant VALUE_SELECTOR = 0xFFFFFFFF;

/// @dev `DataTypes.FALLBACK_TARGET_FLAG`. Refused by name at grant time: the engine does NOT reject
///      it at enable time (only at check time, `PolicyLib.sol:200`), so the wallet is the only
///      grant-time layer for this value.
address constant ENGINE_FALLBACK_TARGET = address(1);

/// @dev `DataTypes.FALLBACK_TARGET_SELECTOR_FLAG` — the wildcard action's selector.
bytes4 constant ENGINE_FALLBACK_SELECTOR = 0x00000001;

/// @dev `DataTypes.FALLBACK_TARGET_SELECTOR_FLAG_PERMITTED_TO_CALL_SMARTSESSION` — the sentinel that
///      routes a request to the engine itself. An agent reaching this could configure sessions.
bytes4 constant ENGINE_FALLBACK_SELECTOR_SMARTSESSION = 0x00000002;

/**
 * @dev The gateway's outbound entry point — the ONE selector an agent rules set may ever name.
 *
 *      DECLARED HERE, BESIDE THE STRUCT IT TAKES, AND NOWHERE ELSE. The wallet's grant-shape check
 *      and the policy's request-decode gate must agree on this value exactly: the wallet refuses to
 *      grant a rules set naming any other selector, and the policy refuses to validate a request
 *      carrying any other selector. Two independently hand-typed copies of the same signature
 *      string is the kind of duplication that stays correct only until one of them is edited, and
 *      the failure would be silent in the safe direction for one contract and open in the other.
 *
 *      The signature string spells out `UniversalOutboundTxRequest` field-for-field because that is
 *      how Solidity encodes a struct parameter into a selector. It is therefore load-bearing on the
 *      mirror above: reorder or retype a field there without editing this string and the selector
 *      silently stops matching the deployed gateway.
 */
bytes4 constant SEND_OUTBOUND_SELECTOR =
    bytes4(keccak256("sendUniversalTxOutbound((bytes,address,uint256,uint256,uint256,uint256,bytes,address))"));

/**
 * @dev The owner's signed authorisation for up to three actions: deploy, grant, execute.
 *
 *      SIGNED ONCE under the FACTORY's EIP-712 domain and verified by the factory and by every wallet
 *      it deploys. Each door checks only its own fields and advances its own nonce, so one signature
 *      serves each door exactly once.
 *
 *      - Presentable ONLY by `executor`: every door, on its signature path, requires
 *        `intent.executor != address(0) && msg.sender == intent.executor`. Without that, anyone who saw
 *        the intent in calldata could drive the doors out of order and burn the owner's signature.
 *      - A zero `sessionHash` / `execCalldataHash` means "not authorised for that action".
 *      - EVERY FIELD IS IN THE TYPEHASH, IN DECLARATION ORDER. A field outside the typed data would
 *        guarantee the SDK and the contract disagree about what was signed.
 *
 *      DECLARED HERE, beside the other values the factory and the wallet must agree on exactly.
 */
struct OwnerIntent {
    address owner; // the wallet owner (UEA or EOA)
    address wallet; // the wallet this intent is for — the predicted address if not yet deployed
    address executor; // the ONLY msg.sender allowed to present this intent to a door
    uint96 index; // wallet index under owner; deployWallet requires index == walletCount(owner)
    bytes32 sessionHash; // keccak256(abi.encode(Session)) for grantRulesWithSig; 0 = no grant
    bytes32 mode; // ERC-7579 mode word for executeWithSig
    bytes32 execCalldataHash; // keccak256(executionCalldata) for executeWithSig; 0 = no exec
    uint192 nonceKey; // owner lane for executeWithSig; must have OWNER_LANE_FLAG set
    uint64 nonceSeq; // expected _nonces[nonceKey] at execution
    uint64 grantNonce; // expected _grantNonce at grant
    uint48 deadline; // unix seconds; all three doors reject after this
    uint256 signerChainId; // EIP-712 domain.chainId the signer's wallet accepts — the owner's HOME chain
}

/// @dev The struct string must list every OwnerIntent field, in declaration order, with its exact type.
bytes32 constant OWNER_INTENT_TYPEHASH = keccak256(
    "OwnerIntent(address owner,address wallet,address executor,uint96 index,bytes32 sessionHash,"
    "bytes32 mode,bytes32 execCalldataHash,uint192 nonceKey,uint64 nonceSeq,uint64 grantNonce,"
    "uint48 deadline,uint256 signerChainId)"
);

/**
 * @dev The intent's EIP-712 domain. Five fields:
 *      - `chainId` is the SIGNER's home chain (`intent.signerChainId`), not Push: MetaMask refuses to
 *        sign typed data whose `domain.chainId` differs from the active chain.
 *      - `salt` is `bytes32(block.chainid)` — the Push chain id — which is what isolates one Push chain
 *        from another.
 *      - `verifyingContract` is the FACTORY PROXY for both the factory and every wallet; the wallet
 *        reads it from its immutable args. The `wallet` field stops cross-wallet replay.
 */
bytes32 constant OWNER_INTENT_DOMAIN_TYPEHASH =
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)");
bytes32 constant OWNER_INTENT_DOMAIN_NAME_HASH = keccak256("AGWFactory");
bytes32 constant OWNER_INTENT_DOMAIN_VERSION_HASH = keccak256("1");

/**
 * @dev Top bit of a uint192 nonce key. `executeWithSig` requires it SET: only owner lanes are ever
 *      consumed, and keys with it CLEAR are never touched. The agent door uses no nonce lanes at all —
 *      its replay protection is the sender's own transaction nonce.
 */
uint192 constant OWNER_LANE_FLAG = uint192(1) << 191;

/**
 * @dev The kinds of owner-side change the wallet records as a checkpoint (`IAGW.Checkpointed`).
 *
 *      ORDINALS ARE A FROZEN WIRE FORMAT: indexers and evaluators read them. Append only — never
 *      reorder, never remove. A future kind (e.g. a binder) is appended as the next ordinal.
 */
enum CheckpointKind {
    OWNER_ACTION,
    RULES_GRANTED,
    RULES_REVOKED
}

// ─────────────────────── policy types (moved from IURP) ───────────────────────

/**
 * @dev Maximum pinned arguments per native action. Bounds the N7 loop.
 *
 *      FILE-LEVEL, NOT INSIDE THE INTERFACE — Solidity forbids variables in interfaces (solc 8274),
 *      and unlike `MAX_ACTIONS_PER_REQUEST` / `MAX_ALLOWED_CALLS` (which are `internal` to URP
 *      because they bound loops nobody off-chain constructs) this one bounds an array THE SDK
 *      BUILDS, so an encoder has to be able to see it. Parallel to `MULTICALL_SELECTOR` in
 *      `Types.sol`.
 */
uint256 constant MAX_PINS = 8;

/**
 * @dev Maximum tokens one UNIVERSAL rules set may list (EVM and SVM alike). Bounds the init duplicate
 *      check and the gate-5 scan.
 *
 *      FILE-LEVEL FOR THE SAME REASON AS `MAX_PINS`: it bounds an array THE SDK BUILDS.
 */
uint256 constant MAX_ASSETS = 8;

/**
 * @dev Longest wallet label, in BYTES (not characters). `AGW.setLabel` and the deploy path refuse a
 *      longer one, so every `label()` read is bounded. FILE-LEVEL so the SDK can see it.
 */
uint256 constant MAX_LABEL_BYTES = 64;

/**
 * @dev The rules-envelope version URP accepts. Every action policy's `initData` is
 *      `abi.encode(uint16 version, string chainNamespace, bytes body)`, the same shape in every mode.
 *      URP reads the version from the FIRST WORD before decoding anything else and refuses any other
 *      value, so a body layout can change later under a new version without being misread.
 *      FILE-LEVEL so the SDK, which writes the envelope, can read it.
 */
uint16 constant ENVELOPE_VERSION = 1;

/**
 * @notice WIRE TYPE — one token a UNIVERSAL rules set may move, with its own caps.
 * @param token       The PRC20 ON PUSH (e.g. USDC.eth), never the destination chain's address: the
 *                    gateway request carries the PRC20 and routes by it. Its `SOURCE_CHAIN_NAMESPACE()`
 *                    must equal the rules set's chain, checked at init for every entry.
 * @param maxPerCall  Per-request ceiling, PRC20 base units. ZERO IS LEGAL and means "this token may
 *                    route a request but never moves": the move-nothing rules set is one entry with a
 *                    zero `maxPerCall`, never an empty list (an empty list would pin no chain).
 * @param maxTotal    Lifetime ceiling on the amount SENT OUT in this token. `type(uint256).max` =
 *                    unlimited, with no special branch; zero means nothing may move.
 */
struct AssetCap {
    address token;
    uint256 maxPerCall;
    uint256 maxTotal;
}

/**
 * @notice STORAGE TYPE — an `AssetCap` plus the counter URP owns. Never a wire type: a caller-set
 *         counter would be a granted head start on the cap.
 * @param spent  Lifetime amount sent out in this token, recorded before dispatch. Money coming back
 *               to the wallet never lowers it (URP cannot see inflows, and could not tell an agent's
 *               return from the owner's top-up); only `creditRevert` does.
 */
struct AssetCapState {
    address token;
    uint256 maxPerCall;
    uint256 maxTotal;
    uint256 spent;
}

/// @param target            far-chain contract
/// @param selector          far-chain function
/// @param beneficiaryOffset byte offset of the beneficiary word in the inner calldata
/// @param hasBeneficiary    false for calls with no beneficiary argument
/// @param maxValue          per-entry native ceiling, DESTINATION-chain units (0 = non-payable)
struct AllowedCall {
    address target;
    bytes4 selector;
    uint16 beneficiaryOffset;
    bool hasBeneficiary;
    uint256 maxValue;
}

/**
 * @notice WIRE TYPE — what a UNIVERSAL envelope's body encodes. Not a storage type.
 *
 * @dev    ABSENT BY DESIGN, and each absence is the point: `initialized` (URP sets it), `spent`
 *         (URP owns it), and the chain (the envelope carries it, exactly once). The SDK used to
 *         type all three and URP overwrote them — a field whose only legal value is a
 *         placeholder is a field the caller fills in believing it matters.
 *
 *         Mapped field-by-field onto the storage `Config` by `_store`. The storage struct's
 *         layout never moves; this one is free to change with the wire format.
 */
struct UniversalTerms {
    uint48 validUntil;
    address expectedCEA;
    AssetCap[] assets;
    uint256 maxGasPerCall;
    AllowedCall[] allowedCalls;
}

/// @param initialized      set once, at initialisation; re-initialisation is refused
/// @param validUntil       non-zero always (enforced at init); "never" = type(uint48).max, explicit
/// @param expectedCEA      the wallet's destination account, committed at grant. The rules set's
///                         chain is not stored here: it lives on `getMode(id, account).chainHash`
/// @param maxGasPerCall    Push-native per-call ceiling on `msg.value`, in PC wei. It pays the protocol
///                         fee AND the gas swap, despite the name (renamed from `maxPCPerCall` to
///                         match the SDK)
/// @param assets           1..MAX_ASSETS permitted PRC20s, each with its own caps and its own `spent`
struct Config {
    bool initialized;
    uint48 validUntil;
    address expectedCEA;
    uint256 maxGasPerCall;
    AssetCapState[] assets;
    AllowedCall[] allowedCalls;
}

// ───────────────────────── native mode structs ─────────────────────────

/**
 * @dev Per-config mode record. THE MODE DISCRIMINATOR, and the reason it is a struct rather than
 *      a bare enum: `RulesType.UNIVERSAL` is the zero value, so an empty storage slot reads as
 *      `UNIVERSAL` and could not be told apart from a real universal rules set. `initialized` is
 *      authoritative; `mode` is MEANINGLESS when it is false.
 * @param initialized  true once any rulebook has been written for this config
 * @param mode         which rulebook; only meaningful when `initialized`
 * @param vm           which destination VM a UNIVERSAL config targets; meaningless for NATIVE
 */
struct ModeSlot {
    bool initialized;
    RulesType mode;
    /// @dev ADDED for the SVM rulebook, PLACED HERE ON PURPOSE. Declared between `mode` and
    ///      `chainHash` it packs into slot 0 at byte 2 — a byte no earlier implementation ever
    ///      wrote, so every existing entry reads 0 = `EVM`, which is what every existing entry
    ///      is. No existing member moves: `chainHash` stays at slot 1. Appending it after
    ///      `chainHash` would be equally safe and cost one more slot per grant; the layout test
    ///      pins label, slot, offset and type of all four members either way.
    VmFamily vm;
    /// @dev keccak256(bytes(chain)) as declared in the policy envelope. THE single chain record
    ///      for BOTH modes — universal stores the destination chain, native stores this chain's
    ///      own hash. Written at init, never zero on an initialised entry.
    bytes32 chainHash;
}

/**
 * @dev One pinned argument of a native call.
 * @param offset    ABSOLUTE byte offset from byte 0 of the calldata, SELECTOR INCLUDED — so 4 is
 *                  the first argument word, 36 the second, and so on.
 * @param expected  The full 32-byte word that must appear there. An address argument is
 *                  left-padded by the ABI, so a non-zero high half is a MISMATCH, deliberately:
 *                  full-word equality also proves the padding is clean, which masking would
 *                  silently accept.
 */
struct ArgPin {
    uint16 offset;
    bytes32 expected;
}

/**
 * @dev Optional metering of a `uint256` argument read out of native calldata.
 * @param enabled     Whether to meter at all. A BOOL rather than "offset 0 means off", because
 *                    offset 0 is a legal position — it just points inside the selector.
 * @param offset      Absolute byte offset of the amount word, selector included.
 * @param maxPerCall  Per-call ceiling. Zero is legal (a call that must carry amount zero).
 * @param maxTotal    Lifetime ceiling; `type(uint256).max` = unlimited, with no special branch.
 */
struct AmountRule {
    bool enabled;
    uint16 offset;
    uint256 maxPerCall;
    uint256 maxTotal;
}

/**
 * @dev The native rulebook for ONE (target, selector) action. One of these per action, so a
 *      rules set with eight actions holds eight of them under eight distinct config ids.
 *
 * @param initialized      set once; re-initialisation is refused, as in universal mode
 * @param validUntil       non-zero and future (enforced at init); "never" = type(uint48).max
 * @param target           defensive copy of the action target, asserted at N4
 * @param selector         defensive copy, asserted at N5. `0xFFFFFFFF` = value-only, which means
 *                         EMPTY calldata — a no-argument function still carries four bytes
 * @param maxValuePerCall  Push-native per-call ceiling
 * @param maxValueTotal    Push-native lifetime ceiling; type(uint256).max = unlimited
 * @param valueSpent       lifetime native value metered, written effects-last
 * @param amount           optional calldata-amount metering
 * @param amountSpent      lifetime metered amount, written effects-last
 * @param maxCalls         0 = unlimited; otherwise the lifetime call ceiling
 * @param callsUsed        calls consumed. ALWAYS increments on a successful check, including a
 *                         zero-value zero-amount call — a call is a use, and the alternative
 *                         makes `maxCalls` bypassable
 * @param pins             0..MAX_PINS pinned argument words
 */
struct NativeConfig {
    bool initialized;
    uint48 validUntil;
    address target;
    bytes4 selector;
    uint256 maxValuePerCall;
    uint256 maxValueTotal;
    uint256 valueSpent;
    AmountRule amount;
    uint256 amountSpent;
    uint32 maxCalls;
    uint32 callsUsed;
    ArgPin[] pins;
}

/**
 * @notice WIRE TYPE — what a NATIVE envelope's body encodes. Not a storage type.
 *
 * @dev    ABSENT BY DESIGN: `initialized`, `valueSpent`, `amountSpent` and `callsUsed` are all
 *         URP's own counters, zeroed at init. The SDK had to type four zeroes it did not own.
 *
 *         SPLIT EVEN THOUGH ONLY THE UNIVERSAL SIDE FORCES IT. The SDK builds both; one struct
 *         with dead input fields sitting beside one without is precisely the inconsistency that
 *         let a since-removed chain field acquire four different conventions in one repository.
 */
struct NativeTerms {
    uint48 validUntil;
    address target;
    bytes4 selector;
    uint256 maxValuePerCall;
    uint256 maxValueTotal;
    AmountRule amount;
    uint32 maxCalls;
    ArgPin[] pins;
}

// ───────────────────────── svm mode structs ─────────────────────────
//
// The third rulebook: a UNIVERSAL rules set whose destination is a `solana:*` chain. On Solana an
// outbound is ONE cross-program invocation — a target program, an ordered account list, and an
// instruction byte string — signed by the wallet's CEA (a PDA), not an EVM multicall. Every
// EVM-shaped gate (multicall walk, `address` target, `bytes4` selector, beneficiary word, per-entry
// value) is replaced by the shapes below. See `URP._checkSvm` for the gate list.

/**
 * @dev One allow-listed (program, instruction) pair.
 * @param program           Target program id, 32 bytes.
 * @param discriminator     Left-aligned instruction tag; only the first `discriminatorLen` bytes
 *                          are compared. 8 for Anchor (`sha256("global:<name>")[..8]`), 1 for
 *                          SPL-style instruction indexes.
 * @param discriminatorLen  1..8, or 0 iff `dataless`.
 * @param dataless          The instruction carries NO data. The only way to get a length-0 tag,
 *                          and it forces `ix_data` to be EMPTY at check time — so a rule can never
 *                          match an instruction its pins were not written for.
 * @param maxAccounts       0 = unbounded; otherwise the request's account count must EQUAL it.
 *                          Set to the IDL count for fixed-layout instructions so nothing can be
 *                          appended behind the pinned positions.
 */
struct AllowedProgram {
    bytes32 program;
    bytes8 discriminator;
    uint8 discriminatorLen;
    bool dataless;
    uint8 maxAccounts;
}

/**
 * @dev `accounts[accountIndex]` of a request matching rule `ruleIndex` must equal `expected`.
 *      The SVM counterpart of the EVM beneficiary pin: programs read accounts by POSITION, so a
 *      value-carrying position is pinned to an owner-committed key (the CEA, or one of its ATAs).
 */
struct SvmAccountPin {
    uint8 ruleIndex;
    uint8 accountIndex;
    bytes32 expected;
}

/// @dev How an `SvmDataPin` compares. Integers are LITTLE-ENDIAN (Borsh), `len` bytes wide.
enum SvmDataPinMode {
    EQ,
    GTE_LE,
    LTE_LE,
    RATIO_GTE_LE
}

/**
 * @dev A constraint on the `ix_data` of a request matching rule `ruleIndex`.
 *      - EQ            `ix_data[off : off+len] == expected[0 : len]`, `len` 1..32, raw bytes,
 *                      LEFT-ALIGNED: bytes of `expected` past `len` must be zero.
 *      - GTE_LE        `uintLE(ix_data[off : off+len]) >= uint256(expected)`, `len` 1..8,
 *                      RIGHT-ALIGNED integer: `expected` must fit in `len` bytes.
 *      - LTE_LE        `uintLE(ix_data[off : off+len]) <= uint256(expected)`, same encoding.
 *      - RATIO_GTE_LE  `uintLE(A) * den >= uintLE(B) * num`, A at `offset`, B at `offsetB`, both
 *                      `len` bytes and both addressed with the same `fromEnd`; `expected` unused;
 *                      `num` and `den` both non-zero.
 *                      This is the min-out floor RELATIVE to the input amount — a static floor on
 *                      the output alone is bypassed by an input equal to the whole balance.
 *      - fromEnd       `offset` counts back from the END of `ix_data` to the field's START.
 *                      Borsh serialises vectors before scalars, so trailing scalar arguments have
 *                      stable from-end offsets and unstable from-start ones. Requires
 *                      `offset >= len`.
 */
struct SvmDataPin {
    uint8 ruleIndex;
    bool fromEnd;
    uint16 offset;
    uint16 offsetB;
    uint8 len;
    SvmDataPinMode mode;
    bytes32 expected;
    uint64 num;
    uint64 den;
}

/**
 * @notice WIRE TYPE — what a `solana:*` UNIVERSAL envelope's body encodes. Not a storage type.
 *
 * @dev    ABSENT BY DESIGN, as in `UniversalTerms`: `initialized` and `spent` are URP's.
 *
 * @param validUntil        non-zero, in the future (enforced at init); "never" = type(uint48).max
 * @param expectedCEA       the wallet's CEA on the destination: `PDA(["push_identity", wallet],
 *                          gatewayProgram)`. Owner-committed — Solidity cannot derive a PDA.
 * @param gatewayProgram    the Push gateway program on the declared cluster. Owner-committed; the
 *                          SDK sources it from the chain registry. Forbidden as a target: that
 *                          route only returns the permitted asset to the owner's wallet, at the
 *                          owner's rate-limit and gas cost.
 * @param assets            1..MAX_ASSETS permitted PRC20s with their caps, exactly as `UniversalTerms`;
 *                          amounts are PRC20 base units (lamports / SPL base units), and a request's
 *                          amount must also fit Solana's u64 (S6b)
 * @param maxGasPerCall     Push-native per-call ceiling (protocol fee + gas swap budget), PC wei
 * @param ceaAccounts       every CEA-controlled account that HOLDS VALUE: the CEA, its ATA for EACH
 *                          listed asset, its ATAs for allowed outputs. At most MAX_CEA_ACCOUNTS (16,
 *                          the CEA included: room for all 8 assets plus 7 outputs). Each may appear in
 *                          a request ONLY at a position the matched rule pins to it; a listed account
 *                          no rule pins can never be passed at all. Unlisted accounts are not
 *                          protected — the list is the owner's statement of what is worth taking.
 *                          URP CANNOT CHECK that each listed asset's ATA is here (it cannot derive a
 *                          Solana token account, and does not know a PRC20's mint): listing them is
 *                          the SDK's job. Must contain `expectedCEA`; no zero, duplicate, or program
 *                          entries.
 * @param programs          the allow-list; first match wins, made exact by the init ambiguity rule.
 *                          ONE RULE PER (program, instruction), so ONE PINNED KEY PER POSITION: if a
 *                          swap rule pins its input to the USDC account, USDT can never be that
 *                          instruction's input. Using several listed tokens through one instruction
 *                          means leaving the input unpinned and those token accounts unlisted, so
 *                          only the output and price pins protect them. Multi-asset on Solana is
 *                          strongest when different tokens are used by different instructions.
 * @param pins              account pins, each naming its rule
 * @param dataPins          `ix_data` pins, each naming its rule
 */
struct SvmTerms {
    uint48 validUntil;
    bytes32 expectedCEA;
    bytes32 gatewayProgram;
    AssetCap[] assets;
    uint256 maxGasPerCall;
    bytes32[] ceaAccounts;
    AllowedProgram[] programs;
    SvmAccountPin[] pins;
    SvmDataPin[] dataPins;
}

/**
 * @dev The SVM rulebook — STORAGE type, lives inside `_svm`.
 * @param initialized  set once; re-initialisation is refused
 * @param assets       per-token caps and per-token `spent`, exactly as `Config.assets`
 */
struct SvmConfig {
    bool initialized;
    uint48 validUntil;
    bytes32 expectedCEA;
    bytes32 gatewayProgram;
    uint256 maxGasPerCall;
    AssetCapState[] assets;
    bytes32[] ceaAccounts;
    AllowedProgram[] programs;
    SvmAccountPin[] pins;
    SvmDataPin[] dataPins;
}
