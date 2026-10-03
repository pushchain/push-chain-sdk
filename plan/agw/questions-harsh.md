# Product questions for Harsh

Revised October 3, 2026 after checkpoint follow-up. Local draft, not sent. Baseline: AGW `pushAgenticWallet_v3@e704d5b`, core `cb69e0b`, full Notion export October 03, 2026 at 13:23 IST. SDK page 5 remains the public target; proposed API changes below require agreement.

## H1 Destination approval safety

The headline example allows destination `approve(address,uint256)` without a spender constraint. Universal AllowedCall can pin a beneficiary to the CEA, but cannot pin an arbitrary spender. This can authorize an agent-controlled spender against existing CEA balances. Current marketplace code rejects approve/increaseAllowance and uses owner Approval[] instead.

Recommendation: reject these known approval selectors in universal agent rules and add an explicit owner-controlled destination approval flow. This is a public validation/API change, not merely internal implementation. Native approvals can use spender pins. Selector filtering alone cannot make arbitrary untrusted contracts safe.

Decision: which owner approval surface should the SDK expose, and should the unsafe example be replaced accordingly?

## H2 Native scope and arrays

The contract can grant up to eight native actions in a rule set, but page 5 NativeRule describes one action and permits one rule per agent/chain. The agent door accepts only single/default execution. EVM destination arrays can fit one bounded CEA multicall; Push-native arrays cannot become atomic through the present agent door.

Decision: keep one native action per public rule, or explicitly extend its type to an action list? For native arrays, should the SDK reject them initially, offer explicitly sequential behavior, or wait for an agreed contract change? We recommend rejecting unsupported arrays rather than silently weakening atomicity.

## H3 Optional limit defaults

The new contract proposal explicitly makes AssetCap.maxTotal=0 unlimited; we propose mapping an omitted asset maxTotal to zero as well, with an unlimited preview. Please confirm omission semantics and the still-undefined native defaults: maxValuePerCall, maxValueTotal, amount.maxTotal, maxCalls and allowedCalls.maxValue. Native explicit zero must not accidentally inherit the new asset sentinel convention.

## H4 Reconcile the SDK spec with the delivered D3 model

Please approve a small spec correction set, with the exact API wording reviewed before implementation:

- Rules IDs use validator address, encoded Push agent and grant nonce; chain is not hashed and IDs are wallet-scoped. The helper needs deployment/validator context, and constants currently claim no validator address.
- Wallet prediction is stable within a factory/implementation generation, not globally from owner/index alone.
- The existing native SDK supports EIP-7702 batching with a sequential fallback; creation must describe actual atomicity.
- Agent duplicate-rule ambiguity must have documented behavior. SDK preflight can reject duplicates, while direct contract grants can still create more than one active candidate.

- Universal Spent still returns scalar amountSpent while the new rule has per-token caps. Please agree a per-asset spent shape rather than aggregating unlike token units.
- Should rules.list() return revoked rules as well as active rules? If historical rules are promised, the grant event needs agent attribution or the SDK needs reliable calldata reconstruction; current revoke clears agent config.

Creation now deploys/grants only; funding and PC top-ups are separate as the updated spec directs. We will own partial-failure metadata, list/info implementation, read-only/reinitialize details, receipt mapping and Web2 migration. We will document any observable choice and flag only departures from explicit API requirements.

## Separate downstream note

Multi-chain card binding, expiry equality, dropped binder role, single-token versus K-12, and old job examples belong in the marketplace/job alignment discussion. They do not require reopening standalone AGW implementation decisions.

## Current source freshness

Successful full Notion export: October 03, 2026 at 13:23 IST; 12 pages checked, pages 1 and 5 changed. AGW remains pinned to reviewed e704d5b; no new Git refresh was part of this pull. Core/gateway retain cb69e0b/bcbf7df evidence. Drafts remain unsent.
