# AGW SDK — contract delivery status

Updated October 7, 2026 after the v5 deployment. **No remaining standalone AGW contract question needs an answer from Zaryab.**

<a id="z1"></a>
<a id="z1-3"></a>
The label interface and compatible deployment are delivered in `deploy-agw@bd230d2` (deployed source `2e61e13`). The SDK now uses the new factory, reads stored labels and implements owner-only `setLabel` with empty reset and the 64-byte limit. [Deployment verification](research/deployment-review-2026-10-07-v5/README.md) · [SDK migration and acceptance](research/v5-implementation-2026-10-07/README.md).

<a id="h4-4"></a>
Named-IDL Solana authoring, removal of rule `ref`, zero native PC defaults and the existing token model remain settled. Native/EVM inputs accept argument indexes or raw offsets. The SDK retains AMBIGUOUS_RULE; the contract validates the supplied rule. No automatic-selection interface change is requested.

Push-core spend credit and bridge retry timing remain separate downstream follow-ups. They do not block the label integration.
