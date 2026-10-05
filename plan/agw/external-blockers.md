# Remaining external dependencies for AGW

Updated October 4, 2026 from [Harsh’s supplied replies](product-decisions-2026-10-04.md). The earlier count of seven standalone decision areas is historical. Several product decisions are now settled; implementing them is SDK work, not a reason to keep asking the same questions.

## Still needs external information or delivery

| Area | Owner | Remaining dependency |
| --- | --- | --- |
| Exact defaults and revised fields | Harsh H3 | Final omission/explicit-zero table and the referenced maxValueTotal change; fresh page-5 body still matches the older snapshot |
| Native decoded-rule representation | Harsh H4.5 | Decide whether raw offsets are public read/write inputs or an internal/separate decoded representation |
| Universal accounting and encoding | Zaryab Z1 | Final multi-asset terms, internal per-token reads, expected-spend assertion ABI/vectors, empty-assets routing and envelope/CEA representation |
| Contract metadata and destination capabilities | Zaryab Z1 | Ref/label scope and matching SVM artifacts |
| Deployment readiness | Agreed coordination; SDK verifies after completion notice | Fixed addresses are known; Zaryab will notify Shoaib. This is a release dependency, not an open deployment question |

Hiding public spend does not remove internal spend assertions. Deferring public history does not remove the need to distinguish enabled, expired and revoked permissions for execution.

## Resolved scope and SDK alignment work

- Approval selector policy belongs to UI/marketplace. Remove the SDK's blanket policy rejection; retain structural validation and contract checks.
- Generation machinery stays internal; adjust public helper exposure instead of requiring public factory/validator parameters.
- Public multi-asset spend is unnecessary; align read records while retaining internal accounting.
- Revoked-rule history is deferred from v1.
- compileCard is outside standalone AGW. Its shared marketplace schema is no longer an AGW release blocker.
- Native arrays are desired. Our earlier claim that the single-call AGW door requires a contract batching change was too broad. Sender-preserving UEA/7702 outer batches can contain multiple single agent-door calls. Implement and validate that path; never silently label sequential fallback atomic.
- Gateway allowance setup already uses separate owner transactions. Creation index binding, atomic updates and response replay have local implementation/review evidence.

The clear product decisions are now implemented: approval-policy rejection and obsolete public exports are removed, reads are active-only, and native arrays require atomic transport. H3 defaults were deliberately not changed. [Implementation status](implementation-status.md) distinguishes current code from the new direction.

## Freshness and delivery gates

SDK page 5 was downloaded October 4 and matches the saved body after link normalization; other registered pages were not refreshed. [Evidence](research/notion-check-2026-10-04/comparison.json). AGW remote head remains e704d5b. No compatible deployment was verified in this pass.

Continue SDK work against explicit adapters and assumptions. A compatible manifest, internal multi-asset artifacts and authorized live acceptance remain necessary before enabling the final release. The source snapshots remain unedited evidence; the product decision record captures the newer scope direction.

## Deployment coordination October 5

The deployment request was removed from Zaryab’s question document at Shoaib’s direction. The supplied fixed-address table matches the [saved address book](notion/agw-address-book-donut-2026-09-04.md). Keep it as known address input; after the completion notice, the SDK team verifies deployed code/wiring, matched ABI and event start blocks, then prepares the registry/E2E configuration. No registry entry was enabled by this documentation update.
