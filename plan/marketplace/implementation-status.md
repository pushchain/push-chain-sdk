# Marketplace SDK implementation status

October 20, 2026 — first implementation checkpoint on `feat/agw-sdk-v4`. This supersedes the planning-only statements in the original research package. No package was published.

## Implemented

- `client.market`: card discovery/reads; provider register/update/setActive/card; independently checked CEA and JobSpec preview; native plain-EOA OwnerIntent signing/open; job mappings and active-wallet reads.
- `client.job`: plain create; provider pricing; explicit-budget acceptance, balances/allowances and atomic AGW funding; submit; status/list/watch; client cancel with recorded marketplace permission revocation; expiry/grace refunds, including while paused.
- `PushChain.utils.job`: pure EVM read authoring, complete/template builders, canonical v2 codecs and descriptions. `client.universal.read.prepare` exposes the same pure authoring adapter; existing async prepareRead is unchanged.
- `PushChain.utils.market`: deployed four-field card rules, principal/wallet markers and pinned approvals. Destination-token resolution always uses the explicit card chain, including same-address native-token objects. Decoded unknown PRC20s remain explicit references. Unchanged legacy wire metadata is preserved; archive raw bytes for persistence.
- `AGENTIC.PRINCIPAL` and `AGENTIC.JOB` vocabulary/address table; public types/errors; source and compiled consumer guide checks. The API checker now canonicalizes equivalent string-literal quote syntax in emitted property names.

Binary JobSpec data in the kernel's Solidity string is handled as raw bytes while retaining the original createJob selector. Card versions, rules, origin and calldata are independently compared before signing. Plain jobs and historical card versions require an explicitly reviewed budget; the SDK does not silently adopt a re-quote.

Registry summaries do not decode an unverified provider's template. A malformed template therefore cannot break listing or prevent its provider from deactivating/updating the card. Full decoding/preview still refuses unsupported content.

## Current placeholders and delivery limits

| Surface | Current behavior / next requirement |
| --- | --- |
| market.deposit | Explicit CAPABILITY_UNAVAILABLE. Historical-card snapshot/resumption and deposit policy remain a later SDK increment. Fund the AGW explicitly. |
| Automatic evaluator / job.verify | Explicit capability error. Current evaluator is manual; the linked evaluator has a different ABI/wire. No baseline, frozen-spec or verdict data is invented. |
| Paid previewJobSpec | Explicit capability error pending the fee/callback/raw-read adapter. Pure authoring/description works. |
| Replacement criteria / non-NONE cards | Refused before writes. Expected-spec-hash acceptance must be delivered with compatible contracts before mutable negotiation. |
| External and contract/delegated owners | openJob is gated before signing. The actual test master has EIP-7702 code and follows the contract-signature branch; a fresh plain native owner passes live. ERC-1271 / UEA-specific signing needs its own acceptance. |
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

- **2,205 unit tests pass**, 12 existing skips; 24 new unit cases.
- **6 public-SDK fork E2Es pass**: real v2/v6 registration, open/signature/wire, decoded update, paid pUSDC allowance/escrow/payout, re-quote/insufficiency/version-drift checks, events/deliverable, plain creation, refund while paused and cancel/revoke. No public token transfer was used for that escrow test.
- **2 live read-only cases pass** and **1 funded live smoke passes**. The funded smoke creates only fresh provider/card/owner/wallet state, opens/cancels/revokes, and deactivates its card. It moves PC for gas/test-wallet setup, not principal/escrow tokens.
- Build, library/spec/local typechecks, compiled imports/declarations/package checks and source-versus-built API comparison pass; the new production modules lint without warnings. The consumer guide's four TS blocks typecheck.

[Validation details and limits](research/sdk-implementation-2026-10-20/README.md). E2E groups `marketplace` and `marketplace-live` are opt-in; default all selection is unchanged. Future checkpoints should append to the [running changelog](../SDK-CHANGELOG.md).
