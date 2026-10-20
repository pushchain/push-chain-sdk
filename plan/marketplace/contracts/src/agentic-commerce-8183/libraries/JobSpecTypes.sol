// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title JobSpecTypes — the evaluation criteria of an ERC-8183 job
/// @notice One definition, shared by everything that writes or reads a job's criteria:
///         - UniversalMarketplace builds a `JobSpec` and stores `abi.encode(spec)` as the job's description;
///         - the UniversalHook decodes it at `fund` and freezes it;
///         - the UniversalEvaluator fires its reads and judges its checks and `logic`.
/// @dev - Source: `docs-internal/Universal Evaluator V2 Design`, plus `origin` (marketplace PRD decision Z7) and
///        `allowedMutability` (carried, not enforced, by the marketplace).
///      - Field order is ABI. Never reorder, never insert; a change here changes every description.

/// @notice How a check compares. BOOLEAN / COMPARE use the value now; NUMBER / PERCENTAGE use the change since the
///         baseline.
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

/// @notice How a logic step combines its checks and child steps.
enum LogicKind {
    ALL,
    ANY,
    AT_LEAST
}

/// @notice Who may propose a replacement JobSpec at setBudget. Carried, not enforced, by the marketplace.
enum AllowedMutability {
    NONE,
    CLIENT,
    PROVIDER,
    BOTH
}

/// @notice One contract call on one chain, and which value in its answer to use.
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
}

/// @notice One comparison on one read.
struct Check {
    uint8 read; // index into reads
    Evaluation evaluation;
    Operation operation;
    int256 target; // in the contract's own units
}

/// @notice One logic step. `logic[0]` is the root. `checks` index into checks; `children` index into logic,
///         each greater than this step's own index. `k` is used by AT_LEAST only.
/// @dev AT_LEAST: `k` of the step's checks and children together pass. The marketplace copies the array verbatim
///      and never evaluates it: the semantics are evaluator-owned.
struct Logic {
    LogicKind kind;
    uint8[] checks;
    uint8[] children;
    uint8 k;
}

/// @notice A job's criteria. `logic[0]` is the root: the job passes if it passes.
struct JobSpec {
    Read[] reads;
    Check[] checks;
    Logic[] logic;
    AllowedMutability allowedMutability; // copied from the card's template; not read in this repo
    bytes32 origin; // keccak256(abi.encode(marketplace, cardId, cardVersion, principal)); opaque to hook and evaluator
    uint64 executeBy; // the provider must execute before this
    uint64 failFinalAt; // a FAIL only counts from a verify started after this
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

uint256 constant MAX_READS = 16;
uint256 constant MAX_CHECKS = 16;
uint256 constant MAX_LOGIC = 32;
