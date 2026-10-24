# SDK implementation acceptance — October 20

Implementation targets `sdk-iteration-v1@443b4e2`, AGW `ffd567d`, and the deployed v2 stack. This is separate from the earlier contract-only review in research/2026-10-20. Consumer documentation: [MARKETPLACE.md](../../../../packages/core/MARKETPLACE.md).

## Evidence

| Check | Result |
| --- | --- |
| Full units | [unit-results.json](unit-results.json): 2,205 passed, 12 existing skips, no failures |
| Fork E2Es | [fork-results.json](fork-results.json): 6 passed against real deployed v2/v6 on Anvil fork block 24447347 |
| Live smoke | [live-results.json](live-results.json), [transactions](live-evidence.json): runner exited 0; one matching test passed, none failed/pending |
| CEA routing | [cea-routing.json](cea-routing.json): three factory/account mismatches; BSC Testnet matches |
| API | [api-comparison.json](api-comparison.json): compiled public surface matches source. Recorded baseline changes include earlier AGW work; this is not an assertion that every listed delta was introduced by this checkpoint. |

Fork writes and evaluator/admin impersonation occur **only on localhost**. The paid case transfers existing pUSDC from a fork-impersonated holder to the test AGW, approves/pulls actual pUSDC into the real kernel, and checks the provider payout. It does not mint or transfer those tokens on public Donut. The live test has zero provider fee and no principal deposit/export or escrow transfer.

The local fixture uses actual viem actions/contracts, short polling, longer local RPC timeouts and explicit Anvil confirmation mining. No successful SDK/contract result is mocked. This avoids premature receipt queries falling through to the fork provider. Native sender confirmation timing can still make the run take around two minutes.

## Live scope and cleanup

Card 1 registered in the initial attempt; opening failed at gas estimation with the shared master, whose code is EIP-7702 delegation. That card was deactivated. No job was opened by that attempt. The SDK now gates delegated/contract owners before signing rather than applying an untested plain-EOA signature path.

The passing attempt used a new native owner and provider, registered card 2, opened job 1 on wallet `0xAc1A9778518AbaAE12367f7932C30c114d4940AE`, cancelled it and revoked its grant, then deactivated card 2. Public transaction hashes are in live-evidence.json. No signing keys or unbroadcast authorization payloads are retained here.

The existing CI reporter sampled `results.success` as false in its onRunComplete callback despite one passed test, zero failures and runner exit 0. The raw live report is retained unchanged. Assess this run using its test status/counts and actual runner exit; the discrepancy is recorded rather than silently rewriting evidence. It is not a claim of one clean full marketplace suite invocation across local/live groups.

## Commands

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --silent
node node_modules/jest/bin/jest.js --config packages/core/jest.marketplace-local.config.ts --runInBand
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live
node packages/core/scripts/check-agw-docs.js packages/core/MARKETPLACE.md
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
node packages/core/scripts/check-agw-package.js
node packages/core/scripts/check-agw-api.js --output /tmp/marketplace-api.json
```

Earlier selected test attempts exposed the old constant-key assertion, the three-chain CEA mismatch, local receipt timing and the test's card-version/implicit-price assumption. They were corrected or explicitly gated. The final unit/fork result files contain the final passing runs, not a claim that every earlier attempt passed.

No package publication, contract deployment, mainnet transaction, automated evaluator execution or destination protocol transaction was performed. Existing full AGW contract harness counts remain their earlier evidence; this checkpoint's real-contract coverage is the six SDK fork E2Es plus the live smoke.
