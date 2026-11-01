# AGW SDK implementation agent handoff

Copy the prompt below into the implementation agent. It authorizes implementation and local validation of the settled work, plus E2E test development. Product/contract decisions remain tracked dependencies. Another agent will review the resulting implementation.

---

You are implementing AGW support in the Push Chain SDK. Work through the implementation plan and complete as much verified, useful implementation as possible while product and contract answers are pending. Implement the code, add meaningful unit tests and E2E scenarios, run the appropriate available checks, and leave a precise review handoff. Do not stop after producing a plan or an empty namespace.

## Workspace and starting point

SDK repository:
`/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk`

Sibling repositories:
- `/Users/shoaibmohammed/Desktop/work/PUSH/push-agentic-wallets`
- `/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-core-contracts`
- `/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-gateway-contracts`

Planning branch: `feat/agw-sdk-planning`, last committed planning baseline `349635b2254823488603b37f4b44c4f5c929feb9`. This handoff file may be a subsequent local addition. Inspect status before changing branches. Preserve existing work and applicable repository instructions. Use a separate feature branch or isolated worktree based on the planning branch; do not reset or overwrite another agent's changes. Do not merge, publish packages or send team messages as part of this task.

The sibling AGW working checkout may be on old main (`9ddd954`). Use the intended revision, not whatever happens to be checked out. Our reviewed AGW source is `pushAgenticWallet_v3@e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9`; core marketplace is `cb69e0ba101bef1bb4440e54b2c45396be3e92ce`; gateway is `bcbf7df42e8e6dd11088a43bcc0b056a54ea0a18`. Recheck remote refs and record any drift. Read changed source before revising conclusions. Historical Donut addresses are not a deployment of the target ABI.

## Read before coding

Read these in order under `plan/agw/`:

1. `README.md`, `current-baseline.md`, `SOURCES.md`.
2. `notion/5-sdk-agw.md` — authoritative target public SDK API.
3. `implementation-plan.md` — full 17-step plan, proposed modules and acceptance criteria.
4. `sdk-design-review.md`, `sdk-owned-review.md`.
5. `external-blockers.md`, `questions-harsh.md`, `questions-zaryab.md`.
6. `contract-integrator-obligations.md`, `gaps.md`.
7. `research/sdk-owned-review-2026-10-03/README.md` and `research/validation-e704d5b/README.md`.

Read pinned AGW `docs/1_AGW.md`, `docs/2_UniversalRulesPolicy.md` and exact source when implementing a consequential contract interaction. The public target wins over historical behavior, but a target feature cannot be presented as usable against an incompatible ABI.

Notion snapshots were exported October 3, 2026 at 13:23 IST. Later edits are not included. Check whether answers or refreshed snapshots have been added to the workspace; consume confirmed answers and record their source. Do not invent product approval.

## Implementation objective and stopping boundary

Start with namespace/types, signer-versus-wallet context, lifecycle/read-only guards, contract adapter interfaces and generation handling. Continue through wallet reads, settled identity utilities, creation/recovery structure, native/owner wrappers, response/error/hook adaptation and independent Web2 compatibility where inputs are available. Use the plan's dependency ordering.

For each unresolved feature, isolate the dependency and continue independent work. Do not stop the entire implementation because deployment or multi-asset encoding is pending. Conversely, scaffolding that throws an unsupported-feature error is not a completed codec or live feature.

A01–A08 are explicitly tracked in the plan:

- Product policy/default/type assumptions remain provisional until confirmed.
- A05 needs final multi-asset terms, per-token read and expected-spend assertion ABIs/vectors.
- A06 needs agreed historical-rule scope and reliable metadata.
- A07 needs matching source/metadata capabilities and an actual verified deployment manifest.
- A08 needs canonical card schema/encoding and shared compiler vectors; it is separate from basic AGW execution.
- SVM destination scope and representable public rules require explicit matching capabilities; Solana-origin identity is a different concern.

Use explicit internal capabilities and fail before signing for missing artifacts or unsupported behavior. Do not insert fake addresses, guessed envelope layouts, success-shaped placeholder results or `any` escapes into the published surface. Do not convert assets[] to a single asset silently. Keep historical single-asset code/vectors explicitly versioned and out of the advertised target path.

Implement all currently unblocked work, then report exact remaining dependencies. Full-feature release is not required while external artifacts are unavailable. Production contract changes are outside this SDK task; review-only local fixtures are permitted.

## Architecture and invariants

Follow the proposed modules in the implementation plan and the existing SDK conventions. Keep AGW contract/version logic centralized, and preserve ordinary-client behavior.

