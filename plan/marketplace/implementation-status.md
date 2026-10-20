# Marketplace SDK implementation status

October 20, 2026 — deposit, preview and external-owner checkpoint on `feat/agw-sdk-v4`. This supersedes the first checkpoint's deposit/paid-preview/external-EVM placeholders. No package was published.

## Coverage against SDK pages 6 and 7

| Documented API group | Implemented | Pending |
| --- | --- | --- |
| Marketplace user APIs | 7 / 7 | Broader route acceptance; three CEA rollout mismatches below |
| Provider/card management | 4 / 4 | No additional method placeholder |
| JobSpec/card-rule helpers | 9 / 9 | Additional paid-read/source/output acceptance remains useful |
| Kernel job APIs | 8 / 9 | `job.verify`: compatible evaluator/hook and canonical wire |
| **Named API entrypoints** | **28 / 29** | **1 contract-dependent placeholder** |

This is API coverage, not a release-readiness percentage or a claim that every draft option is implemented. It follows deployed v2 where the draft differs (pinned agent approvals, immutable criteria, pUSDC). `job.cancel`, pure read preparation and constants are additional delivered surfaces. Evaluation facts in `status` remain explicitly unavailable. Full live principal/escrow/protocol execution and arbitrary contract-wallet acceptance are separate validation work.

## Implemented

- `client.market`: card discovery/reads; provider register/update/setActive/card; independently checked CEA and JobSpec preview; simulation-backed OwnerIntent signing/open for native EOAs and deployed external EVM UEAs; job mappings and active-wallet reads.
- `client.market.deposit`: original opening event/card-version recovery, principal/fee/PC balance targets, combined shared-token requirements, explicit registered-origin funding, confirmed step receipts and incomplete-deposit recovery. Broadcast errors retain pending hashes and stop automatic retry. No retired owner-approval array or escrow acceptance is inferred.
- `client.job`: plain create; provider pricing; explicit-budget acceptance, balances/allowances and atomic AGW funding; submit; status/list/watch; client cancel with recorded marketplace permission revocation; expiry/grace refunds, including while paused.
- `PushChain.utils.job`: pure EVM read authoring, complete/template builders, canonical v2 codecs and descriptions; paid `previewJobSpec` through universal reads, fee cap, output-layout decoding and three-state logic. Missing baselines/reads remain unknown. `client.universal.read.prepare` exposes the same pure authoring adapter; async prepareRead/read now also accept explicit raw EVM calldata.
- `PushChain.utils.market`: deployed four-field card rules, principal/wallet markers and pinned approvals. Destination-token resolution always uses the explicit card chain, including same-address native-token objects. Decoded unknown PRC20s remain explicit references. Unchanged legacy wire metadata is preserved; archive raw bytes for persistence.
- `AGENTIC.PRINCIPAL` and `AGENTIC.JOB` vocabulary/address table; public types/errors; source and compiled consumer guide checks. The API checker now canonicalizes equivalent string-literal quote syntax in emitted property names.

Binary JobSpec data in the kernel's Solidity string is handled as raw bytes while retaining the original createJob selector. Card versions, rules, origin and calldata are independently compared before signing. Plain jobs and historical card versions require an explicitly reviewed budget; the SDK does not silently adopt a re-quote.

Registry summaries do not decode an unverified provider's template. A malformed template therefore cannot break listing or prevent its provider from deactivating/updating the card. Full decoding/preview still refuses unsupported content.

## Current placeholders and delivery limits

| Surface | Current behavior / next requirement |
| --- | --- |
| Deposit acceptance limits | Open/unexpired and unused enabled permission; available historical state required. Same-block version ambiguity fails closed. PC target is not a whole-job quote. Registered origin funding is unit-tested; live principal/inbound-bridge acceptance is still pending. |
| Automatic evaluator / job.verify | Explicit capability error. Current evaluator is manual; the linked evaluator has a different ABI/wire. No baseline, frozen-spec or verdict data is invented. |
| Replacement criteria / non-NONE cards | Refused before writes. Expected-spec-hash acceptance must be delivered with compatible contracts before mutable negotiation. |
| Contract/delegated owners | Full signed-request simulation uses the actual verifier. External EVM UEA transport passes live; arbitrary ERC-1271 adapters need their own acceptance. Delegates without a compatible verifier fail simulation after signing, before broadcast. Undeployed external UEAs and missing typed signing fail before prompting. |
| Relayer, recurring jobs, ratings, non-EVM cards/evaluation | No successful placeholder or invented service. Remain outside this checkpoint. |

`job.cancel` revokes only the permission recorded for that marketplace job, using the current owner's existing AGW authority. Provider/evaluator terminal actions do not acquire owner cleanup authority. Plain jobs have no marketplace permission to infer. Funded job completion/payout is tested with manual evaluator action only on an isolated fork.

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

- **2,228 unit tests pass**, 12 existing skips; 23 cases added after the first checkpoint.
- **8 real-stack fork E2Es pass**: existing lifecycle plus historical deposits/reconnection and a real EVM UEA signature. Actual principal/pUSDC and escrow/payout use fork-only borrowed assets. The UEA signature case uses a native submitting transport on Anvil; no Cosmos transport is mocked as successful.
- **3 funded live cases pass**: native register/open/cancel/revoke, paid validator-consensus preview, and actual external EVM UEA open/cancel. Card 3 is inactive; jobs 2/3 are Rejected and both permissions are revoked. PC funds gas/wallet setup/read callback; principal and escrow tokens are not moved live. The first checkpoint's two read-only cases remain prior evidence.
- Build, library/spec/local typechecks, compiled imports/declarations/package checks and source-versus-built API comparison pass; the new production modules lint without warnings. The consumer guide's six TS blocks typecheck.

[Current validation and limits](research/sdk-completion-2026-10-20/README.md), [first checkpoint](research/sdk-implementation-2026-10-20/README.md). E2E groups `marketplace` and `marketplace-live` are opt-in; default all selection is unchanged. Future checkpoints should append to the [running changelog](../SDK-CHANGELOG.md).
