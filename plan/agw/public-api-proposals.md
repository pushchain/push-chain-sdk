# AGW public API proposals for team review

**October 7 disposition:** named-IDL Solana authoring and dual native/EVM raw-offset/index inputs were approved and implemented (supported fixed layouts documented in the consumer guide). H6’s caller-selector proposal is not being implemented. The clarified decision retains AMBIGUOUS_RULE and relies on existing contract enforcement/error mapping; no automatic-selection contract change is requested. The sketches below preserve the proposal history; use current exported types and `packages/core/AGW.md` for implementation.

October 6, 2026. These are proposals for H4.4/H4.5/H6, not implemented public contracts. Native/EVM methods remain as implemented; public Solana capability stays gated. The [source recheck](research/question-source-recheck-2026-10-06/README.md) separates supplied wire definitions from these remaining SDK choices.

## H4.4 Solana rule inputs and decoded records

Recommend a Solana-specific member of Rule, selected by `chainNamespace: solana:*`. Keep the existing lifecycle methods and shared agent/expiry/asset/gas fields. Do not make callers supply the gateway or wallet CEA: resolve the configured cluster, derive the CEA and every protected input/output ATA internally.

For public authoring, recommend IDL instruction/account/field inputs. The SDK compiles them into the supplied program/account/data constraints. Explicit raw wire authoring is an alternative requiring agreement; it is already available internally for acceptance tests, not a root export.

The following is a proposed input sketch, not a current SDK example:

```ts
type SvmAddress = string; // validated base58, or explicitly supported 32-byte hex
type SvmAccountRef =
  | { kind: 'walletCEA' }
  | { kind: 'walletATA'; token: SvmAddress }
  | { kind: 'address'; address: SvmAddress };

interface SvmInstructionRule {
  program: SvmAddress;
  instruction: { idl: SvmIdl; name: string };
  accounts: { name: string; expected: SvmAccountRef }[];
  fields?: (
    | { name: string; equals: Hex | bigint }
    | { name: string; min: bigint }
    | { name: string; max: bigint }
    | { numerator: string; denominator: string; minRatio: { num: bigint; den: bigint } }
  )[];
}

interface SolanaRuleInput {
  agent: Address;
  chainNamespace: `solana:${string}`;
  validUntil: number;
  assets: { token: MoveableToken | SvmAddress; maxPerCall: bigint; maxTotal?: bigint }[];
  maxGasPerCall: bigint;
  outputTokens?: SvmAddress[];
  allowedInstructions: SvmInstructionRule[];
}
```

Output tokens are separate derivation inputs: they must contribute protected ATAs even if the rule only spends its input tokens. An output declaration is not a guarantee that the instruction pays it; the instruction's actual value-carrying accounts and relevant data fields still need pins.

Compilation requirements:

- Resolve instruction discriminators and exact account ordering from the selected IDL; pin the CEA and every value-carrying account. Refuse layouts that cannot be identified reliably.
- Record the source IDL hash in SDK evidence. There is no delivered grant ref/hash field to claim this is stored on-chain; durable metadata is a separate decision.
- Apply the delivered aggregate caps: 8 assets, 32 program entries, 16 account pins, 8 data pins and 16 protected CEA accounts. Each program entry needs a pin, so the aggregate pin cap can limit the practical instruction count below 32.
- Map fixed unsigned fields of at most eight bytes to GTE_LE/LTE_LE, exact byte values to EQ, and supported paired fields to RATIO_GTE_LE. Verify offsets from the actual layout; two variable-length regions are not guessed through.
- Preserve account/data constraints on reads. An on-chain discriminator/offset does not reconstruct an IDL or named field; a decoded record must use exact keys, indexes and offsets unless a separately verified IDL is supplied.
- Keep instruction execution on the normal sendTransaction surface after agreement. One SVM outbound contains one instruction; do not promise a destination instruction array the delivered wire format cannot represent.

Recommend `RulesRecord.rule` become a discriminated decoded union, including the stored SVM programs, account/data pins and protected accounts. Authoring and decoding should have distinct names; decoded records are not silently passed through the IDL authoring compiler. A conversion helper would need verified IDL/context. Public spend, revoked history and marketplace compilation remain excluded.