1. Keep signer origin, signer Push identity and AGW execution address distinct. `universal.account` becomes AGW in agentic mode; `universal.origin` and account-status/gas identity remain signer-scoped.
2. `client.agentic.wallet(address)` is a management handle. It does not silently change the execution account.
3. Derive/list/create owner wallets from the connected signer's Push identity. External EVM or Solana keys use the UEA for their actual origin chain.
4. The owner uses execute. An agent uses executeAsAgent under a matching enabled rule. Do not implement the retired session-key signature model or fork SmartSession.
5. Resolve rules on every send. Zero candidates fails before signing; multiple enabled candidates fail explicitly. Do not filter expiry and thereby move the specified on-chain failure into an invented SDK policy engine.
6. Read-only clients never sign. Reinitialize requires explicit AGW selection under our recorded design and reruns role/capability checks. Audit all transaction-producing entry points, not just sendTransaction.
7. Create deploys/grants only; funding and approvals are separate. Preserve atomic/sequential strategy, confirmed hashes, pending hash and recoverable partial state. Do not automatically deploy another wallet after a grant failure.
8. Existing-wallet replacement must be one owner-wallet batch: assert expected spend → revoke → grant. Never fall back to sequential execution. Preserve counter-reset semantics and verify stale-spend rollback with the final ABI.
9. Gateway allowance setup uses bounded owner execute calls, with replenishment/removal. Do not inject an approval into the universal agent path.
10. Compose AGW outbounds explicitly. Under the pinned policy: empty EVM recipient bytes, AGW refund recipient, nonzero maxPCForGas and policy-compatible multicall. Resolve CEA from AGW, not from the signer. Keep wallet PC separate from signer gas.
11. Generate beneficiary/pin offsets from representable ABI layouts. Resolve destination tokens/native markers with trusted context and exact source-chain checks. Pure helpers receive pre-resolved context; they perform no hidden RPC calls.
12. Record checkpoint counts/events accurately. A current assert/revoke/grant replacement emits five ticks; allowance pulls can change balances without ticks. Do not substitute a block-only comparison for count comparison.
13. Preserve logical AGW from and signer origin in both live and reconstructed responses. Management responses remain owner-scoped. Preserve raw transport metadata, error causes/decoded fields and partial-failure hashes.
14. Preserve init/per-call progress hooks through wait without duplicates. Follow refreshed event IDs, including removal of AGENTIC-TX-103.
15. Normalize new Web2 public input to the existing web2/https wire identity; keep legacy input compatibility and transaction/read type separation.
16. Document exact capability limits. Do not treat passing mocks, source compilation or a skipped live scenario as deployed integration success.

## Existing test architecture you must use

This handoff was prepared after reading the current test runners and representative suites.

| Existing file or directory | What to reuse or preserve |
| --- | --- |
| `packages/core/jest.config.ts` | Unit configuration: src specs/tests, ts-jest, 30-second default; excludes live integration-style suites and __e2e__ |
| `packages/core/jest.e2e.config.ts` | Separate live E2E config: __e2e__ specs, 300-second default, shared setup and file reporter |
| `packages/core/__e2e__/ci/suite.ts` | Curated scenarios with stable ID, group, file, full-name regex, asset needs and optional environment flags |
| `packages/core/__e2e__/ci/run.ts` | Offline --list/--verify; serial live Jest execution; Ethereum Sepolia fixture restriction; custom reporting |
| `packages/core/__e2e__/ci/preflight.ts` | Master/UEA/CEA balance budget checks; normal mode can fund accounts; --dry-run is read-only |
| `.github/workflows/e2e.yml` | Manual workflow_dispatch only, serial funded-key concurrency, verify → preflight → tests, always-uploaded logs |
| `packages/core/__e2e__/shared/setup.ts` | Existing environment loading convention; do not print credentials |
| `shared/evm-client.ts`, `svm-client.ts`, `chain-fixtures.ts` | Signer/client and chain fixture conventions |
| `shared/progress-tracker.ts`, `validators.ts` | Progress capture and baseline response checks; extend with AGW-specific identity/state assertions |
| `shared/external-tx-verifier.ts` | Independent external receipt verification |
| `shared/outbound-helpers.ts`, `fresh-wallet.ts` | Funding and fresh-account patterns; audit assumptions because current helpers are signer/UEA-oriented |
| `shared/e2e-file-reporter.js`, `ci/ci-reporter.js` | Logs and BigInt-safe result serialization |

Paths abbreviated as `shared/...` or `ci/...` above are under `packages/core/__e2e__/`.

