# AGW SDK — questions for Harsh

Updated October 6, 2026 after Harsh’s reply. Numbers 2–5 below match the chat questions; existing H IDs are retained for tracking.

**Question 1 — native PC defaults:** Harsh now prefers `0` for omitted `maxValuePerCall` and `maxValueTotal`, with Zaryab invited to comment. The SDK already uses `0`, so no behavior change is needed. These fields limit native PC value attached to agent calls; they do not set the sender’s transaction gas budget.

<a id="h3"></a>

## 2. What should “tokens independent” mean? — H3, Harsh

**Where this came from:** your comment on the [validation paragraph in 5. SDK: AGW](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9#af9c3fac35d94f2585cb27310271c1d8), recorded during our October 5 comment review:

> “we usually want the tokens to be independent and not attached to this”

**Current model:** the owner grants one rule containing an `assets[]` list and an allowed-call list. Each asset has its own outbound amount limits. For example:

| Asset | Maximum per outbound | Maximum total under this rule |
| --- | --- | --- |
| USDC | 10 | 100 |
| USDT | 20 | 200 |

After an outbound spends 10 USDC, the USDC budget has 90 remaining; the USDT budget still has 200. These are illustrative token units; SDK amounts use base-unit integers.

The allowed calls might be `swap()` and `deposit()`. The rule does not associate one token exclusively with one call: either listed asset may be used with either allowed call, provided the request satisfies the other policy checks. These limits do not automatically constrain every token movement performed inside a destination contract.

**Decision needed:** did you mean that each token should have its own budget, which this model already supports? Or should token permissions live outside the rule entirely? If you meant something else, one intended developer example would help us distinguish it. We propose retaining the current `assets[]` model until that is clarified.

<a id="h4-4"></a>

## 3. How should developers describe a Solana rule? — H4.4, Zaryab

Harsh redirected this question to Zaryab. The contract’s Solana constraint format is available; we need to agree on the developer-facing input the SDK compiles into that format.

**Example intent:** “Allow the agent to call a vault’s `deposit` instruction, only for Alice’s specified destination account, with an amount no greater than 10.” There are two ways a developer could express this:

| Option | What the developer supplies | What the SDK does |
| --- | --- | --- |
| Named inputs using an IDL | Program address, IDL (the program’s interface description), instruction name `deposit`, named accounts and constraints on fields such as `amount` | Resolves the discriminator, account positions and data offsets from the supported IDL layout, then builds the contract constraints |
| Explicit raw constraints | Program address, instruction discriminator, account positions/expected addresses, and data byte offsets/comparisons | Validates and encodes the supplied constraints without requiring an IDL |

In both options, the SDK derives the wallet’s destination CEA and protected token accounts internally. Reading a stored rule returns its exact constraints; the contract does not store the original IDL or field names.

**Recommendation:** support named IDL inputs for layouts the SDK can verify. Unsupported layouts must fail clearly rather than guess offsets.

**Decision needed from Zaryab:** should v1 expose IDL-based inputs, raw constraints, or both? If both, raw input should be an explicit advanced form. [Proposed types and boundaries](public-api-proposals.md#h44-solana-rule-inputs-and-decoded-records).

<a id="h4-5"></a>

## 4. What should rule inputs and reads expose? — H4.5, Harsh

**Example:** a developer wants to restrict `transfer(address recipient, uint256 amount)` to Alice. The convenient input is:

```ts
pins: [{ arg: 0, expected: alice }]
```

`arg: 0` means the first function argument. For this function’s ABI layout, the SDK converts it to byte offset `4`, immediately after the four-byte function selector. The second argument, `amount`, starts at offset `36`.

**The read-back problem:** the contract stores offsets and exact values, without the original ABI. Therefore `rules.get()` returns a pin shaped like:

```ts
pins: [{ offset: 4, expected: aliceAs32ByteWord }]
```

Here `aliceAs32ByteWord` is Alice’s address padded to a 32-byte ABI word. An offset is not an argument number; arbitrary ABI layouts cannot be reconstructed just by dividing the offset by 32.

**Decision needed:** which public model do you want?

| Option | Creating a rule | Reusing a rule returned by `rules.get()` |
| --- | --- | --- |
| Both input forms — recommended | Accept either `arg` or an explicit `offset`; reject conflicting forms | Exact decoded offsets can be reused in `rules.add/update` |
| Separate input and read types | New authoring accepts ABI argument indexes only | Return a distinct decoded type; require a defined conversion using a verified ABI before reuse |

The first option is already implemented and tested, but extends the spec’s public input shape and needs approval. In either option, reads preserve exact stored offsets. The same issue applies to native amount limits and EVM beneficiary constraints. [Detailed options](public-api-proposals.md#h45-nativeevm-raw-authoring-and-decoding).

<a id="h6"></a>

## 5. Who chooses the rule for an agent transaction? — H6, Harsh

**Example:** the same agent has two enabled rules on the same wallet and chain:

| Rule | Permission |
| --- | --- |
| A | Call app A within its configured limits |
| B | Call app B within its configured limits |

The agent now wants to call app A. Currently the SDK sees two candidate rules and returns `AMBIGUOUS_RULE` before signing. It does not simulate every rule to choose one, even when only one would permit the requested call.

**Proposal:** let the caller identify the intended rule. The following is proposed syntax, not currently supported:

```ts
await agent.universal.sendTransaction(
  { to: appA, data },
  { agentic: { rulesId: ruleA } }
);
```

The SDK checks that the selected rule belongs to this wallet, agent and destination chain and is enabled. The contract still enforces its permissions, expiry and budgets.

For a native batch `[callAppA, callAppB]`, propose ordered IDs `[ruleA, ruleB]`, one per action, with atomic execution. An EVM destination call array uses one rule for the whole outbound; permissions from different rules are not combined. If there is only one candidate, existing sends continue to work without an explicit ID.

**Decision needed:** approve explicit rule selection, or specify an automatic selection policy. For example, if two rules both permit the same call but have different remaining budgets, which should the SDK consume? We recommend explicit selection so the caller controls this choice. [Detailed proposal](public-api-proposals.md#h6-rule-selection-for-sends).

[SDK spec](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) · [Questions for Zaryab](questions-zaryab.md)
