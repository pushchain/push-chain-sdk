# Sources and refresh procedure

## Authority and freshness

For actual network behavior use pinned RPC evidence plus reproduced deployment source/ABIs. For intended SDK/product behavior use current Notion decisions and their dated comments; report contradictions instead of treating deployed behavior as automatic approval for a public API change. The user's pasted announcement confirms the v2 rollout and explicitly defers open/future features. Archived `plan/agw` marketplace drafts are historical.

| Read order | Current page | Local source |
| --- | --- | --- |
| 2 | [Marketplace contract](https://app.notion.com/p/3e9188aea7f48118b90ac9b267496295) | [Export](notion/2-universal-marketplace.md) |
| 6 | [Marketplace SDK](https://app.notion.com/p/3ea188aea7f481e2961ed97129f3a4e6) | [Export](notion/6-sdk-universal-marketplace.md) |
| 3 | [Kernel and hook](https://app.notion.com/p/3e9188aea7f48188a838c3a740d8c858) | [Export](notion/3-8183-job-kernel-and-hook.md) |
| 7 | [Job SDK](https://app.notion.com/p/3ea188aea7f481e0a137f5a896723376) | [Export](notion/7-sdk-8183-job.md) |
| 4 | [Evaluation](https://app.notion.com/p/3e9188aea7f4817bb03ef4c78c883f8b) | [Export](notion/4-universal-evaluation.md) |
| 8 | [Evaluation SDK placeholder](https://app.notion.com/p/3ea188aea7f48197a3b3cfdedfa74fee) | [Export](notion/8-sdk-evaluation-placeholder.md) |

All six were freshly downloaded on October 20 using Notion's Markdown & CSV export of the stack index with subpages. [Raw bundle](research/2026-10-20/notion-export.zip), [hashes and export entries](research/2026-10-20/notion-source-manifest.json). Raw bundle also contains the overview and AGW pages; only the six requested pages were imported here. No earlier AGW snapshots were overwritten. Original exported relative links are preserved as evidence and may point to unimported filenames; use the table above for navigation.

Page exports **exclude comments**. Current All discussions panels on pages 2, 6, 3, 7 and 4 were separately read; page 8 exposes no Comments button in its current placeholder state. [Discussion observations](research/2026-10-20/notion-discussions.md) are paraphrases with author/date/context, not an exhaustive resolved-thread archive. No comments were posted, resolved or edited.

## Immutable code sources

- [Marketplace deployment branch, exact pin](https://github.com/pushchain/push-chain-core-contracts/tree/443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47). Includes [address book](contracts/docs/addresses/push_donut_universal_marketplace.md), [README](contracts/docs/universalmarketplace/README.md), [reference](contracts/docs/universalmarketplace/reference.md), [criteria guide](contracts/docs/universalmarketplace/criteria.md), sources, deployment script and tests.
- [Selected snapshot manifest](research/2026-10-20/contract-source-manifest.json): exact Git file hashes. `contracts/` is a reference subset; the test workspace is a separate full archive. Generated ABIs are in `contracts/abi` and have a separate manifest.
- [Pinned dependency revisions](research/2026-10-20/dependency-pins.json), including AGW `ffd567d`. Dependencies were archived at their actual submodule pins; the sibling repository's active branch was not checked out or changed. Dependency symlinks are omitted from the isolated archive.
- [Evaluator source linked in Nilesh's October 16 comment](https://github.com/pushchain/push-chain-core-contracts/blob/8059817591cca16c59f1cc154f475f51e1736a67/src/agentic-commerce-8183/libraries/JobSpecTypes.sol): [local types](research/2026-10-20/evaluator-8059817/JobSpecTypes.sol), [local evaluator](research/2026-10-20/evaluator-8059817/UniversalEvaluator.sol). These are comparison sources, **not** the deployed marketplace schema or proof of evaluator deployment. Page 7 also links older evaluator revision `4391181`; the later `8059817` source was read for current API differences.

## Demo source and follow-up evidence

The user-provided `marketplace_demo-main.zip` matches `pushchain/marketplace_demo@0d765e06418f1678f77ecd6434603ceecd5a708f` on the seven reviewed entrypoints (Git blob hashes compared through the GitHub API). Its config uses the newer self-deployed demo stack, while its encoder still writes timing-first criteria. Current `sdk-iteration-v1`, `feat/universal-evaluator-demo-jobs` and `feat/universal-evaluator-pre-post-reads` heads were re-fetched. [Download provenance, fresh runtime/CEA checks and SDK changes](research/demo-alignment-2026-10-26/README.md).

## Repeatable review

October 26 correction from Nilesh, supplied by the user: the current branch is `feat/universal-evaluator-pre-post-reads`, not `feat/universal-evaluator`. Fetched head `8666c2ac2304ffd97a7ada121170c397d0f6125d` matches open [contracts PR #132](https://github.com/pushchain/push-chain-core-contracts/pull/132). This establishes the next SDK integration target; the older branch and `8059817` remain historical comparisons. [Current source check, migration scope and 170 passing local contract tests](research/evaluator-pre-post-2026-10-26/README.md).

October 26 follow-up: fetched and checked `feat/universal-evaluator@46e79024562fc995a68bb17df3d31c58c1a2a178` explicitly. It is an ancestor of the previously linked `8059817`, with a third JobSpec layout. [Source comparison, 69 focused contract tests and fresh read-only deployment probe](research/evaluator-branch-2026-10-26/README.md). This supplements the October 20 baseline; it does not replace the deployed marketplace schema.

1. Export the stack index with subpages again; retain ZIP and hashes. Match pages by stable ID. Keep comments separate.
2. Fetch `sdk-iteration-v1`; record full SHA before analysis and recheck remote head before sharing questions. Never save authenticated remote URLs in evidence.
3. Archive the exact source and pinned dependencies into an isolated workspace. Do not switch the SDK or sibling contract working trees.
4. Run unfunded unit/fuzz, explicitly scoped invariants and read-only fork tests. Preserve exit codes, skips, fork blocks and mock-versus-real scope.
5. Run the included read-only live probe and runtime comparator. Current scripts write October 20 evidence; use a new dated directory for a later review instead of overwriting this baseline.
6. Reconcile docs/code/observations in the gap register and remove questions already answered by newer evidence. Keep product choices distinct from SDK-owned implementation details.
