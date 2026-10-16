# Preset configuration and per-operation limits — October 16, 2026

Implemented after Riyanshu's UI feedback and the user's request to complete the SDK-owned changes. Production code was developed on v4; v5 receives non-plan changes separately. No contracts or UI repository were changed.

## Public API addition

presets.get now returns { rules, readiness }. The existing rules/create/update call shapes remain. New exported types: PresetResult, PresetChainReadiness, PresetConfigurationIssue, PresetCallIssue. Readiness checks local input completeness and at least one enabled asset operation, not deployment, PRC20 support, funds, reserve caps, pauses or liquidity.

Per-chain metadata names missing identity/expiry/assets/token pair/gas, zero-cap calls, excluded operations, known catalog token addresses, and zero bridge limits. A positive operation cap with maxTotal zero can be ready for destination-held capital; this does not authorize exporting new tokens from Push. No arbitrary token, 0.1 PC budget or 30-day expiry is chosen.

## Generated restrictions

- Aave: reserve token EQ, operation amount MAX and wallet beneficiary EQ. Reserve addresses come from the reviewed official bgd-labs address-book snapshots. Unlisted tokens get no positive operation/approval.
- Moonwell/Venus: fixed underlying-token amounts. redeemUnderlying is bounded; share-denominated redeem is excluded and reported with the alternative.
- EigenLayer: chosen token EQ and deposit amount MAX.
- Lido: stETH/wstETH-specific wrap/unwrap caps; native submit value from a selected native asset cap. Dynamic withdrawal arrays and position-derived claims are excluded from bounded presets, with reasons exposed to the UI.
- Approvals retain spender EQ and per-call MAX. Pin/count ceilings are enforced after expansion; no restrictions are silently dropped.

Regenerate with presets.get after changing inputs, then replace the old rule with rules.update. Merely assigning rule.assets does not regenerate pins/approvals. Save preset provenance/inputs in the UI; contracts do not retain them. [Consumer guide](../../../../packages/core/AGW.md) contains typechecked create/update examples.

## Important contract boundary

Operation MAX pins constrain each allowed call. Two calls each at the maximum can share one transaction. Asset maxTotal meters Push outbound amounts, not destination turnover or a lifetime limit on prefunded assets. Neither the SDK nor bounded approvals can supply missing contract-wide accounting. This is stated in the types and guide; ask product/contracts if a different aggregate policy is required.

## Validation

- Full unit suite: 2,111 passed, 12 skipped, no failures.
- Focused preset suite: 54 passed.
- Actual v6 local policy tests: 18/18 passed, including the final batch-scope assertion (local-contracts.log). Covers zero-cap previews, token changes, lower limits, old-token rejection, checkpoint-count change of five on update and zero Push spent for destination-only actions. Gateway and UEA-origin response metadata are fixtures; AGW/URP/engine execution uses actual local contracts. An unrelated getOriginForUEA response lookup initially reached Donut and timed out; the test fixture now isolates that metadata lookup, matching the existing delayed-index harness pattern. These tests do not prove destination execution.
- Build, lib/spec/local typechecks, guide and package/import/declaration checks passed. Source/compiled public API comparison matches. Preset lint has no errors (one test non-null assertion warning).

## Live attempts: not passing acceptance

The updated Aave test adds an above-cap refusal, regeneration with a lower cap, refusal of the old amount and two bounded withdrawals in one batch. Market tests now redeem in underlying units and check actual burned shares/payout, allowing residual rounding dust. EigenLayer adds wrong-token and above-cap refusals.

Live attempts timed out before reaching the new operation assertions:

| Attempt | Recorded transaction / observation |
| --- | --- |
| Aave first | 0xe685f4205cbe59c3acd52a4b4588ae656b7e23127ca68d96ead0b70df2f00578; later read-only Push receipt success at block 24282737 |
| Aave retry | 0xc8b66f3c89b869f9b047baaf52cccf65e9ee176a368b1889ded77b3a5d816b93; Push receipt success at block 24286115; test timed out during destination wait |
| BNB market setup | 0x52732156d51caf9d3d1aa08fd4397be09508553cc4119fc218b92f50eee126e3; receipt wait timed out; subsequent lookup HTTP failed, final state not confirmed |
| Base market setup | 0x72d53c5d0faad5a16eec8f1a1f413757d425ec4237488551b5d2f2436d4e60b2; receipt wait timed out; later Push receipt success at block 24290217 |

Do not treat these as contract-policy reverts or live passes. Prior successful catalog flows predate these restrictions. Re-run the affected live scenarios once receipt/destination processing is reliable. No further funded retries are running.
