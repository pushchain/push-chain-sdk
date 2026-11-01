# Marketplace — remaining hook questions

**SDK:** `@pushchain/core@6.0.27-alpha.9` · **Rechecked:** November 1, 2026

Marketplace 2.1 allows four rules per card and records `rulesIds[]`. UniversalHook
still checks and binds one ID at funding. The SDK supports multi-rule authoring,
registration and previews, but gates opening, funding and deposits.

## 1. Multi-rule hook ABI and delivery

**Nilesh: which PR/commit will add all-rule binding, and what is the expected delivery?**

Please share the final fund payload, hook `rulesOfJob` return type, events and
errors. Proposed payload: `(bytes32[] rulesIds, bytes32 expectedSpecHash, bytes newSpec)`;
this is not implemented in the reviewed branch.

For rollout, provide the hook implementation/proxy addresses, upgrade transaction
and activation block, plus any changed kernel/evaluator wiring. Current deployment
addresses are already documented; we need the upgraded revision.

## 2. Proving the submitted rules are the job's complete set

**Nilesh + Zaryab: will the hook validate against the marketplace's recorded
`rulesOfJob(jobId)`, or another authenticated source?**

An array alone is insufficient: a caller could submit only Base's ID for a
Base + Sepolia job. Confirm how the hook identifies the authoritative set,
handles ordering, and rejects omissions, duplicates or unrelated/foreign IDs
before escrow moves.

The SDK gate will be removed after deployed verification and two-/four-rule
lifecycle tests, including refusal when a secondary permission is missing or revoked.

[Source review, tests and fresh on-chain evidence](./research/questions-review-2026-11-01/README.md)
