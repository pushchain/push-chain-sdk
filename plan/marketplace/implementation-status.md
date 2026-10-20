# Marketplace SDK implementation status

October 20, 2026 — SDK-only completion checkpoint on `feat/agw-sdk-v4`. [Completed SDK checklist and external boundary](sdk-readiness.md). No package was published.

## Coverage against SDK pages 6 and 7

| Documented API group | Implemented | Pending |
| --- | --- | --- |
| Marketplace user APIs | 7 / 7 | No scoped SDK implementation item; three external CEA rollout mismatches below |
| Provider/card management | 4 / 4 | No additional method placeholder |
| JobSpec/card-rule helpers | 9 / 9 | No scoped SDK implementation item |
| Kernel job APIs | 8 / 9 | `job.verify`: compatible evaluator/hook and canonical wire |
| **Named API entrypoints** | **28 / 29** | **1 contract-dependent placeholder** |

This is API coverage, not a claim that every future draft option is implemented. It follows deployed v2 where the draft differs (pinned agent approvals, immutable criteria, pUSDC). `job.cancel`, pure read preparation and constants are additional delivered surfaces. SDK-only implementation and acceptance within this boundary are complete. Evaluation facts in `status` remain unavailable until compatible contracts exist. Live principal/escrow/payout and origin bridging now pass; reference contract/delegated-wallet acceptance passes against real local contracts. Custom wallet vendors provide their own signer transport.

## Implemented

- `client.market`: card discovery/reads; simulated provider register/update; activation/card; independent CEA and JobSpec preview; simulation-backed OwnerIntent signing/open for native EOAs, deployed external EVM UEAs and reference ERC-1271/7702 owners; mined-input receipt recovery without re-signing, complete event/kernel/wallet/mapping proof; job mappings and active-wallet reads. Inputs are copied before asynchronous work.
- `client.market.deposit`: original opening/card-version recovery, including archive-less/same-block recovery bound to event hashes and transaction input; principal/fee/PC balance targets; combined shared-token requirements; explicit origin funding; confirmed receipts and incomplete-deposit recovery. Broadcast errors retain pending hashes and stop automatic retry. No retired owner-approval array or escrow acceptance is inferred.
- `client.job`: plain create; provider pricing; reviewed-budget acceptance, balances/allowances and native/AGW atomic funding; submit; status/list/watch with exact cursor, deduplication, retry, callback isolation and reorg stop; client cancel with recorded grant revocation; expiry/grace refunds, including while paused.
- `PushChain.utils.job`: pure authoring, builders, canonical v2 codecs, ABI-name/decimal descriptions; paid `previewJobSpec`, fee caps, nested decoding and three-state logic; authenticated request-ID resumption without new payment. Missing baselines/reads remain unknown. `client.universal.read.prepare` exposes the same pure adapter; resolved prepared objects can be sent directly. Raw EVM calldata is also supported.
- `PushChain.utils.market`: deployed four-field card rules, principal/wallet markers and pinned approvals. Destination-token resolution always uses the explicit card chain, including same-address native-token objects. Decoded unknown PRC20s remain explicit references. Unchanged legacy wire metadata is preserved; archive raw bytes for persistence.
- `AGENTIC.PRINCIPAL` and `AGENTIC.JOB` vocabulary/address table; public types/errors; source and compiled consumer guide checks. The API checker now canonicalizes equivalent string-literal quote syntax in emitted property names.

Binary JobSpec data in the kernel's Solidity string is handled as raw bytes while retaining the original createJob selector. Card versions, rules, origin and calldata are independently compared before signing. Plain jobs and historical card versions require an explicitly reviewed budget; the SDK does not silently adopt a re-quote.

Registry summaries do not decode an unverified provider's template. A malformed template therefore cannot break listing or prevent its provider from deactivating/updating the card. Full decoding/preview still refuses unsupported content.

## Current placeholders and delivery limits

