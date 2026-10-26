# AGW implementation review evidence

The original [review](review.md), tests and logs in this directory describe implementation revision `3008497`. They are historical evidence, including deliberately failing regression assertions. Several tested helpers changed or were removed in the fixes, so the original regression file is not expected to compile against the current implementation. Reproduce it against its recorded revision.

The [follow-up review at 9e16b23](followup-9e16b23/review.md) verifies fixes in `880e7ae`, reproduces 1,899 unit tests and 34 local-contract tests, adds a passing response-builder/wait check, and identifies the remaining explicit-transfer replay inconsistency.

Normal acceptance tests live under `packages/core/src/lib/agentic/__tests__/` and `packages/core/__agw-local__/`. Review-specific configurations stay outside their discovery patterns. No review test here authorizes or performs a live-network broadcast.

The [outbound response resolution](outbound-response-resolution.md) records the subsequent F1 fix and promoted R6 coverage. Current acceptance cases are in the regular SDK suite; historical logs in the follow-up folder still show the earlier failure by design.
