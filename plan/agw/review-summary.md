# AGW review corrections and evidence

This concise record replaces duplicate historical plans and logs, which were archived locally before preparing the Git package.

## Consequential corrections

- The first review used 610a640. A fetch completed during drafting but was not consumed before handoff, so the recommendation missed D3 at 0f279ca. The engine-extension recommendation is withdrawn. Observe an exact fetched SHA before analysis and recheck freshness before sharing.
- The delivered sender adapter preserves SmartSession. Wallet-authored USE bytes, sender/account binding and closed alternate paths are essential invariants.
- Contract chapters 9 and 10 define accepted limits and 23 delegated requirements, now mapped in [integrator obligations](contract-integrator-obligations.md).
- Gateway main's six fields are older; newer source and named Donut evidence support eight fields. A future removal is a release-intent question.
- Core cb69e0b marketplace requires expiry equality, not a universal standalone rule constraint.
- Owner batching is the documented replacement design. Stronger tests cover initialized config, events, old/new ID usability, mid-initialization rollback and native counters.
- Duplicate rules are owner-authorized; SDK ambiguity behavior must be explicit. Mandatory contract uniqueness was not established as a security necessity.
- Tracking is hash/UTX based. Dedicated request composition, logical sender fields and progress integration remain SDK work.
- Historical clones cannot acquire new ABIs. Addresses and counterfactual funding are generation-specific. Named historical deployment observations do not prove no separate new deployment exists.
- Checkpoints landed in 6b7dbf4, included in e704d5b. Stored counts and per-call ordering deliberately revise the owner invariant. Compare counts, not only blocks; allowance pulls can occur without a checkpoint.
- Binder was never in reviewed code and current Notion drops it for v1. Older proposals or a screenshot question do not authorize adding it.
- The latest Notion target makes create deployment/grant only and uses assets[]/maxGasPerCall. G23/G24 track new wire, read and assertion gaps.

## Validation history

| Revision | Baseline | Review evidence |
| --- | --- | --- |
| 610a640 | 547 passed, 0 failed, 7 skipped | Four review tests passed; independently reproduced |
| 0f279ca | 542 passed, 0 failed, 6 skipped | Seven stronger review tests passed; independently reproduced |
| e704d5b | 563 passed, 0 failed, 6 skipped | Seven review tests pass; build/pin checked; [retained evidence](research/validation-e704d5b/README.md) |

Old Ed25519 fork behavior is historical; that crypto path is removed from the sender adapter. Direct node vectors did not prove complete wallet execution. Local tests use a recording gateway and do not prove real burn or settlement. Current skips remain unverified live/deployment checks.

Use the [gap register](gaps.md), [Harsh draft](questions-harsh.md), [Zaryab draft](questions-zaryab.md) and [baseline](current-baseline.md) for current decisions. No message or production implementation change has been made.
