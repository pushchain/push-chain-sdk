# Donut live acceptance — October 6, 2026

Branch `feat/agw-sdk-v4`; runtime commits `a66ff7d` and `b68bab7`, acceptance-test commit `ab42b84`; deployed source `e8db74815cfbbf5389593805e464fe8d85f7f735`. This report supersedes the earlier restricted-environment and unrun-live status. Test funding and broadcasts were authorized by Shoaib. No contract was deployed and no team message was sent.

## Validation

| Check | Result |
| --- | --- |
| Full, unfiltered core unit suite | 1,947 passed, 0 failed; 12 existing skips; 113 passed suites, 1 skipped |
| SDK against actual v4 contracts on Anvil | 53 passed in 7 suites, including all 7 SVM integration cases |
| Focused gas/agent-send regressions | 36 passed |
| Typechecks | lib, spec, local harness and portable AGW E2E config pass |
| Build | Nx core:build passes |
| Changed AGW, VM client and acceptance-file lint | 0 errors; existing warnings retained |
| Existing full-core lint | 7 pre-existing errors in unchanged files |
| Explorer ABI comparison | All 5 ABI entry sets match the isolated source build |
| Public SDK Donut derive | Pass; read-only result recorded in the prior v4 report directory |
| Opt-in scenario selection | AGW remains 25 scenarios; default all remains 76 |

The 53 Anvil cases include actual factory/wallet/engine/validator/URP contracts, with gateway/core/token/executor fixtures. SVM uses encoded Solana terms/payloads inside that local EVM harness; this does not establish live Solana CPI or settlement. The separate 10 Foundry checks are not counted as 10 more SDK integration cases.

## Funded checks completed

All 25 registered AGW scenarios have passing live coverage across sequential selected runs. [Per-scenario results and log links](scenario-results.json). These include:

- Bare wallet creation and information reads.
- Creation with a native rule.
- Native agent transfer, owner transfer, over-cap rejection and stranger initialization rejection.
- Public two-asset grant/read/atomic update, including its five checkpoint ticks.
- Call-only outbound, with confirmed Sepolia delivery through the wallet's CEA.
- Positive-amount outbound: wallet token debit, bounded allowance reduction, confirmed Sepolia receipt, CEA balance increase and replay identity all pass.
- Destination revert: the Push leg succeeds and the receipt classifies the external outcome as failed.

This was not one complete group invocation: each registered title has a passing selected-run result, with fresh bounded fixtures. Logs include failed initial attempts as well as passing retries; a selected skip is not a pass. [Public wallet/transaction evidence](live-evidence.json) records events produced by successful cases. Individual cases without an evidence event remain verifiable in the saved Jest logs.

The completed coverage also includes native EIP-7702 batching and rollback, native rule add/update/checkpoint/revoke-all, explicit allowance set/remove, response hooks/replay, revoked and expired rule rejection, existing EVM-origin UEA identity, fresh EVM UEA first-use fee handling and Solana-origin UEA identity on a Push destination. Public Solana destinations remain capability-gated.

The initial lifecycle run asserted a removed diagnostic kind field from the test helper. On-chain spend/call counters matched. The obsolete field assertion was removed; the entire four-case lifecycle suite then passed. The independent counter, replacement/reset and checkpoint assertions were preserved.

The fresh EVM first-use test now uses the configured public RPC fallback and waits for the origin funding receipt before spending. [Read-only origin budget preflight](origin-preflight.json) preceded the bounded 0.003 ETH transfer; the existing Solana-origin case uses the configured devnet key. Origin keys were not printed or committed.

## Issues found and fixed

1. Donut rejects eth_getLogs ranges larger than 1,000 blocks. Snapshot paging now requests contiguous windows of at most 1,000 blocks. The regression verifies boundary coverage; bare wallet info now passes live.
2. A native gas PRC20 can return a static zero address from SOURCE_TOKEN_ADDRESS(), while ERC20-backed PRC20s return a dynamic string. Native mapping now verifies the registered gas PRC20 before accepting the static-zero result; other malformed metadata fails. The public two-asset grant/read/update now passes live.
3. Viem simulation revert bytes can be in cause.raw. Error extraction preserves them; all seven formerly blocked SVM Anvil cases now pass with named errors.
4. The Sepolia acceptance reader was using viem's default paid dRPC endpoint. It now uses the SDK's configured public RPC fallback. This is test-only transport configuration.
5. The initial positive-amount AGW → gateway → token transaction reverted with its exact RPC gas estimate. At the preceding block, replay fails at 483,168 gas and succeeds at 500,000 and larger limits. Direct gateway and token replays succeed. [Receipt and replay evidence](positive-revert-probe.json) isolates insufficient nested-call gas headroom. Estimated VM-client contract gas now receives 20% headroom, rounded up, consistent with the existing EIP-7702 path. Explicit gas limits and the 21,000-gas code-free EOA path are unchanged. This Push execution limit is separate from destination gas and the URP PC budget. The regression checks the observed estimate, explicit-gas preservation and EOA/delegated-account behavior. The passing Push receipt additionally records the exact pETH transfer from wallet to C1 and its C1-to-zero burn. [Push receipt/events and gas](positive-push-events.json).

## Funding and evidence boundaries

The loader uses packages/core/.env. Key values stay in memory and are redacted from copied artifacts; no key was printed or committed. [Read-only preflight](preflight.json) verifies chain 42101, deployment wiring, balances and bounded reserves before funding. Outbound setup uses a fresh wallet, 21 PC (20 PC ceiling plus 1), 0.000003 pETH and a bounded 0.000002 pETH gateway allowance. Each fresh Push agent receives 0.5 PC. Funding is separate from creation/rule grants.

Unspent funds can remain in fresh master-owned test wallets; no shared wallet was revoked or drained. Destination success checks use a fresh wallet CEA and independently verify its balance increase. A read-only check of the confirmed Sepolia receipt additionally verifies the `UniversalTxExecuted` emitter equals that CEA, originCaller equals the AGW, and target/data equal the intended counter/increment. [Attribution evidence](positive-destination-execution.json). The same assertion is now in the live test without submitting a duplicate funded transaction for that extra receipt check. creditRevert remains an executor dependency. A real far-side failure must not be treated as restoring the policy spend.

[Sanitized logs](logs/) preserve commands' output and initial failures; trailing whitespace/extra EOF blank lines were normalized for Git. No full security audit or complete release acceptance is claimed. Product H3/H4.5/H6, ref/label scope and public SVM mapping are separate remaining decisions.

## Reproduction

From the SDK root, using the existing local test environment:

```sh
AGW_LOCAL_DIR="${TMPDIR:-/tmp}/push-agw-local-v4" node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.lib.json --noEmit
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.spec.json --noEmit
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.agw-local.json --noEmit
node node_modules/typescript/bin/tsc --project plan/agw/research/v4-implementation-2026-10-06/tsconfig.agw-e2e.json --noEmit
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
```

The opt-in live command submits transactions and spends testnet funds. Use the same verified manifest and bounded fixtures, run sequentially, and choose scenarios deliberately:

```sh
AGW_E2E=1 AGW_E2E_AGENT_PC=0.5 node node_modules/jest/bin/jest.js --config packages/core/jest.e2e.config.ts --runInBand --forceExit --runTestsByPath packages/core/__e2e__/agw/universal-evm.spec.ts
```