| Surface | Current behavior / next requirement |
| --- | --- |
| Deposit execution boundary | Open/unexpired and unused enabled permission; authenticated state/event/input history required. PC target is not a whole-job quote. Live principal and BSC-origin inbound bridging pass; independent concurrent funding clients must coordinate. |
| Automatic evaluator / job.verify | Explicit capability error. Current evaluator is manual; the linked evaluator has a different ABI/wire. No baseline, frozen-spec or verdict data is invented. |
| Replacement criteria / non-NONE cards | Refused before writes. Expected-spec-hash acceptance must be delivered with compatible contracts before mutable negotiation. |
| Contract/delegated owners | Real reference ERC-1271 and compatible/incompatible 7702 acceptance passes; external EVM UEA transport passes live. Custom vendors supply their own signer transport. Incompatible signatures fail simulation before broadcast; undeployed external UEAs/missing typed signing fail before prompting. |
| Relayer, recurring jobs, ratings, non-EVM cards/evaluation | No successful placeholder or invented service. Remain outside this checkpoint. |

`job.cancel` revokes only the permission recorded for that marketplace job. It does not withdraw wallet deposits. Provider/evaluator terminal actions do not acquire owner cleanup authority. Plain jobs have no marketplace permission to infer. Nonzero live completion/payout uses fresh controlled evaluators on plain jobs; the marketplace's configured evaluator is unchanged. Native single/atomic broadcast failures retain their hashes, and an atomic broadcast can never trigger sequential fallback.

## Destination rollout mismatch

**BSC Testnet has passing live open/cancel coverage.** Preview fails closed with CEA_MISMATCH for the other three configured destinations:

| Chain | SDK factory | Marketplace factory |
| --- | --- | --- |
| Sepolia | `0x5E191fbBe22F8866C5e4250557664fCE760e8870` | `0x8ED594A83301FEc545fC6c19fc12cF7111777029` |
| Base Sepolia | `0x7e8CeeDA043ED1460540616103dD57581a66C856` | `0x0A75ca7736b488Eb41675ADc3b3156BACF659F55` |
| Arbitrum Sepolia | `0x65572FFa81c230360a8a53C1682C7f0Ee321E5E7` | `0x88DC189275078Cf509E4Cc773F089c8ad07b7EA2` |
| BSC Testnet | `0x3f1B16e0B072d472951C4563d29d3da6a3EE3Ce8` | same |

Both old/new factories in the first three chains answer and name the same gateway, but derive different accounts. The queried lower-case gateway ceaFactory getter reverted, so this review does not infer which deployment the live routing stack should use. [Read-only evidence](research/sdk-implementation-2026-10-20/cea-routing.json). Align the canonical route/marketplace configuration with Zaryab; do not change global SDK factories solely to make this guard pass.

## Acceptance

- **2,246 unit tests pass**, 12 existing skips; 18 cases added after the prior checkpoint.
- **11 real-stack fork E2Es pass**, adding valid/malformed ERC-1271, 7702 and same-block opening/history recovery. Fixtures compile from repo-owned source without another contract checkout. The fork's UEA submitting transport is native because Anvil has no Cosmos transport.
- **6 live cases pass across two serial runs**: three basic cases cover native/external open/cancel, receipt recovery, prepared paid reads and no-new-payment preview recovery; three funding cases cover actual deposits, native/AGW atomic escrow and manual-evaluator payouts, and BSC-origin principal bridging. Cards 4/5 are inactive; jobs 4/7/8/9 are Rejected with grants revoked and plain jobs 5/6 are Completed. Deposited/reserve/payout tokens are returned. Earlier read-only evidence remains separate.
- Build, library/spec/local types, compiled imports/declarations/package checks and source/built API comparison pass; changed production lint passes. The consumer guide's eight TS blocks typecheck. CI reporting now derives final success from completion counts while preserving the original Jest flag.

[Current validation and limits](research/sdk-independent-2026-10-20/README.md), [prior checkpoint](research/sdk-completion-2026-10-20/README.md), [first checkpoint](research/sdk-implementation-2026-10-20/README.md). All marketplace groups, including `marketplace-funding`, remain opt-in; default all selection is unchanged. Future checkpoints should append to the [running changelog](../SDK-CHANGELOG.md).