Representative suites to read:
- `packages/core/__e2e__/push/native.spec.ts`
- `packages/core/__e2e__/push/pushpay-native-multicall.spec.ts`
- `packages/core/__e2e__/push/track-transaction.spec.ts`
- `packages/core/__e2e__/evm/outbound/uea-to-cea.spec.ts`
- `packages/core/__e2e__/read/_shared.ts` and `read/evm/api-coverage.spec.ts`

The existing offline manifest verification passed: 76 selected scenarios, 40 spec files, 81 distinct tests for group all. This verifies selection consistency, not live E2E execution. Ten existing SDK unit suites previously passed 183 tests; four additional Solidity allowance experiments passed separately. Those are baselines, not coverage of your new implementation.

Some older live tests use `if (skipE2E) return` inside tests. Do not copy that pattern: it can produce a passing test that executed no assertions. Missing deployment/keys/capabilities must be reported explicitly as unavailable, and an intentionally selected strict AGW run must fail its prerequisite gate rather than report success.

## Required unit and local integration coverage

Add meaningful tests beside the new modules under `packages/core/src/lib/agentic/` and at the existing orchestrator/push-chain integration boundaries. Mock RPC/signing/broadcast boundaries. Unit runs must not depend on funded keys or contact live networks.

Cover the behavior implemented in each increment:

| Area | Required cases |
| --- | --- |
| Initialization/context | Owner/agent/unknown identity; undeployed or foreign wallet; unsupported generation; signer origin versus AGW account; read-only; reinitialize changes |
| Rule selection | No match, one match, direct-grant duplicates, revoked and expired rules, per-send refresh, RPC failure not treated as empty state |
| Guards | Forbidden from/methods rejected before signer invocation; native agent arrays under the chosen scope; auxiliary transaction entry points |
| Codecs | Contract-generated vectors, exact IDs, generation inputs, native pins, ABI offsets/dynamic layout rejection, wrong beneficiary, token chain/native marker, round trips |
| Multi-asset behavior | Per-token units/counters, caps, omission versus zero, duplicates and empty-assets routing, only after matching artifacts exist |
| Reads | Empty owner, next index, deployment labels, consistent block reads, pagination/reorg handling, checkpoint ordering, unknown/revoked/history scope |
| Creation | Empty/multiple rules, grant order and returned IDs, atomic and sequential capability, failed/pending step, committed hashes, nonce/index races and safe recovery |
| Rule writes | Wrong owner, bare revoke failure, selected/all revocation, replacement stale spend, failed grant rollback, reset counters and checkpoint deltas |
| Composition/gas | AGW CEA/refund identity, bytes-empty recipient, nonzero gas cap, separate funding/gas balances, first-use UEA exception, no injected agent approval |
| Responses | Logical from and origin on response/wait/replay; Push revert versus destination revert/timeout; exact error identity/decoded data; no duplicate progress |
| Compatibility | Ordinary routes and exports, read-only behavior, Web2 new/legacy inputs and unchanged wire identity |

Use real pinned contract artifacts in an isolated local EVM/Foundry integration harness where available to verify authorization and atomicity beyond mocks. Keep ABI/vector provenance. Any Push precompile mocking or stub gateway must be explicitly documented as a limit. Local execution does not prove node/TSS/destination settlement.

For blocked cases, document the missing artifact and add a clearly labeled pending test specification if useful. Do not fill a suite with trivial skipped tests or assertions that only repeat your own helper output and count that as coverage.

## Required E2E additions

Proposed location: `packages/core/__e2e__/agw/`, with a shared fixture file for owner, agent, deployment manifest, wallet creation, controlled funding and cleanup. Use public SDK methods for the behavior under test. Raw RPC is appropriate for independent verification; raw calls may set up a fixture but must not replace the SDK operation being tested.

Add scenarios for:

1. Create a bare wallet and a wallet with rules; verify factory ownership/index, returned IDs and no implicit funding.
2. Separate funding and bounded gateway allowance; verify setup/removal and distinguish owner/agent gas from AGW PC.
3. Native owner and agent success with independent target-state verification.
4. Unauthorized sender, missing/revoked rule, expiry and cap/beneficiary failures; assert exact failure and unchanged protected state.
5. Add/revoke/update lifecycle; verify old ID disabled, new ID usable, counter reset and atomic rollback when spend changes.
6. Checkpoint count/event behavior, including the current five-tick replacement and no claim that all allowance pulls tick.
7. Positive-amount EVM universal execution: real allowance consumption/pull/burn, expected AGW CEA, correct destination target effects, wallet refund identity, Push/destination receipts and replayed tracking.
8. Destination failure and timeout classification; document inactive creditRevert accounting where applicable.
9. External EVM-agent UEA identity and first-use/subsequent gas behavior. Add Solana-origin coverage separately from SVM destination coverage.
10. Init/per-call hooks through wait and AGW logical from/signer origin across both sends and reconstructed transactions.
11. New multi-asset enforcement and supported SVM destination scenarios once their compatible contracts exist.

