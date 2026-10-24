# SDK-only completion boundary

October 20, 2026, `feat/agw-sdk-v4`. Scope: deployed UniversalMarketplace v2, AGW v6, current EVM JobSpec wire, immutable criteria and pUSDC. The SDK does not require new team decisions to finish the items below. [Current acceptance evidence](research/sdk-independent-2026-10-20/README.md).

| SDK-owned work | Completion / acceptance |
| --- | --- |
| Contracts, types, constants, codecs and authoring | Implemented; canonical wire, markers, constraints, public exports and package checks |
| Card/provider lifecycle | Implemented; immutable identity, pre-submission simulation, malformed-card summary tolerance, register/update/activation acceptance |
| Exact preview and signing | Implemented; independent CEA, hashes, nonces and factory domain; native/external EVM UEAs live, ERC-1271 reference adapter and compatible/incompatible 7702 verifiers on real local contracts |
| Opening proof and recovery | Implemented; input copied before awaits, deterministic permission ID, event/kernel/wallet/mapping checks, mined-input recovery without another signature or write; native broadcast hashes survive receipt/indexing failures |
| Deposits and historical versions | Implemented; original principal/fee/gas, shared-token aggregation, no implicit price acceptance, pending receipt/hash recovery, same-block/archive-less history authenticated by event content hashes and transaction input |
| Funded acceptance | Live owned-token deposits, native/AGW atomic escrow, provider submission and controlled manual-evaluator payout; live BSC-origin principal bridge; market grants revoked, test cards deactivated, deposited/reserve/payout tokens returned |
| Job lifecycle and safety | Create/price/fund/submit/status/list/cancel/refund implemented; explicit re-quotes, allowance handling, expiry/grace and paused refund accepted on the fork |
| Event delivery | Implemented; exact cursor, within-block resume, deduplication, retry without gaps, callback isolation, unsubscribe and canonical-cursor reorg stop |
| Read helpers and descriptions | Pure preparation and direct resolved-read sending, ABI names and explicit decimals, paid previews, checked fee cap, raw/nested decoding, explicit baselines/unknowns and request-ID recovery without new payment |
| Reproducible development checks | Unit/fork/live acceptance, repo-owned signature fixture compilation, corrected CI completion reporting, public guide examples, build/types, CJS/ESM and declaration/package/API checks |
| History and handoff | Changelog, evidence, consumer guide and narrowed team questions updated; source snapshots preserved |

There is no remaining implementation item in this scoped checklist waiting for an SDK-only follow-up. The evidence distinguishes local simulation, fork execution and live transactions; it does not substitute one for another.

## External contract/deployment boundary

- **`job.verify` and automatic evaluation:** a compatible hook/evaluator, agreed shared JobSpec schema and callable verify/retry interface must be delivered. The current marketplace evaluator is an EOA. Live paid tests use fresh controlled evaluators on plain kernel jobs; they do not replace or impersonate the marketplace evaluator.
- **Three CEA rollouts:** align marketplace and routing manifests for Sepolia, Base Sepolia and Arbitrum Sepolia. Both tables currently answer but derive different accounts. BSC works. Changing SDK globals without coordinated routing evidence would redirect account derivation.

Only these current dependencies should go to the team. [Ready-to-share questions](questions.md).

## Later scope and release action

Mutable criteria, per-job payment tokens, recurring jobs, relaying, verified ratings, non-EVM JobSpec sources/OwnerIntent conventions and mainnet rollout remain outside this delivered EVM v2 boundary. They require additional product/protocol scope; they are not unfinished implementations of current supported behavior. Custom contract-wallet vendors supply their own signer transport; a valid reference adapter and actual deployed verifier paths are accepted here.

Package publication is a separate release action. Source, built declarations/imports and npm contents are checked, but no release version was chosen and no package was published. Continuing contract integration later should append to the existing changelog on this branch.