**Decision for Harsh/Zaryab:** adopt the IDL-authoring/explicit-decoded model above, or approve explicit raw constraints as a public authoring alternative. Base58/hex acceptance and non-Anchor instructions must be stated with the selected model. The SDK team will implement and test the selected representation; the delivered wire types do not need redesign.

## H4.5 Native/EVM raw authoring and decoding

The current implementation accepts both argument-index and raw-offset authoring, and always reads exact offsets. That is lossless and tested, but extends the latest page-5 shape. The historical SDK used offsets; it does not by itself approve the current public API.

Two concrete choices:

| Choice | Inputs | Decoded rules | Compatibility/work |
| --- | --- | --- | --- |
| Keep current dual form | `pins: {arg, expected}` or `{offset, expectedWord}`; amount uses arg or offset; EVM beneficiary uses argument index or beneficiaryOffset | Exact raw offsets/words | Smallest implementation delta; reads can round-trip into add/update. Caller-authored offsets lack ABI semantic validation. |
| Separate input/decoded forms | Public new authoring uses ABI argument indexes; raw wire values remain a decoded type | `DecodedNativeRule` / `DecodedEvmRule` retain exact offsets | More explicit validation boundary; changes RulesRecord.rule type and requires an explicit conversion/reuse story. |

If the current dual form is chosen, keep exact word validation and integer bounds, reject conflicting index/offset fields, and prefer ABI generation in examples. The SDK must not claim that an arbitrary raw offset pins a particular named argument.

If separate forms are chosen, do not reconstruct `arg = (offset - 4) / 32`: that assumes a layout that storage does not prove. Keep decoded values exact and specify how an owner reuses an existing rule with a verified ABI.

**Recommendation:** retain the tested dual form for this SDK revision if product accepts explicit low-level authoring. If public authoring must be ABI-only, use separate decoded records across native/EVM/SVM rather than losing wire information. This choice does not re-open H1's UI/marketplace-owned approval-screening policy.

## H6 Rule selection for sends

Recommend an explicit optional selector in per-send options. A single candidate still works without it; multiple candidates require an explicit ID. Selection is never cached at initialize and never based on remaining budget, expiry, grant order or trying several paid transactions.

Proposed examples, not current supported options:

```ts
await agent.universal.sendTransaction(
  { to: target, data },
  { agentic: { rulesId } },
);

await agent.universal.sendTransaction(
  { to: wallet, data: [nativeCallA, nativeCallB] },
  { agentic: { rulesIds: [idA, idB] } },
);
```

The exact containing options type is an implementation detail to align with core. The important public contract is one ID for a single action/outbound and an ordered ID list only for an outer native batch.

| Request | Selection |
| --- | --- |
| Single Push-native action | One optional rulesId |
| Native array | Ordered rulesIds, one per item; alternatively one rulesId reused for every item |
| EVM destination call array | One rulesId for the entire gateway outbound; no merging of permissions from different rules |
| SVM destination | One rulesId for the single instruction/outbound |

Validation before signing: the selected ID is currently enabled on the selected wallet, names the signer's Push identity and matches the destination chain. Refuse mixed selector forms, count mismatches and selector use outside the agent door. The on-chain policy remains the action/budget/expiry authority. A rule revoked after lookup still fails on-chain; a selector does not lock contract state.

Native batches retain sender-preserving UEA/7702 execution and atomic rollback. If several IDs are allowed in one batch, internal replay currently assumes one common ID and must be extended deliberately. Proposal: keep existing metadata.rulesId for a single/common ID and add ordered metadata.rulesIds only for a heterogeneous native batch. Preserve origin and raw transport fields.

**Decision for Harsh:** approve explicit per-send selection, including the native-array and metadata semantics above, or specify a deterministic automatic strategy. Current management permits multiplicity; current ambiguous sends fail before signing with candidate IDs.

## Boundaries

These proposals introduce public types/options and need agreement before being advertised. Internal wire-level tests can continue independently. H3's native PC omission defaults and token-model wording, plus Z1.3's ref/label release scope, remain separate. Nothing here adds compileCard, public accounting, historical reconstruction or a legacy adapter.