Integration into the current runner:

- Add an explicit curated `agw` group in suite.ts and the manual workflow choice. Register unique scenario IDs and narrowly scoped regexes; run --verify to catch missing, overlapping and collateral matches.
- Keep execution serial (`--runInBand`) and existing workflow concurrency. Shared funded accounts must not race nonces.
- Extend preflight budgeting for actual payers: owner setup gas, agent gas, wallet PC/assets, destination prerequisites and any fresh-account funding. The existing UEA budget alone does not cover AGW execution. Validate compatible deployment/capabilities before funding.
- Use fresh per-run wallets/rule IDs where possible, make funding bounded and explicit, and avoid destructive cleanup of shared accounts.
- Keep --list and --verify offline and side-effect-free. Additions must not fund/deploy from module import or title collection.
- Prevent incomplete AGW scenarios from being silently added to default all. Define explicit selection/prerequisite behavior while the compatible deployment is pending; retain existing group semantics for other tests.
- Preserve the custom BigInt-safe CI reporter. Do not replace it with raw Jest JSON serialization for live tests. Distinguish filtered tests, missing prerequisites, deliberately deferred capabilities and actual failures in your handoff.
- Capture deployment/source pins, public account addresses, network/blocks, transaction IDs, expected versus observed state and test counts. Never log private keys, seed phrases or full credential-bearing URLs.

## Commands and execution boundaries

From repository root, unit checks use the current config, for example:

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --runTestsByPath <changed-unit-specs>
yarn nx run core:build
yarn nx run core:lint
```

Use actual spec paths and inspect the current Nx targets before invoking them. Run relevant existing regression suites in addition to new tests. Report baseline failures separately rather than weakening assertions or fixing unrelated modules indiscriminately.

From `packages/core`, after registering the proposed agw group:

```sh
yarn e2e:list --group agw
yarn e2e:verify --group agw
yarn e2e:verify --group all
```

These are offline selection checks. `--verify` parses test titles; it does not type-check or execute your tests. Add a no-broadcast type-check/compile check for new E2E code and report pre-existing type failures separately.

The following are live operations or require live configuration:

```sh
yarn e2e:preflight --group agw --dry-run
yarn e2e:preflight --group agw
yarn e2e:ci --group agw
```

Dry-run performs balance/RPC checks. Normal preflight may transfer funds. Live E2Es broadcast testnet transactions. This handoff requests adding E2Es and running local/offline validation; it does not by itself authorize spending configured funds, deploying contracts or triggering live CI. Run live tests only with separately established authorization, a compatible verified deployment and a bounded test budget. Keep implementing and validating independent work if live prerequisites are unavailable; record the precise blocker.

Never run an unfiltered live suite just to see what happens. Do not read or print .env contents; use the repository's environment-loading conventions when an authorized run needs configured secrets.

## Deliverables for the review agent

1. Focused implementation changes with stable internal boundaries and matching unit tests.
2. Real E2E scenario implementations, manifest/preflight/runner integration as needed, and explicit readiness status for each scenario.
3. `plan/agw/implementation-status.md` with a per-step matrix: implemented, unit/local-verified, live-verified or blocked. Record A01–A08 decisions and artifact dependencies individually.
4. `plan/agw/implementation-review-handoff.md` containing:
   - Branch/base/source/spec revisions and files/modules changed.
   - Public behavior/signature changes and their authority or assumption ID.
   - Exact commands, pass/fail/skip counts, test-selection verification and limits.
   - Which test assertions exercise real contracts versus mocks.
   - Live results with transaction IDs, or an explicit statement that no live run occurred.
   - Remaining external blockers, placeholders and areas most needing review.
5. Keep source snapshots intact and update plan/gap statuses only when evidence warrants closure. Do not turn assumed behavior into an approved decision.

Before finishing, inspect the diff, run formatting/type/build/lint and relevant tests, check that unsupported paths fail before signing, and verify no secrets or generated dependency trees were added. Do not claim the whole AGW SDK is complete if advertised methods still depend on placeholders or unverified deployments.

Begin with the foundation and continue through every safely implementable step. Leave the work concrete and reviewable so a separate agent can validate correctness, scope and test quality.
