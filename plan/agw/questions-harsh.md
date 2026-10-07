# AGW SDK — product decisions confirmed

Updated October 7, 2026 from Shoaib’s relayed team answers and SDK-owned decision approval. There are no remaining product questions in this document.

<a id="h3"></a>
## 1–2. Defaults and token model

Omitted native `maxValuePerCall` and `maxValueTotal` are `0`: no native PC value allowance. Retain the current `assets[]` model and independent per-token budgets. The SDK matches these decisions.

<a id="h4-4"></a>
## 3. Solana rules

Use named inputs from an IDL. The SDK now exposes `SolanaRule`, compiles supported Anchor layouts, derives wallet accounts, and returns exact decoded constraints. Unsupported layouts fail explicitly. See the [consumer guide](../../packages/core/AGW.md#solana-rules-using-named-idl-inputs).

<a id="h4-5"></a>
## 4. Native/EVM argument restrictions

Keep both ABI argument-index and raw-offset inputs, with exact offsets on reads. Shoaib approved this SDK-owned choice. Inputs that specify both forms are rejected; normal examples should prefer argument indexes.

<a id="h6"></a>
## 5. Contract validation and SDK errors — clarified

The intended behavior is that the existing contract rejects unauthorized functions/actions under the supplied rule, and the SDK maps those errors. This does not request automatic rule selection or a new contract interface. The SDK retains `AMBIGUOUS_RULE` when multiple enabled rules match the agent and chain, without submitting a transaction. No caller-facing rule selector is being added.

Rule `ref` is removed from scope; editable labels remain pending contract delivery. [Zaryab delivery items](questions-zaryab.md).
