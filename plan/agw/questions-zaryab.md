# AGW SDK — remaining contract delivery items

Updated October 7, 2026. Product direction is settled; the SDK needs the label interface to finish integration. Freshly fetched `deploy-agw@10a24f1` and `pushAgenticWallet_v3@e8db748` still lack an editable-label interface.

<a id="z1"></a>
<a id="z1-3"></a>
## Editable wallet labels

`setLabel` will be fixed by Zaryab. Please share the implemented function/event ABI and compatible deployment so the SDK can enable owner-only label updates and verify subsequent reads. The current contracts expose only a deployment label.

<a id="h4-4"></a>
## Settled scope

Named IDL inputs are approved for public Solana authoring. Rule `ref` is removed. Zero native PC defaults and the existing token model are retained. Native/EVM inputs accept argument indexes or raw offsets, and reads preserve exact offsets. Existing contract validation rejects unauthorized actions and the SDK maps errors. AMBIGUOUS_RULE remains for multiple candidates; no automatic-selection contract change is requested.

[Inspected contract source](https://github.com/pushchain/push-agentic-wallets/blob/10a24f101e2e6e0a9b76517b29f5cdb1aa967796/src/AGW.sol#L823) · [Consumer SDK guide](../../packages/core/AGW.md).
