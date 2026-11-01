# 8. SDK: Universal Evaluation

<aside>
⚖️

**Where we are going.** Criteria are data, written once by the card author, resolved at compile, judged by the evaluator with no job-type code anywhere. The SDK builds, encodes, previews and tracks them; it never judges.

**What this page is.** The `client.evaluation` namespace over the UniversalEvaluator and the criteria schema on page 4. Examples first, types second.

**How to read.** Card author side (build, encode, preview), job side (status, wait, verdict), types, open.

**Depends on.** Page 4 schema. Deterministic lane only in v1; PERIODIC sampling reserved and refused.

</aside>

# 1. Card author side, by example

A template with placeholders. `ACCOUNT` is the user's account on the read's chain (the AGW's CEA on EVM); `PRINCIPAL` is the funded amount.

```tsx
const { criteria } = PushChain.CONSTANTS.EVALUATION;

const template = client.evaluation.criteria.build({
  minDuration: 7 * 86400,
  conditions: [
    // 4% on principal over the job, measured on the aToken balance
    { read:   { chain: READ.CHAIN.ETHEREUM_SEPOLIA, type: 'CONTRACT_CALL', target: aUSDC, call: 'balanceOf(address)', args: ['ACCOUNT'], result: 'UINT' },
      sample: 'START_AND_END',
      cmp:    { op: 'GTE', basis: 'PCT', value: 400n } },
    // nothing left idle on the destination chain
    { read:   { chain: READ.CHAIN.ETHEREUM_SEPOLIA, type: 'CONTRACT_CALL', target: usdcSepolia, call: 'balanceOf(address)', args: ['ACCOUNT'], result: 'UINT' },
      sample: 'END',
      cmp:    { op: 'LTE', basis: 'ABSOLUTE', value: parseUnits('1', 6) } },
  ],
});

client.evaluation.criteria.validate(template);            // limits: 8 conditions, 512 bytes calldata, PERIODIC refused, solana result types
client.evaluation.criteria.encode(resolved);              // Hex, abi.encode(Criteria)
client.evaluation.criteria.hash(resolved);                // keccak of the encoding
client.evaluation.criteria.decode(bytes);                 // Criteria, from a job's description
```

Preview before anyone signs: resolve placeholders and dry-run the reads today, locally, so the author sees what the evaluator will see.

```tsx
const resolved = client.evaluation.criteria.resolve(template, { account: ceaOnSepolia, principal: parseUnits('1000', 6) });
const dry = await client.evaluation.criteria.simulate(resolved);   // uses universal.readState now; not the verdict, a sanity check
dry.conditions[0];   // { start?: value, end: value, pass: boolean, note?: 'PCT with zero START fails' }
```

# 2. Job side, by example

```tsx
const s = await client.evaluation.status(jobId);
// { registered: true, started: true, startValues: [...], endValues?: [...], verdict?: 'PASS' | 'FAIL', reason? }

await client.evaluation.waitForStart(jobId, { timeoutMs });        // resolves on PreRecorded(jobId)
const stop = client.evaluation.watch(jobId, (e) => { /* StartRead, PreRecorded, EndRead, Verdict */ });

await client.evaluation.refireStart(jobId, { condition: 0 });      // a START read errored or expired; caller pays the read fee
await client.evaluation.verdict(jobId);                             // { result, reason, txHash } once complete or reject landed
```

# 3. Types

```tsx
interface EvaluationNamespace {
  criteria: {
    build(input: CriteriaInput): Criteria;                 // typed sugar over the raw struct; selectors as signature strings, args by name
    validate(c: Criteria): void;                           // throws EvaluationError with the offending condition index
    resolve(c: Criteria, ctx: { account: Address | Hex; principal: bigint }): Criteria;
    encode(c: Criteria): Hex;
    decode(bytes: Hex): Criteria;
    hash(c: Criteria): Hex;
    simulate(c: Criteria, opts?: { atBlock? }): Promise<SimulationResult>;
  };
  status(jobId: bigint): Promise<EvaluationStatus>;
  verdict(jobId: bigint): Promise<Verdict | undefined>;
  waitForStart(jobId: bigint, opts?: { timeoutMs?: number }): Promise<void>;
  refireStart(jobId: bigint, opts: { condition: number }): Promise<TxResponse>;
  watch(jobId: bigint, cb: (e: EvaluationEvent) => void): () => void;
}

// mirrors page 4 one to one
interface Criteria { version: 1; minDuration: number; conditions: Condition[] }
interface Condition { read: Read; sample: Sample; cmp: Compare }
interface Read {
  chain: ReadChain;                                        // READ.CHAIN.*: eip155 chains, solana chains, PUSH (local, no fee), WEB2
  type: 'ACCOUNT_BALANCE' | 'CONTRACT_CALL' | 'STORAGE_SLOT';
  target: Address | Hex;                                   // 20 bytes EVM, 32 bytes SVM
  callData?: Hex;                                          // CONTRACT_CALL; placeholders resolved at compile
  word?: number;                                           // which 32-byte word of the return
  result: 'UINT' | 'INT' | 'BOOL' | 'ADDRESS' | 'BYTES32';
}
type Sample = 'END' | 'START_AND_END' | 'PERIODIC';       // PERIODIC refused by the v1 evaluator
interface Compare {
  op: 'EQ' | 'NEQ' | 'GT' | 'GTE' | 'LT' | 'LTE' | 'IS_TRUE' | 'IS_FALSE';
  basis: 'ABSOLUTE' | 'DELTA' | 'PCT' | 'REF';
  value: bigint;                                           // bps when basis is PCT
  ref?: number;                                            // condition index when basis is REF
}

type Placeholder = 'ACCOUNT' | 'PRINCIPAL';

interface EvaluationStatus {
  registered: boolean;  started: boolean;
  startValues?: (bigint | boolean)[];  endValues?: (bigint | boolean)[];
  verdict?: 'PASS' | 'FAIL';  reason?: string;
}
interface Verdict { result: 'PASS' | 'FAIL'; reason: string; txHash: Hex; perCondition: { pass: boolean; start?: bigint; end: bigint }[] }
interface SimulationResult { conditions: { start?: bigint | boolean; end: bigint | boolean; pass: boolean; note?: string }[]; pass: boolean }
interface EvaluationEvent { jobId: bigint; kind: 'StartRead' | 'PreRecorded' | 'EndRead' | 'Verdict'; condition?: number; txHash: Hex }

PushChain.CONSTANTS.EVALUATION[PUSH_NETWORK.TESTNET_DONUT] = {
  UNIVERSAL_EVALUATOR, MAX_CONDITIONS: 8, MAX_CALLDATA: 512, MAX_CHAIN_STRING: 32, SCHEMA_VERSION: 1,
};

class EvaluationError extends AgenticError { condition?: number }   // PERIODIC_UNSUPPORTED, TOO_MANY_CONDITIONS, UNRESOLVED_PLACEHOLDER, SOLANA_RESULT_TYPE
```

# 4. Open for review

1. `simulate` runs the reads through `universal.readState` today. That is the real read path, so it costs read fees unless we add a free local eth_call fallback for the preview. Decide: paid but faithful, or free but approximate.
2. `refireStart` pays the read fee from the caller. Who should be allowed: anyone (page 4 says anyone) or client and provider only.
3. `build` sugar (named args, signature strings) means the SDK carries ABI encoding for criteria the same way it does for rules. Same dependency, one implementation.
4. `status.started` reads the evaluator's `PreRecorded`; if storage moves to the hook (page 4 open item 1) the read target changes, the surface does not.
5. Annualisation of PCT is a card-level convention in v1. If the evaluator learns to annualise later, `Compare` gains a flag; `build` can accept `annualised: true` now and refuse until then.