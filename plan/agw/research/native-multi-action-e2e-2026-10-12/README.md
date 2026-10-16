# Native multi-action SDK acceptance — October 12, 2026

Working branch: `feat/agw-sdk-v4`, after the user's v5 merge (`7115c594`). Contract fixture: deployed Donut v5 source `2e61e13`. All work in this pass remains local; no commit, push, PR update or merge was performed by the agent.

## Changes

Ten opt-in scenarios are added in `packages/core/__e2e__/agw/native-multi-action.spec.ts`. The AGW group now contains **68 scenarios / 15 files / 68 tests**. Default `all` remains **76 / 40 / 81**.

1. Grant/read two native actions under one ID, recreate decoded terms, execute both, and verify replay identity.
2. Reject wrong recipient pins, excess amounts and an ungranted selector with unchanged balances, both action configs and signer nonce.
3. Exhaust PC/call capacity in one action while the token action remains usable; verify independent counters and amount totals.
4. Execute a mixed PC/token atomic batch through native EIP-7702, checking sender identity, both spends and replayed call metadata.
5. Reject a failing second item through SDK simulation, then submit the same encoded mixed batch as a bounded raw transaction through the already delegated agent. Its mined revert must have no logs and restore both balances and action counters.
6. Replace a two-action rule, verify six checkpoint ticks and fresh counters, then remove an action and prove it is no longer authorized.
7. Inject a real token spend in the second action between replacement reads and execution; require `SpentMismatch`, unchanged grant nonce/checkpoints and original rule, then a successful fresh retry.
8. Accept eight actions; reject empty, duplicate, mixed-shape and ninth-action inputs before signing.
9. Expire the first action while the later-expiring second action remains usable under the same ID.
10. Return structured `INVALID_RULE` for malformed action entries and missing/expired rule expiry, with no new wallet or owner nonce change.

The shared state helper reads every action's policy config at one pinned block. Tests compare actual balances, individual counters, grant nonces, checkpoint counts and receipts instead of relying on SDK return values alone. Each test creates its own wallets and can be selected independently.

## Review fixes exercised by the tests

- `nativeActionsOf` checks that every action is an object before reading it, so `actions: [null]` produces `AgenticError(INVALID_RULE)` rather than a JavaScript `TypeError`.
- Required rule-level expiry is validated even when every action overrides it. Four added unit regressions cover null/non-object entries and missing/expired rule expiry.
- The guide now states that replacement of N old native actions adds **N + 4** checkpoints. Universal replacement still adds five.
- The public multi-action type remains pending product sign-off. Test completion does not constitute that approval.

## Validation

- Full units: **2,034 passed, 12 skipped, 0 failed**. Focused AGW units: **255 passed**.
- Actual pinned v5 contract harness: **97 passed**, 13 suites, including the seven prior multi-action cases.
- Spec/local typechecks, build, 11 consumer guide blocks, CJS/ESM package/declaration checks and API comparison passed.
- Registration and full-group funding preflight `--dry-run` passed. The live run selects only this new ten-case file.
- Final E2E/state-helper lint has no errors or warnings. The native codec retains its previously reported unused destructured `_agent` warning.

Live Donut: **10/10 passed in one invocation** (585 seconds). [Exact live log](logs/live-donut.log), [transaction and state evidence](live-evidence.jsonl), [validation summary](validation.json). No scenario was skipped or rerun to obtain this result. The final test file additionally bounds the expiry wait to two minutes; the successful run did not require that timeout.

## Scope and funding

The existing verified v5 manifest gates setup. No test contract is deployed. Fixtures use one fresh agent funded with at most **0.5 PC**, fresh AGWs funded with **10 PC wei** and **20 raw pETH units** each, and existing Donut token/executor contracts. The intentionally failing raw batch has a **600,000-gas** ceiling and spends the fresh agent's gas only. Its outer encoding is the same ERC-7821 execute shape used by the SDK.

The second-action race injects a real public SDK send immediately before owner submission; the stale owner operation is refused during simulation. The expiry wait is bounded to two minutes. No external-chain delivery or contract deployment is needed for these native cases. Existing EVM/SVM and other live groups were not rerun in this pass; this is not a single 68-case run.
