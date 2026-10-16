# SDK owned review evidence

October 3, 2026. SDK production source is 167fdc6 (planning branch 46f9e66). The [test summary](test-summary.json) records the commands and checksums. Existing SDK unit suites: 183 passed, 0 failed, ten suites. These exercise existing behavior with mocks; they do not test a completed AGW SDK.

## New allowance experiments

Four review-only tests pass against AGW e704d5b in an isolated copy. [Source](AllowanceReview.t.sol), [Forge output](allowance.log). The AGW, factory, policy and E2E harness source files were byte-compared to the pinned Git objects before running. The initial fixture attempted to override the harness's non-virtual setUp; it was corrected to use a helper invoked by each test, without changing the harness or production source.

| Test | What it proves locally |
| --- | --- |
| Missing approval | transferFrom fails; wallet balance and URP spend roll back |
| Owner approval, spend and removal | execute establishes allowance; agent outbound consumes it, burns the pulled tokens and increments spend; owner can zero it and prevent further pulls |
| Agent using owner door | Exact CallerIsNotOwner error; no allowance created |
| Agent approving through universal rule | Exact engine NoPoliciesSet error; no allowance created |

The real gateway at bcbf7df calls transferFrom(from, gateway, amount), then burn(amount), in UniversalGatewayPC.sol:430–434. The fixture models that sequence with an authored token/gateway. It does not validate production fee logic, token peculiarities, routing, node/TSS acceptance or destination execution. A live compatible-deployment test remains required.

To reproduce: initialize pinned contract dependencies in an isolated e704d5b copy, copy AllowanceReview.t.sol into test/review/, then run:

```sh
forge test --offline --match-contract AllowanceReviewTest --match-test test_Allowance_ -vv
```

Forge 1.5.1-stable, solc 0.8.26, optimizer 833, via IR, Cancun, as in the existing e704d5b validation. No source checkout was changed and no transaction was broadcast.

## Freshness

[Remote refs](remote-refs.json) were rechecked with git ls-remote and remain at the recorded pins. The sibling AGW checkout is on old main; this was not mistaken for the active reviewed branch. Notion was not re-exported; its last complete snapshot remains October 3 at 13:23 IST. This report does not certify later page edits or current deployment state.
