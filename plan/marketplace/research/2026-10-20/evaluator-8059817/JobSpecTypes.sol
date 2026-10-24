// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title JobSpecTypes — the evaluation criteria of an ERC-8183 job
/// @notice One definition, shared by everything that writes or reads a job's criteria:
///         - UniversalMarketplace builds a `JobSpec` and stores `abi.encode(spec)` as the job's description;
///         - the UniversalHook decodes it at `fund` and freezes it;
///         - the UniversalEvaluator fires its reads and judges its checks and logic.
/// @dev - Source: `docs-internal/Universal Evaluator V2 Design`, plus `origin` (marketplace PRD decision Z7).
///      - Field order is ABI. Never reorder, never insert; a change here changes every description.

/// @notice How a check compares. BOOLEAN / COMPARE: the `left` side against `target` · NUMBER / PERCENTAGE: `left` against `right`.
enum Evaluation {
    BOOLEAN,
    COMPARE,
    NUMBER,
    PERCENTAGE
}

/// @notice The comparison operator: == != > >= < <=.
enum Operation {
    EQUAL,
    NOT_EQUAL,
    GREATER_THAN,
    GREATER_OR_EQUAL,
    LESS_THAN,
    LESS_OR_EQUAL
}

/// @notice One step of the pass logic. CHECK: one check · ALL / ANY / AT_LEAST: combine children.
enum LogicKind {
    CHECK,
    ALL,
    ANY,
    AT_LEAST
}

/// @notice Who may replace a job's criteria before it is funded: the provider in `setBudget`, the client in `fund`.
/// @dev - The flag is always the one in the `createJob` description; a replacement must carry the same flag.
///      - `BOTH` is the zero value, so a spec that never sets the flag can be replaced by either side.
enum AllowedMutability {
    BOTH,
    NONE,
    CLIENT,
    PROVIDER
}

/// @notice When a read is taken: after the provider's execution (at `submit`) or before it (at `fund`).
enum ReadAt {
    POST_EXECUTION,
    PRE_EXECUTION
}

/// @notice One contract call on one chain, at one moment, and which value in its answer to use.
struct Read {
    // namespace only ("eip155"), with chainId separate — the Read State split (AGW doc D6);
    // AgentCard.chainNamespace is the full CAIP-2 string
    string chainNamespace;
    string chainId; // e.g. "8453"
    uint16 minConfirmations; // confirmations this chain needs before the answer counts
    address target; // the contract to call
    bytes4 selector; // the view function
    bytes args; // abi-encoded arguments
    bytes outputs; // the function's return types, as T_* codes
    uint8[] field; // which returned value, by ABI position: [0] = 1st return value, [0, 2] = its 3rd field
    ReadAt at; // read at the block recorded at `fund` (PRE) or fixed at `submit` (POST)
}

/// @notice One comparison. Each side is the sum of its reads. BOOLEAN `left == target` · COMPARE `Σleft op target` ·
///         NUMBER `(Σleft - Σright) op target` · PERCENTAGE `(Σleft - Σright) / Σright op target`, in basis points.
struct Check {
    uint8[] left; // indexes into reads, increasing · BOOLEAN: exactly one
    uint8[] right; // indexes into reads, increasing, none in `left` · NUMBER / PERCENTAGE: at least one · BOOLEAN / COMPARE: none
    Evaluation evaluation;
    Operation operation;
    int256 target; // in the contract's own units
}

/// @notice One step of the pass logic. Children always have a higher index than their parent.
struct Logic {
    LogicKind kind;
    uint8 check; // CHECK only: index into checks
    uint8[] children; // ALL / ANY / AT_LEAST: indexes into logic, each greater than this entry's own
    uint8 k; // AT_LEAST only: how many children must pass
}

/// @notice A job's criteria. `logic[0]` is the root: the job passes if it passes.
struct JobSpec {
    uint64 executeBy; // the provider must execute before this
    uint64 failFinalAt; // a FAIL only counts from a verify started after this
    Read[] reads;
    Check[] checks;
    Logic[] logic;
    AllowedMutability allowedMutability; // who may replace these criteria before `fund`; marketplace jobs are NONE
    bytes32 origin; // keccak256(abi.encode(marketplace, cardId, cardVersion, principal)); opaque to hook and evaluator
}

// ─────────────────────────────── return-type codes (`Read.outputs`) ───────────────────────────────

uint8 constant T_UINT = 1;
uint8 constant T_INT = 2;
uint8 constant T_BOOL = 3;
uint8 constant T_ADDRESS = 4;
uint8 constant T_BYTESN = 5;
uint8 constant T_BYTES = 6;
uint8 constant T_STRING = 7;
uint8 constant T_TUPLE = 8;
uint8 constant T_ARRAY = 9;
uint8 constant T_FIXED_ARRAY = 10;

// ─────────────────────────────── limits ───────────────────────────────

uint256 constant MAX_READS = 32;
uint256 constant MAX_CHECKS = 16;
uint256 constant MAX_LOGIC = 32;
uint256 constant MAX_TERMS = 64; // read indexes across every check's sides; bounds a callback's work
