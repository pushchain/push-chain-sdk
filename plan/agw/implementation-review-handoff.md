# AGW SDK implementation — review handoff

October 3, 2026. For the reviewing agent. The per-step status is in [implementation-status.md](implementation-status.md).

## Revisions

| Item | Revision |
| --- | --- |
| Branch | `feat/agw-sdk-impl` (local only, not pushed) |
| Base | `feat/agw-sdk-planning@349635b2254823488603b37f4b44c4f5c929feb9` |
| Commits | `07d8adc` adapter/registry/codecs · `e87c47b` management/execution/responses · `4488639` local harness + vectors · `00b62d4` unit tests · `ebc4167` READ.CHAIN / Web2 · `e63bcc9` E2E agw group · `fa90b2a` atomic multi-rule add |
| AGW source | `pushAgenticWallet_v3@e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9` (remote ref rechecked, unchanged) |
| Core / gateway | `universalMarketplace_v1@cb69e0b` / `pc20-3rd-iteration@bcbf7df` (rechecked, unchanged) |
| Target spec | Notion page 5 export 2026-10-03 13:23 IST; no newer export or answers found |
| Toolchain | forge/anvil 1.5.1-stable (b0a9dd9), solc 0.8.26 via IR, viem 2.27.2 |

The ABIs in `src/lib/agentic/contracts/abi/e704d5b` are generated from `plan/agw/research/validation-e704d5b/abi/*.json` (sha256 in each header). A fresh isolated build is ABI-identical to that evidence, and its runtime sizes match the validation report.

## What changed

New module `packages/core/src/lib/agentic/`:

| Area | Files |
| --- | --- |
| Types, errors, capabilities, registry | `agentic.types.ts`, `errors.ts`, `capabilities.ts`, `deployments.ts`, `constants.ts`, `chain.ts`, `revert.ts` |
| Contract adapter | `contracts/e704d5b.ts`, `contracts/reader.ts`, generated `contracts/abi/e704d5b/*` |
| Codecs | `codec/{ids,selectors,abi-layout,defaults,policy,native,session,universal,rules}.ts`, `codec/historical/e704d5b-universal.ts` (internal) |
| Reads | `reads/{snapshot,wallets,rules,checkpoints}.ts` |
| Writes | `management/{common,create,rules-write}.ts` |
| Execution | `execution/{guards,outbound,send}.ts`, `context.ts`, `runtime.ts`, `response.ts` |
| Namespace | `agentic.ts`, `wallet.ts`, `utils.ts`, `index.ts` |

Edited core files:
- `push-chain/push-chain.ts`: options type, `client.agentic`, agentic wiring, guards, reinitialize.
- `orchestrator/orchestrator.types.ts`: optional `agentic` response field.
- `orchestrator/internals/errors.ts` and `execute-standard.ts`: `cause` is kept.
- `progress-hook/*`: AGENTIC-TX family.
- `constants/{index,enums,read-state}.ts`, `read-state/{destination,read-params,read-state.types,read-tracker,spec-builder}.ts` and `orchestrator/route-detector.ts`: Web2.
- `utils.ts`, `lib/index.ts`: exports.

Tooling and tests:
- `scripts/agw-local/` (prepare.sh, gen-abi.mjs, harness contracts)
- `__agw-local__/` and `jest.agw-local.config.ts`, `tsconfig.agw-local.json`
- `src/lib/agentic/__tests__/`, `__fixtures__/e704d5b-vectors.json`
- `read-state/__tests__/web2-compat.spec.ts`
- `__e2e__/agw/`, `__e2e__/ci/{suite,run,preflight}.ts`
- `.github/workflows/e2e.yml`

## Public behaviour and its authority

