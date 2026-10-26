# Explicit evaluator branch check — October 26, 2026

**Later correction:** Nilesh identified `feat/universal-evaluator-pre-post-reads` as the current branch. [The corrected target and SDK migration scope](../evaluator-pre-post-2026-10-26/README.md) supersede this older branch as the integration target. The source comparisons and test evidence below remain historical facts.

The previous review used Notion-linked evaluator `8059817591cca16c59f1cc154f475f51e1736a67`. This follow-up explicitly fetched `feat/universal-evaluator`, whose head is [`46e79024562fc995a68bb17df3d31c58c1a2a178`](https://github.com/pushchain/push-chain-core-contracts/tree/46e79024562fc995a68bb17df3d31c58c1a2a178). Git merge-base confirms that head is an ancestor of `8059817`, not a newer replacement. `sdk-iteration-v1` remains at deployment pin `443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47`. Neither working tree was switched or edited.

## JobSpec comparison

| Detail | Deployed marketplace / SDK | `feat/universal-evaluator@46e7902` | Previously linked `8059817` |
| --- | --- | --- | --- |
| Top-level order | reads, checks, logic, allowedMutability, origin, executeBy, failFinalAt | executeBy, failFinalAt, reads, checks, nodes, origin, mutability | executeBy, failFinalAt, reads, checks, logic, allowedMutability, origin |
| Read | No phase field | No phase field | Adds PRE/POST `at` |
| Check | One read index | One read index | Left/right read arrays |
| Logic | Direct check arrays; ALL=0 | CHECK leaf nodes; ALL=1 | CHECK leaf nodes; ALL=1 |
| Mutability ordinals | NONE=0, CLIENT=1, PROVIDER=2, BOTH=3 | NONE=0, BOTH=1, CLIENT_ONLY=2, PROVIDER_ONLY=3 | BOTH=0, NONE=1, CLIENT=2, PROVIDER=3 |

Sources: [branch JobSpecTypes.sol](https://github.com/pushchain/push-chain-core-contracts/blob/46e79024562fc995a68bb17df3d31c58c1a2a178/src/agentic-commerce-8183/libraries/JobSpecTypes.sol), [deployed definition](../../contracts/src/agentic-commerce-8183/libraries/JobSpecTypes.sol), [linked definition](../2026-10-20/evaluator-8059817/JobSpecTypes.sol).

[Controlled ABI vectors](wire-comparison.json) round-trip with the branch schema. The deployed marketplace vector fails to decode with that schema, and the branch vector fails with the deployed schema. The `8059817` vector decodes under the branch schema but does not re-encode to the same bytes: decoding alone cannot establish compatibility. These are controlled examples, not an exhaustive malformed-input proof.

The branch's marketplace builder also writes this branch's schema. Switching the SDK alone would break compatibility with the existing deployment. The [deployment helper](https://github.com/pushchain/push-chain-core-contracts/blob/46e79024562fc995a68bb17df3d31c58c1a2a178/scripts/agentic-commerce-8183/UniversalEvaluatorDeploy.sol) explicitly requires the final marketplace schema and new SDK funding parameters before changing the marketplace evaluator.

## Existing APIs and funding behavior

The [UniversalHook](https://github.com/pushchain/push-chain-core-contracts/blob/46e79024562fc995a68bb17df3d31c58c1a2a178/src/agentic-commerce-8183/hooks/UniversalHook.sol) requires `abi.encode(bytes32 rulesId, bytes32 expectedSpecHash, bytes newSpec)` for jobs using its evaluator. It hashes the final selected criteria at fund and reverts on a mismatch, addressing the same-price criteria-swap example. Client replacements go in `fund`; provider replacements go in `setBudget`, subject to the original mutability flag. The branch's marketplace builder always uses NONE. Existing manual-evaluator jobs retain the 32-byte rules-ID path.

The [evaluator](https://github.com/pushchain/push-chain-core-contracts/blob/46e79024562fc995a68bb17df3d31c58c1a2a178/src/agentic-commerce-8183/evaluator/UniversalEvaluator.sol) provides these concrete entrypoints:

| Action | Entry point | Caller |
| --- | --- | --- |
| Freeze criteria and take baseline | `startSnapshot(uint256,bytes)` | Hook only, during fund |
| Fix end blocks and start verification | `verifyFromSubmit(uint256)` | Hook only, during submit |
| Quote / prepay read fees | `prefundCost(uint256)` / payable `prefund(uint256)` | Public |
| Send/retry post-submit reads | payable `sendReads(uint256)` | Provider only |
| Retry baseline reads | payable `retrySnapshot(uint256)` | Client or provider |
| Apply a decided verdict after a failed kernel call | `settle(uint256)` | Public |
| Read evaluation state | `evaluationOf`, `specHashOf`, `ready`, `snapshotOf`, `answerOf`, request/height/evidence getters | Public views |

There is no public `verify(uint256)` entrypoint to call directly. A future SDK integration must map the existing lifecycle and caller restrictions, including fee prepayment, rather than calling the hook-only method. The question is which version to target and where compatible contracts will be deployed; these API names are already available in source.

## Validation and remaining dependency

Ran `forge test --match-contract '^(UniversalHookTest|UniversalEvaluatorTest|JobSpecLibrariesTest)$' --fuzz-runs 64 --json` against the clean sibling checkout at the fetched branch head: **69 passed, zero failed or skipped** (20 hook, 33 evaluator, 16 library). External dependencies in these tests are mocked; this does not prove live universal-read execution. [Summary and source hashes](validation-summary.json), [raw Foundry JSON, gzip](contract-tests.json.gz).

The separate [read-only Donut probe](live-deployment.json), pinned to block **24655950**, confirms marketplace `0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4` still names evaluator `0x1afC81396f1bb36F91f74506284952b81e4bd47c`, with zero code bytes. Its hook remains `0xDe7A94e510b6C571DE7880d441349689F73A32b3`; the `EVALUATOR()` probe reverts. No funded transaction or deployment was sent.

The SDK continues using the deployed marketplace schema. Automatic evaluation remains gated until the contracts team confirms the target shared schema and supplies matching marketplace/hook/evaluator deployment addresses and ABIs. [Concise team questions](../../questions.md).
