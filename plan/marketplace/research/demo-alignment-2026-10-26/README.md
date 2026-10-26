# Demo alignment and SDK work — October 26, 2026

Reviewed the user's `Downloads/marketplace_demo-main.zip` (SHA-256 `557c7d3c878d9cc36b025d6880960840aaaee997ad55d7886220eecf8cc9c6b6`). Seven reviewed entrypoints match Git blob hashes from [demo commit `0d765e0`](https://github.com/pushchain/marketplace_demo/tree/0d765e06418f1678f77ecd6434603ceecd5a708f). Extracted text only into a temporary review directory; skipped `.env.example`. The download was not changed and no demo CLI, agent, app or funding command was run. [Source manifest](demo-source-manifest.json).

The supplied thread records a proposed marketplace migration and Aman's preference for multi-chain cards. It does not supply final approval for timing/card/leg/fee choices. No proposed `legs[]` wire, four-leg limit or single-fee model was installed in the SDK.

## Verified current state

Fresh read-only evidence is pinned to Donut block **24663931**, with separate destination block pins. [Full report](live-deployments.json), [repeatable probe](../../scripts/check-demo-stack.cjs).

**CEA routing is resolved on all four supported chains.** Marketplace registration matches the SDK, `vault.CEAFactory()` and `gateway.CEA_FACTORY()`. The proxy implementation getter and sample AGW address derivation also match. The earlier probe used a lower-case gateway getter that reverted; the correctly cased getter now provides the routing evidence. No SDK factory constant was changed and the guard against future mismatch remains.

The sample from the conversation, AGW `0x3fE044FD8c3EDc0e7ab18cF35Eda254B4eC15F55` on Base, now derives `0xcB1e5EfFBee2f0d973a61dEF8eB84A7c5c5aBD42` through both the marketplace and canonical factory.

| Stack | Kernel | Hook | Evaluator | Token |
| --- | --- | --- | --- | --- |
| Live marketplace v2 | `0x977cf1AC973E9eC4332791d531507575006157Ed` | `0xDe7A94e510b6C571DE7880d441349689F73A32b3` | `0x1afC81396f1bb36F91f74506284952b81e4bd47c` (zero-code EOA) | pUSDC `0x7A58048036206bB898008b5bBDA85697DB1e5d66` |
| Pasted conversation / `demo-jobs` address file | `0x449C11cAFe57d8d9079058FeEef8e9E7E1DCBcE0` | `0xbee0B01773Dc742887f04bED58BD1B5Aa457ED96` | `0x2a73944D79E052bAF553F59fA1c7C23f3491845c` | eUSD `0x8E1eD40770cd197c80048cB3a86D3c8173cd560D` |
| Downloaded demo config | `0x4F9bbb7d75900DAc1631504BCf3047B199D7B1E0` | `0x360C1D85574580aa1B1213816C777fE3868D5BEC` | `0x7D6208f2008a54f6B1F613d3BF27008f6aEA4Ce3` | same eUSD |

Both demo hooks currently name the v6 factory/session engine. Both sampled evaluators point back at their corresponding kernel/hook. Their first four jobs canonically decode under the timing-first layout and fail the current timing-free decoder. Completed examples include the downloaded demo's six-read job #4. This observes existing state, not a fresh end-to-end execution.

The three relevant wires are distinct:

- Live marketplace v2: reads/checks/direct-check logic, mutability, origin, then timing.
- Demo: timing first, PRE/POST reads, summed checks, CHECK leaves, mutability, origin.
- SDK working target / [contracts PR #132](https://github.com/pushchain/push-chain-core-contracts/pull/132), `8666c2a`: PRE/POST reads, summed checks, CHECK leaves, mutability, origin; no timing.

Re-fetched branch heads remain `sdk-iteration-v1@443b4e2`, `feat/universal-evaluator-demo-jobs@f974840` and `feat/universal-evaluator-pre-post-reads@8666c2a`.

## What the demo establishes

`config.ts` has `marketplace: null`. `flow.ts` grants rules to an AGW and opens directly through kernel `createJob`; cards and their static verified flags are held in app code. This exercises the demo kernel/hook/evaluator path, rather than the on-chain marketplace registry/open/deposit implementation.

For the Diversifier, the app grants one rule per leg. `jobRules` collects them but returns `legs[0].rulesId` as the funding binding. This confirms why an approved multi-chain marketplace must bind/check every leg; copying that first-only binding into a multi-chain SDK adapter would not satisfy the proposed design.

The demo's PC fee headroom, explicit spec hash, pinned approvals and snapshot-ready handling match pieces already implemented in the SDK. Its test-token minting, static verified tags, old-format encoder and first-rule selection were not copied into SDK defaults.

## Implemented now

Picked up the provider's `submitWhenSeen` safeguard through optional `SubmitJobOptions.executionBlocks`. Supply every destination receipt block where work was performed. On the explicitly configured PRE/POST profile the SDK checks, at one Push snapshot:

1. The criteria match the frozen hash.
2. Each supplied chain is measured by POST reads.
3. Push's tracked height reaches the supplied work block and fits uint64.
4. The tracked observation satisfies the evaluator's `MAX_HEIGHT_AGE`.

A lagging chain returns `EXECUTION_BLOCK_NOT_TRACKED` and a stale observation returns `TRACKED_HEIGHT_STALE` before signing. The call does not automatically wait, submit or pay again. It is a preflight; the contract still chooses/checks its measurement blocks, and this does not add multi-chain cards or multi-rule hook binding. The map is copied before asynchronous reads. Calls without this option keep their existing behavior.

Added unit coverage and a local SDK scenario with POST/PRE reads on two chains, aggregate and per-chain checks. It refuses submit while one chain is behind the actual work block even though both heights moved since fund, then records the correct heights and completes after both are tracked. This is a plain kernel job with controlled metadata/results, not a multi-chain marketplace card acceptance.

Also corrected the stale read-only test claiming deposit orchestration remained a placeholder. CEA questions/status now reflect the verified fix; the unresolved team questions remain [format/rollout approval, timing fields and multi-chain card design](../../questions.md).

## Validation and limits

**2,306 unit tests pass** (12 existing skips). **Nine local evaluator SDK scenarios pass**, including the new cross-chain tracked-block test. Build/full spec/local types, changed production lint, source/built API equality, CJS/ESM/declaration/npm-content checks, nine marketplace guide blocks and E2E selection verification pass. The read-only deployment probe reports four matching CEA routes and confirms both demo formats; it writes no chain state.

[Validation summary](validation-summary.json), [unit results, gzip](unit-results.json.gz), [local results](local-results.json), [API comparison, gzip](api-comparison.json.gz), [checked files](checked-files.json).

The local harness uses real pinned v6 AGW, kernel, hook, evaluator and Read State, with mocked tracked-chain metadata and manually delivered consensus values. No fresh validator/TSS/destination execution was run. The earlier deployed-stack fork RPC limitation is not reclassified as a pass. No live transaction, contract upgrade/deployment, package publication, commit, push or team message was sent; all SDK changes remain local.