| Change | Authority / assumption |
| --- | --- |
| `PushChain.initialize(signer, { agenticWallet })`; `universal.account` = wallet, `origin`/`getAccountStatus`/gas signer-scoped | Spec 2.a |
| `reinitialize` does not inherit `agenticWallet` | SDK-owned decision (sdk-owned-review) |
| Read-only client with `agenticWallet` resolves the context but never signs | SDK-owned decision |
| `client.agentic.derive/create/list/wallet`; handle `info/owner/checkpoints/rules.*` | Spec 1.a–1.m |
| `list()` includes the next undeployed slot | SDK interpretation of the spec example |
| `setLabel`, revoked `rules.get`, universal rule encode/decode/update, SVM, `compileCard` throw `CAPABILITY_UNAVAILABLE` | A07, A06, A05, H4.4, A08 |
| `ref` on a rule is refused unless the generation supports it (never dropped) | A07 |
| Omitted-limit defaults | A03 (provisional) |
| Approval selectors refused in universal agent rules; native approvals need a pinned spender | A01 (provisional), obligation 16 |
| Native agent arrays refused | A02 (provisional) |
| `DUPLICATE_RULE` used for ambiguous send-time candidates | sdk-owned-review |
| Extra codes: `CAPABILITY_UNAVAILABLE`, `GENERATION_UNSUPPORTED`, `READ_ONLY`, `NOT_WALLET_OWNER`, `RULE_NOT_FOUND`, `RULE_READ_FAILED`, `INCONSISTENT_READ`, `INDEX_RACE`, `CREATE_PARTIAL`, `RECEIPT_MISMATCH`, `AGENT_GAS_INSUFFICIENT`, `WALLET_BALANCE_INSUFFICIENT`, `GATEWAY_ALLOWANCE_INSUFFICIENT`, `RULE_LIMIT_EXCEEDED`, `INVALID_RULE` | SDK-owned; names not final until reviewed |
| `utils.agentic.rulesId(agent, nonce, {validator})`, `deriveWallet(owner, index, {factory, walletImplementation})` | A04 (provisional signatures) |
| `CONSTANTS.AGENTIC` is `{}`; `ENVELOPE_VERSION` omitted | A07 |
| `READ.CHAIN` (enumerable, `WEB2 = 'web2'`); `CHAIN.WEB2`/`READ.WEB2` now `'web2'`; `'web2:https'` accepted | Spec §4; legacy compatibility per G16 |
| `PushChainExecutionError` and `PushChainBatchExecutionError` exported; error keeps `cause` | Spec 3.f (`AgenticRevertError extends PushChainExecutionError`) |
| AGENTIC-TX 101/102/104/105/106/107/199-01/199-02, no 103 | Spec 3.f (PROPOSED) |

## Commands and results

Run from the repository root unless noted.

| Command | Result |
| --- | --- |
| `npx tsc -p packages/core/tsconfig.lib.json --noEmit` | clean |
| `npx tsc -p packages/core/tsconfig.spec.json --noEmit` (includes `__e2e__` and `ci/*.ts`) | clean |
| `yarn nx run core:build --skip-nx-cache` | success |
| `yarn nx run core:lint --skip-nx-cache` | 7 errors, 831 warnings; **all 7 errors pre-existing** in untouched files (`pc20/tracking.ts`, `pc20/__tests__/svm.spec.ts`, `__e2e__/docs-examples/13-read-state/*`); new code has warnings only (non-null assertions in tests) |
| `node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand` | 110 suites passed, 1 skipped (pre-existing); **1883 passed, 12 skipped, 0 failed** |
| …same, `packages/core/src/lib/agentic` | 6 suites, **123 passed** |
| …same, `read-state/__tests__/web2-compat.spec.ts` | **12 passed** |
| …the ten baseline suites from `research/sdk-owned-review-2026-10-03/test-summary.json` | **183 passed** (unchanged baseline) |
| `AGW_LOCAL_DIR=$(packages/core/scripts/agw-local/prepare.sh \| tail -1) node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand --forceExit` | 3 suites, **32 passed** |
| `AGW_WRITE_VECTORS=1` + the vectors spec, then without it | vectors regenerated deterministically and re-verified |
| `cd packages/core && yarn e2e:list --group agw` | 21 scenarios, 7 spec files |
| `yarn e2e:verify --group agw` | 21 scenarios, 7 files, 21 distinct tests, consistent |
| `yarn e2e:verify --group all` | **76 scenarios, 40 files, 81 tests: unchanged** (agw excluded) |
| `AGW_E2E=1 AGW_DEPLOYMENT_MANIFEST= npx jest -c jest.e2e.config.ts --runTestsByPath __e2e__/agw/create.spec.ts` | 2 failed with `AgwPrerequisiteError` (strict gate, intended); no RPC or broadcast |
| Same spec without `AGW_E2E` | skipped (not reported as passed) |
| `multi-asset-svm.spec.ts` | 7 todo |

Not run: `yarn e2e:preflight --group agw [--dry-run]` and `yarn e2e:ci --group agw`. Both need configured keys and a deployment manifest; no live run was authorized and no compatible deployment exists.

## Real contracts versus mocks

**Real contracts (local harness, pinned e704d5b on anvil chainId 9000).** SmartSession, AgentValidator, UniversalRulesPolicy (proxy), the AGW implementation and AGWFactory (proxy) decide every assertion about:
- authorization (owner door, agent door, stranger, `CallerIsNotAgent` path)
- policy enforcement: `CallLimitReached`, `ArgPinMismatch`, amount caps, `RulesExpired`, URP outbound gates 9–11 and the multicall allow-list
- IDs, wallet prediction and checkpoint sequencing (the five-tick replacement; OWNER_ACTION + RULES_GRANTED per batched grant)
- atomic `rules.update` and its rollback after an intervening agent spend
- revoke-all, sequential create partial failure and recovery
- allowance set/remove through the owner door, and allowance consumption

Committed vectors are contract-computed (`getPermissionId`, `predictWallet`, a real grant).

