# Branch delivery — October 26, 2026

Implementation committed on v4 as `ad75da0ed9bb03d80273a4eff84ca67c4c03421e` and on v5 as `1076106b17692935ffcdba9b55a210dec00d970b`. V4 additionally keeps the planning, research and development history. The v5 implementation commit changes no `plan/` path. Its existing release version (`6.0.27-alpha.7`), release changelog, lockfile and inherited plan tree remain unchanged.

Outside `plan/`, the two branch trees differ only in those three release-metadata files. The PRE/POST unit fixture is now under the SDK test directory rather than read from plan research. No matching new plan files are present on v5; its unit suite passes from that worktree.

V5 acceptance: 2,306 passing units, 12 existing skips; nine passing local evaluator SDK cases; build, source/declaration API equality, package import/content/declaration checks and both consumer guides pass. The focused fixture test passes all 20 cases on v4. No publication or live transaction was run for this delivery.

[Summary](validation-summary.json), [v5 unit JSON, gzip](v5-unit-results.json.gz), [v5 local JSON, gzip](v5-local-results.json.gz), [v5 API comparison, gzip](v5-api-comparison.json.gz), [v4 fixture check](fixture-results.json).
