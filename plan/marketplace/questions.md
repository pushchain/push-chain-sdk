# Agentic marketplace — questions for the contracts team

## 1. Which approved marketplace/evaluator stack should the SDK target?

The SDK implements PR #132's timing-free PRE/POST format locally. The live marketplace writes v2 criteria; both demo stacks write timing-first criteria. Neither matches the new format.

**Is PR #132’s timing-free PRE/POST format approved for v2? Please share the matching marketplace integration commit and rollout addresses, including kernel, hook, evaluator and payment token.**

## 2. Do the marketplace timing fields stay?

The new JobSpec removes `executeBy` and `failFinalAt`. Cards still have `minExecuteWindow` / `settleWindow`, and `JobInputs` still has `executeBy`.

**Should these remain as openJob checks, or be removed from the card and signed job inputs?**

## 3. Are multi-chain cards in scope for this rollout?

Current cards bind one execution chain and one rule; several chains require a new signed format.

**Should v2 include multi-chain cards? If yes, confirm the leg limit, fee model and final card/openJob/fund structs, including per-leg principal and binding every rulesId.**

[Verified demo/CEA findings](research/demo-alignment-2026-10-26/README.md).
