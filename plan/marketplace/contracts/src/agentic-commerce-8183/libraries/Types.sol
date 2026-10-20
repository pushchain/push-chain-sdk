// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetCap, AllowedCall, OwnerIntent} from "@push-agw/libraries/Types.sol";
import {Session} from "../interfaces/external/IAGW.sol";
import {Evaluation, Operation, Logic, AllowedMutability} from "./JobSpecTypes.sol";

/// @title Types — the UniversalMarketplace package's structs, enums and markers, file-level.
/// @dev - Cards, jobs and init: the marketplace (UniversalMarketplace, IUniversalMarketplace).
///      - `AgentCardRules`, `SessionContext`, the markers: the rules helper (UniversalMarketplaceRules).
///      - The criteria template: JobSpecBuilder. The built criteria (`JobSpec`) stay in JobSpecTypes.sol, the wire
///        format shared with the UniversalHook and the UniversalEvaluator.
///      - AGW types (`AssetCap`, `AllowedCall`, `OwnerIntent`, ...) are imported from AGW v6, never copied.

// ─────────────────────────────── markers (D2, D3) ───────────────────────────────
//
// Published constants: the SDK uses the same values. A card holds a marker; the signed session holds the value the
// marketplace fills in for this job. Both have non-zero high 96 bits, so neither is a clean address word.

/// @dev In a card: "the user's account (CEA) on the card's chain". EQ pins only.
///      keccak256("push.marketplace.marker.WALLET").
bytes32 constant MARKER_WALLET = 0x38beb8621ef19c2ac125b45b1ac07225511365301161eb56ac7a21aa8641cf5a;
/// @dev In a card: "this job's principal". Pins (EQ or MAX) and the principal asset's caps (as uint256).
///      keccak256("push.marketplace.marker.PRINCIPAL").
bytes32 constant MARKER_PRINCIPAL = 0xc12ba2e9bfe16dd303c04d7f517245a6b49fd69f9d0e5c82d14be8c18ef34d52;

// ─────────────────────────────── cards, jobs, init ───────────────────────────────

/// @notice One standing offer from one provider: one job type on one EVM execution chain. One card per provider.
/// @dev - `provider` and `active` are contract-written; caller values are ignored.
///      - `chainNamespace` is immutable after registration.
struct AgentCard {
    address provider; // msg.sender at registration · the rules agent · 8183 provider · fee recipient
    bytes32 jobType; // e.g. keccak256("LENDING_DEPOSIT")
    string metadataURI; // off-chain JSON: name, summary, ABIs, criteria in words, param units
    bytes32 metadataHash; // keccak256 of that JSON
    string chainNamespace; // full CAIP-2 execution chain, "eip155:<id>", never Push
    uint256 providerFee; // reference price in paymentToken; the client funds against it (not enforced on-chain)
    address paymentToken; // until the kernel's K-12, must equal KERNEL.paymentToken()
    uint256 principalMin; // the job's size, in the principal asset's units
    uint256 principalMax;
    uint32 minDuration; // job expiry window, seconds from openJob
    uint32 maxDuration;
    uint32 minExecuteWindow; // executeBy ≥ openJob time + this
    uint32 settleWindow; // failFinalAt = executeBy + this; executeBy + this ≤ expiredAt
    bool active;
}

/// @notice What the agent needs. Approvals are allowed calls under pins (D1); markers fill per job (D2, D3).
/// @dev `expectedCEA`, `validUntil` and the principal asset's caps are per job.
struct AgentCardRules {
    AssetCap[] assets; // 1..MAX_ASSETS PRC20s on Push, each SOURCE_CHAIN_NAMESPACE == card chain
    uint8 principalAsset; // index into assets; its maxTotal is MARKER_PRINCIPAL
    uint256 maxGasPerCall; // PC wei per outbound, copied to the session exactly
    AllowedCall[] allowedCalls; // 1..32; pins may hold MARKER_WALLET / MARKER_PRINCIPAL
}

/// @notice A destination chain's CEA factory and proxy implementation, for `computeCEA`.
struct CEADeployment {
    address ceaFactory;
    address ceaProxyImpl;
}