**Stubbed in the harness:**
- The gateway at `0x…C1`: models only pull + burn + fee arithmetic.
- The fee quote.
- The destination CEA address, for the outbound case.
- Only Push-EOA signers run; there is no UEA, precompile, Cosmos module, TSS, relay or destination execution.

**Mocks (unit).** Chain reads (`__tests__/fake-chain.ts`, an in-memory model of the views) and the signer transport (`mock-runtime.ts`). These test SDK logic only: selection, error mapping, call shapes, ordering, consistency checks and pre-signature guards.

**Live.** None. No transaction was broadcast to any testnet.

## Blockers and placeholders

- **A07 — no verified compatible deployment.** Every AGW call on a real network fails with `GENERATION_UNSUPPORTED`. The E2E group fails its gate, and preflight refuses to fund. To onboard:
  1. Write a manifest per `__e2e__/agw/_manifest.ts`.
  2. Add a verified entry to `VERIFIED_DEPLOYMENTS` in `deployments.ts`, and populate `CONSTANTS.AGENTIC` from it.
  3. Pass `AGW_DEPLOYMENT_MANIFEST` in `.github/workflows/e2e.yml`. It is not wired there yet.
- **A05.** Universal rules through the public `UniversalRule` (assets[]), universal `rules.update`, multi-asset `Spent`, and universal decoding in `rules.list`. That last one makes `list` fail outright on a wallet holding a universal rule, rather than truncate.
- **Universal E2E scenario 7.** It grants with the internal historical single-asset codec as fixture setup. This is valid only for an e704d5b-ABI deployment.
- **A06.** Revoked-rule history.
- **A08.** `compileCard`.
- **SVM destinations.** H4.4 and obligations 19–23.
- **A01–A04.** Implemented as provisional behaviour behind single modules (`codec/policy.ts`, `codec/defaults.ts`, `utils.ts`).
- **Step 17.** Release documentation, examples and a changeset are not written.

## Areas most needing review

1. **`CHAIN.WEB2` / `READ.WEB2` value change** from `'web2:https'` to `'web2'`. Spec alias semantics require it, and comparisons against the constants still work. Code comparing against the old literal would break.
2. **Owner-door outbound approval.** It approves `currentAllowance + amount`, then sends, in one owner batch. A standing agent allowance is preserved. The agent path never approves.
3. **Checkpoint semantics of batched writes.**
   - Multi-ID revoke and multi-rule add use one owner `execute` batch, for atomicity and one signature.
   - This adds one OWNER_ACTION tick per call on top of RULES_REVOKED / RULES_GRANTED.
   - Single-ID revoke and single-rule add stay direct (one tick).
   - `create` uses the signer's batch, which is sequential on a 7702-less Push EOA, reported as `CREATE_PARTIAL`.
4. **`create` index race.** It is detected after the fact (`INDEX_RACE`). Concurrent creates by the same owner can land grants on the raced wallet, and the error details say so.
5. **Decoded native pins/amount report `arg` as a head-word index** (`(offset - 4) / 32`). This is exact only when every preceding argument is one head word. The stored terms carry no signature.
6. **Agent gas guard.**
   - It mirrors R1's fee-lock condition, using R1's default 1e7 gas estimate when no `gasLimit` is given.
   - Formula: `balance < (gasLimit ?? 1e7) * gasPrice`.
   - It applies to every agentic send by an external signer whose UEA is deployed.
7. **`universal.read`/`executeReads` in agentic mode.** They execute through the wallet, check the wallet's balance, and default `refundTo` to the wallet. An agent needs a native rule for the read registry entrypoint.
8. **`trackTransaction` replay adaptation.** It runs only for wallets of a registered generation. Otherwise the response is unchanged. One extra RPC per tracked AGW call.
9. **`PolicyCheckReverted` decoding.** The inner error is named by selector only, because its arguments are truncated by the engine. The SDK also extracts revert data from viem's "custom error 0x…: …" text, because the R1 path previously discarded the cause.
10. **viem `decodeEventLog` pitfall.** With a single-event ABI, viem skips the topic0 check. All AGW log parsers match topic0 explicitly. Other SDK modules were not audited for this.
11. **Pre-existing inconsistency.** `CHAIN.PUSH_LOCALNET` is `eip155:9001` but `CHAIN_INFO[PUSH_LOCALNET].chainId` is `9000`. The harness follows `CHAIN_INFO`, and native rule chains derive from `CHAIN_INFO`.
12. **E2E specs have never executed live.** Expect adjustment on first run: budgets, fee sizing (`AGW_E2E_MAX_PC_PER_CALL`), destination-revert classification text, and first-use event IDs.

## Reproducing the local harness

```sh
OUT=$(packages/core/scripts/agw-local/prepare.sh | tail -1)   # isolated git archive + pinned submodules + forge build
AGW_LOCAL_DIR=$OUT node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand --forceExit
```

`prepare.sh` reads the AGW repo with `git archive`/`ls-tree` only, and never touches its working tree. The harness uses anvil's public development keys and broadcasts only to the local anvil it spawns.
