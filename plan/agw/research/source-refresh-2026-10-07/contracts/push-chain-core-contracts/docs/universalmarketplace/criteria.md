# Universal Marketplace — Job criteria

How a card says what counts as "done", and how `startJob` turns that into one job's criteria. For where this fits
in the whole flow, see [`README.md`](./README.md) §7.

- [Two formats: template and JobSpec](#two-formats-template-and-jobspec)
- [The JobSpec](#the-jobspec)
- [The template](#the-template)
- [Building a JobSpec](#building-a-jobspec)
- [Worked example: a lending card](#worked-example-a-lending-card)
- [Worked example: a swap card with a user param](#worked-example-a-swap-card-with-a-user-param)
- [What the SDK must do](#what-the-sdk-must-do)

---

## Two formats: template and JobSpec

| | Template (`EvaluationTemplate`) | Criteria (`JobSpec`) |
|---|---|---|
| Where | stored on the card (`abi.encode`d, as given) | the 8183 job's `description` (`abi.encode(JobSpec)`) |
| Written by | the provider, once per card version | `JobSpecBuilder`, once per job |
| Holds | everything that is the same for every job, plus **holes** | concrete values for this job |
| Read by | the marketplace, at `startJob` / previews | the hook (at `fund`) and the evaluator (at verify) |
| Defined in | [`libraries/Types.sol`](../../src/agentic-commerce-8183/libraries/Types.sol) | [`libraries/JobSpecTypes.sol`](../../src/agentic-commerce-8183/libraries/JobSpecTypes.sol) |

The `JobSpec` is the format of the Universal Evaluator V2 design, plus one field, `origin`. JobSpecTypes is the one
definition shared by everything that writes or reads a job's criteria. Its field order is ABI: reordering or
inserting a field changes every description.

---

## The JobSpec

```solidity
struct JobSpec {
    uint64 executeBy;   // the provider must execute before this
    uint64 failFinalAt; // a FAIL only counts from a verify started after this
    Read[] reads;
    Check[] checks;
    Node[] nodes;       // nodes[0] is the root: the job passes if it passes
    bytes32 origin;     // keccak256(abi.encode(marketplace, cardId, cardVersion, principal))
}
```

### Reads: what to look at

```solidity
struct Read {
    string chainNamespace;    // namespace only, "eip155"
    string chainId;           // decimal, e.g. "11155111"
    uint16 minConfirmations;  // confirmations before the answer counts
    address target;           // the contract to call
    bytes4 selector;          // the view function
    bytes args;               // abi-encoded arguments
    bytes outputs;            // the function's return types, as type codes
    uint8[] field;            // which returned value, by ABI position
}
```

A read is one view call on one chain. **`chainNamespace` here is the namespace only** (`"eip155"`), with
`chainId` separate: the Read State split of the V2 design. That differs from `AgentCard.chainNamespace`, which is
the full CAIP-2 string `"eip155:<id>"`.

`outputs` describes the return types so the evaluator can find one value in the answer. Codes:

| Code | Type | Code | Type |
|---|---|---|---|
| 1 `T_UINT` | `uintN` | 6 `T_BYTES` | `bytes` |
| 2 `T_INT` | `intN` | 7 `T_STRING` | `string` |
| 3 `T_BOOL` | `bool` | 8 `T_TUPLE` | tuple / struct: followed by its field count, then each field's type |
| 4 `T_ADDRESS` | `address` | 9 `T_ARRAY` | `T[]`: followed by the element type |
| 5 `T_BYTESN` | `bytesN` | 10 `T_FIXED_ARRAY` | `T[k]`: followed by `k`, then the element type |

The top level is always a tuple of the return values. For example, `balanceOf(address) returns (uint256)` is
`[T_TUPLE, 1, T_UINT]`.

`field` is the path to the value: at a tuple, the field index; at an array, the element index. `[0]` is the first
return value; `[0, 2]` is the first return value's third field.

How the evaluator turns the selected value into a number (from the V2 design; a test-only copy of its decoder is
[`test/8183-tests/helpers/V2Decoder.sol`](../../test/8183-tests/helpers/V2Decoder.sol)):

| Leaf | Value compared |
|---|---|
| uint / int | the number (a uint above `int256.max` is "can't tell") |
| bool | 0 or 1 |
| address, bytesN | the raw word (compare with EQ / NEQ) |
| bytes, string | `keccak256` of the content |
| array | its length |

### Checks: what to compare

```solidity
struct Check {
    uint8 read;       // index into reads
    EvalType evalType;
    Op op;            // EQ, NEQ, GT, GTE, LT, LTE
    int256 target;    // in the contract's own units
}
```

| `EvalType` | Compares |
|---|---|
| `BOOL` | the value now, as a bool |
| `CMP` | the value now |
| `NUM` | the change since the snapshot the hook takes at `fund` (V2 UniversalHook) |
| `PCT` | the percentage change since that snapshot |

### Nodes: the pass logic

```solidity
struct Node {
    NodeKind kind;      // CHECK, ALL, ANY, AT_LEAST
    uint8 check;        // CHECK only: index into checks
    uint8[] children;   // ALL / ANY / AT_LEAST: indexes into nodes, each greater than this node's own
    uint8 k;            // AT_LEAST only: how many children must pass
}
```

`nodes[0]` is the root. `ALL` is AND, `ANY` is OR, `AT_LEAST k` is any `k` of the children. Children always have
a higher index than their parent, so the tree has no cycles and can be evaluated from the last node to the first.

### Timing

- **`executeBy`**: the provider must have executed by then.
- **`failFinalAt = executeBy + card.settleWindow`**: a FAIL verdict only counts from a verify started after this,
  so slow settlement on the destination chain is not misread as failure.

The marketplace guarantees `executeBy ≥ now + minExecuteWindow` and `failFinalAt ≤ expiredAt` (`startJob` step 5).

### `origin`

`keccak256(abi.encode(marketplace, cardId, cardVersion, principal))`. The hook and evaluator ignore it. It ties
the job to the card version it was started from, and it is what makes an intent signed against one version
unusable on another: the version is inside the signed calldata.

---

## The template

```solidity
struct EvaluationTemplate {
    ReadTemplate[] reads;
    CheckTemplate[] checks;
    Node[] nodes;          // copied verbatim
    ParamBounds[] params;  // one entry per per-job number the user supplies
}
```

### ReadTemplate: a Read with fills

```solidity
struct ReadTemplate {
    string chainNamespace;   // "eip155"
    string chainId;
    uint16 minConfirmations;
    address target;
    bytes4 selector;
    bytes args;              // with placeholder words
    Fill[] fills;            // what to write into args per job
    bytes outputs;
    uint8[] field;
}

enum FillSource { CEA, PARAM }

struct Fill {
    uint8 word;          // overwrites args[32·word : 32·word + 32]
    FillSource source;
    uint8 param;         // PARAM only: index into the job's params
}
```

| Fill source | Word written |
|---|---|
| `CEA` | the AGW's CEA **on this read's chain**, as a 32-byte word |
| `PARAM` | the job's `params[param]`, as a 32-byte word (two's complement for negatives) |

A CEA fill is how criteria name "this user's account": `balanceOf(CEA)`, `ownerOf(tokenId) == CEA`, and so on.
The CEA is derived per read chain, so one template can read two chains, each with that chain's CEA.

### CheckTemplate: a Check with a target source

```solidity
enum TargetSource { FIXED, PRINCIPAL_BPS, PARAM, CEA }

struct CheckTemplate {
    uint8 read;
    EvalType evalType;
    Op op;
    TargetSource source;
    int256 value;
}
```

| Source | `value` means | Target |
|---|---|---|
| `FIXED` | the target | `value` |
| `PRINCIPAL_BPS` | basis points of the principal | `principal × value / 10 000`, rounded down |
| `PARAM` | an index into the job's params | `params[value]` |
| `CEA` | unused | the AGW's CEA on the check's read chain, as `int256(uint160(cea))` |

`PRINCIPAL_BPS` is how criteria scale with the job's size ("at least 99.99% of the principal arrived").

### ParamBounds: per-job numbers

```solidity
struct ParamBounds { int256 min; int256 max; }   // inclusive
```

A template may declare numbers the user picks per job (a minimum swap output, a tick range, …). The job supplies
exactly one value per entry, each inside its bounds. The values feed `PARAM` fills and `PARAM` targets. Units are
the provider's, described in the card's metadata.

---

## Building a JobSpec

[`JobSpecBuilder.build`](../../src/agentic-commerce-8183/libraries/JobSpecBuilder.sol), called at `startJob`
step 9 and by both preview views:

1. **Decode** the template. Undecodable bytes revert in `abi.decode`.
2. **Params**: `params.length == template.params.length`, else `ParamCountMismatch(expected, actual)`; each
   `min ≤ params[i] ≤ max`, else `ParamOutOfRange(i, value)`.
3. **CEAs**: for each read with a CEA fill, and each read a `CEA`-target check names, get
   `expectedCEAOf(agw, keccak256(namespace ":" chainId))` from the marketplace, once per read. A chain without a
   CEA deployment reverts `ChainNotSupported(chainHash)`.
4. **Reads**: copy each read; copy its `args` into a fresh buffer; apply each fill. A fill must satisfy
   `32·word + 32 ≤ args.length`, else `FillOutOfBounds(read, fill)`. This bound check is what makes the one
   inline-assembly `mstore` safe.
5. **Checks**: copy `read`, `evalType`, `op`; resolve the target. For `PRINCIPAL_BPS`, if
   `principal > type(uint256).max / bps`, revert `TargetOverflow(check)`. Once the product fits, the quotient is at
   most `uint256.max / 10 000`, which always fits in `int256`, so the cast cannot truncate.
6. **Nodes** copied verbatim. `executeBy`, `failFinalAt = executeBy + settleWindow`, `origin`.
7. Return `abi.encode(spec)`.

**Not checked:** whether the criteria make sense or can be run. That covers caps on the number of reads, checks
or nodes; outputs that are not valid type codes; fields that point nowhere; reads no check uses; unreachable
nodes; and trivially true criteria. All of these build as given (`test_JB08_doesNotJudgeTheTemplate`). The caps
`MAX_READS` (16), `MAX_CHECKS` (16) and `MAX_NODES` (32) in JobSpecTypes are the evaluator's, not enforced here.
An out-of-range index (a check's `read`, a fill's `param`, a `PARAM` target) panics. Anything that reverts here
makes `startJob` and both previews of that card revert.

The result is deterministic for a given card version, job inputs and CEA configuration
(`testFuzz_JB11_deterministic`).

---

## Worked example: a lending card

"Deposit the principal into Aave v3 on Sepolia, at a supply rate of at least 4%." This is the test fixture's card
(`_lendingTemplate` in [`UniversalMarketplace.t.sol`](../../test/8183-tests/UniversalMarketplace.t.sol)) and the V2
design doc's lending example.

**Card:** `chainNamespace = "eip155:11155111"`, `settleWindow = 2 h`.

**Rules:** asset pUSDC (Sepolia); one allowed call `Pool.supply(address,uint256,address,uint16)` with the
beneficiary (`onBehalfOf`) pinned at offset 68; one approval, USDC → Pool, `capIsPrincipal`.

**Template:**

```
reads[0]  eip155 / 11155111, 12 confirmations
          aUSDC.balanceOf(address)          args = 32 zero bytes   fills = [word 0 ← CEA]
          outputs = [TUPLE 1, UINT]         field = [0]
reads[1]  eip155 / 11155111, 12 confirmations
          Pool.getReserveData(address)      args = abi.encode(USDC) fills = []
          outputs = [TUPLE 1, TUPLE 15, (TUPLE 1, UINT), UINT×7, ADDRESS×4, UINT×3]
          field = [0, 2]                    (the struct's 3rd field: currentLiquidityRate)
checks[0] read 0, CMP, GTE, PRINCIPAL_BPS, 9999     "deposited ≥ 99.99% of principal"
checks[1] read 1, CMP, GTE, FIXED, 0.04e27          "rate ≥ 4% (ray)"
nodes     [ ALL(1, 2), CHECK 0, CHECK 1 ]
params    []
```

**A job:** principal 500 USDC (`500e6`), `executeBy = now + 1 h`, for wallet 0 of the user.

**Built JobSpec:**

```
reads[0].args   = abi.encode(CEA(agw, "eip155:11155111"))
checks[0].target = 500e6 × 9999 / 10 000 = 499 950 000
checks[1].target = 0.04e27
nodes           = [ ALL(1, 2), CHECK 0, CHECK 1 ]
executeBy       = now + 1 h
failFinalAt     = now + 3 h
origin          = keccak256(abi.encode(marketplace, cardId, 1, 500e6))
```

The evaluator later passes the job if both checks pass: the CEA's aUSDC balance is at least 499.95 USDC, and
Aave's current supply rate is at least 4%.

`test_MC01_lendingExample_equalsV2Doc` builds the same template on Ethereum (the design doc's chain) and compares
the result, field by field, with the V2 design doc's hand-written JobSpec.

## Worked example: a swap card with a user param

"The CEA receives at least `minOut` WETH." `minOut` is chosen by the user per job.

```
reads[0]  eip155 / 11155111, 3 confirmations
          WETH.balanceOf(address)   args = 32 zero bytes   fills = [word 0 ← CEA]
          outputs = [TUPLE 1, UINT]  field = [0]
checks[0] read 0, NUM, GTE, PARAM, 0       "balance grew by ≥ params[0]"
nodes     [ CHECK 0 ]
params    [ {min: 1, max: 1e30} ]
```

A job with `params = [0.38e18]` gets `checks[0].target = 0.38e18`. `NUM` compares the change since the snapshot
the V2 UniversalHook takes at `fund`, so WETH the CEA already held doesn't count. (The interim RulesBindingHook
takes no snapshot; `NUM` and `PCT` checks need the V2 hook.) A job with `params = [0]` reverts
`ParamOutOfRange(0, 0)`; one with no params reverts `ParamCountMismatch(1, 0)`.

---

## What the SDK must do

- **Build templates from ABIs**: `outputs` and `field` from the function's ABI and the chosen return field, and
  CEA fills where the CEA appears in the arguments.
- **Render every check in words before the user signs.** The template is not judged on-chain; what the user sees
  is their protection, together with the verified tag.
- **Use `previewIntent`** to get the exact intent to sign, so the signed calldata hash covers the built criteria.
- **Derive the CEA independently** from the destination `CEAFactory` for the session's `expectedCEA`, and treat a
  disagreement with `expectedCEAOf` as an error.