/// @notice The full card, for the SDK. One call.
struct AgentCardView {
    AgentCard card;
    bytes rules; // abi.encode(AgentCardRules)
    bytes jobSpecTemplate; // abi.encode(JobSpecTemplate)
    uint256 version;
    bool verified;
    bool disabled;
}

/// @notice Per-job inputs the owner signs (inside the createJob calldata and the session).
struct JobInputs {
    uint256 principal;
    uint48 expiredAt;
    uint48 executeBy;
    int256[] params; // one per template param, within its bounds
}

/// @notice Everything `openJob` needs.
struct OpenJobParams {
    uint256 cardId;
    uint256 cardVersion; // the version the owner signed against
    JobInputs job;
    Session session;
    OwnerIntent intent;
    bytes sig;
    string label; // wallet label, used only when deploying
}

/// @notice What `previewIntent` needs to build the OwnerIntent the owner signs.
struct IntentRequest {
    uint256 cardId;
    address owner;
    uint96 index;
    JobInputs job;
    uint48 deadline;
    uint256 signerChainId;
}

/// @notice `initialize` arguments. Every field must be non-zero.
struct InitParams {
    address agwFactory;
    address kernel;
    address hook; // must be whitelisted on the kernel
    address evaluator; // the marketplace-wide 8183 evaluator
    address rules; // UniversalMarketplaceRules
    address admin; // receives DEFAULT_ADMIN_ROLE and ADMIN_ROLE
}

// ─────────────────────────────── rules check (UniversalMarketplaceRules) ───────────────────────────────

/// @notice The per-job values `checkRulesMatchCard` checks the session against.
struct SessionContext {
    address agent; // card.provider
    bytes32 chainHash; // keccak256(bytes(card.chainNamespace))
    uint256 principal;
    uint48 expiredAt;
    address expectedCEA; // the AGW's CEA on the card's chain, derived by the marketplace
}

// ─────────────────────────────── a card's criteria template ───────────────────────────────
//
// The V2 JobSpec with holes. The card fixes everything that is the same for every job; `JobSpecBuilder.build`
// fills in the per-job values (the AGW's CEA, the principal, the user's params, the times).

/// @notice Where a fill's 32-byte word comes from. CEA = the AGW's CEA on the READ's chain.
enum FillSource {
    CEA,
    PARAM
}

/// @notice Overwrites `args[32·word : 32·word + 32]` per job. `param` is used by PARAM only.
struct Fill {
    uint8 word;
    FillSource source;
    uint8 param;
}

/// @notice A `Read` with fills. Copied into the JobSpec, then filled.
struct ReadTemplate {
    // namespace only ("eip155"), with chainId separate — the Read State split (AGW doc D6);
    // AgentCard.chainNamespace is the full CAIP-2 string
    string chainNamespace;
    string chainId; // e.g. "1"
    uint16 minConfirmations;
    address target;
    bytes4 selector;
    bytes args;
    Fill[] fills;
    bytes outputs;
    uint8[] field;
}

/// @notice Where a check's target comes from.
enum TargetSource {
    FIXED,
    PRINCIPAL_BPS,
    PARAM,
    CEA
}

/// @notice A `Check` whose target is a source. `value`: FIXED the target · PRINCIPAL_BPS bps of principal ·
///         PARAM a param index · CEA unused (the CEA of the check's read chain).
struct CheckTemplate {
    uint8 read;
    Evaluation evaluation;
    Operation operation;
    TargetSource source;
    int256 value;
}

/// @notice Inclusive bounds on one per-job number the user supplies.
struct ParamBounds {
    int256 min;
    int256 max;
}

/// @notice The whole template, stored on the card as `abi.encode(JobSpecTemplate)`. `logic` and
///         `allowedMutability` are copied verbatim.
struct JobSpecTemplate {
    ReadTemplate[] reads;
    CheckTemplate[] checks;
    Logic[] logic;
    AllowedMutability allowedMutability;
    ParamBounds[] params;
}

/// @notice The per-job values `build` fills in.
struct BuildContext {
    address agw;
    uint256 principal;
    uint48 executeBy;
    uint32 settleWindow;
    int256[] params;
    bytes32 origin;
}
