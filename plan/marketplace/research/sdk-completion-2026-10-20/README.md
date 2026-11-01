# Deposits, paid preview and external EVM owners — October 20

Follow-up to the first SDK checkpoint `fbd0e032`. Targets remain UniversalMarketplace v2 `443b4e2`, AGW v6 `ffd567d` and the pUSDC/manual-evaluator Donut deployment. [API coverage and remaining work](../../implementation-status.md), [consumer guide](../../../../packages/core/MARKETPLACE.md).

## Acceptance

| Check | Result / evidence |
| --- | --- |
| Full units | 2,228 passed, 12 existing skips, no failures; [losslessly compressed Jest output](unit-results.json.gz) |
| Real-stack fork | Eight passed on an isolated Anvil fork at block 24447347; [Jest output](fork-results.json) |
| Live | Three passed, none failed/skipped, runner exited 0; [raw report](live-results.json), [transactions and read request](live-evidence.json) |
| Cleanup | Card 3 inactive; jobs 2/3 Rejected (kernel ordinal 4), both grants disabled; [read-only post-state](post-live-state.json) |
| Package | Build, library/spec/fork types, changed-production lint, CJS/ESM imports, compiled guide declarations, npm dry-run contents and six source-guide TS blocks pass |
| API | Source and compiled surfaces match; [report](api-comparison.json). Its comparison baseline predates this checkpoint and includes earlier SDK changes. |

The 23 added unit cases cover historical/shared-token deposits, shortages before writes, pending receipt/broadcast recovery, origin-route matching, already-used permissions, fee caps, template CEA resolution, immutable preview inputs, dynamic ABI paths, unknown/baseline logic, typed-signing gates and domain mismatch before prompting. Fork tests add actual principal/fee/PC deposits after a card update, fresh-client history recovery, a wrong-signature simulation failure and a real UEA owner signature to the earlier lifecycle coverage.

The fork's UEA signature case uses a native submitting transport because Anvil does not implement Cosmos MsgExecutePayload. It verifies the actual UEA/factory/wallet signature path. The separate live case opens and cancels through the real external EVM owner's SDK UEA transport. No successful contract or SDK outcome is fabricated.

The live paid preview submits a raw BSC Testnet ERC20 balance read through the registry and reaches validator consensus (`SUCCESS`, decoded zero). Its quoted/paid callback-plus-protocol deposit is 0.0016875 PC, below the explicit 0.01 PC request cap; native transaction gas is separate. The criterion is balance >= 0, a smoke check rather than evidence of a completed strategy. Requests and hashes are retained without keys or unbroadcast signatures.

The existing CI reporter again sampled `success: false` in onRunComplete despite three passed tests and runner exit 0. Its report is preserved unchanged; [validation summary](validation-summary.json) records the counts and actual exit separately.

## Limits

- Principal, pUSDC escrow and payout transfers are fork-only, using existing assets borrowed under local impersonation. Live funding uses bounded PC for fresh wallets, gas and a read callback. No destination protocol transaction or automatic evaluator verdict is claimed.
- Explicit origin-bridge deposits are unit-tested, including wrong-chain rejection and recovery; funded inbound bridging through `market.deposit` still needs its own live acceptance.
- Deposits are separate transactions and target current wallet balances. They require Open/unexpired jobs and unused enabled permissions. Available historical state is required; same-block version ambiguity fails closed. PC defaults to one card gas cap rather than a whole-job estimate. Coordinate other deposit clients and keep the agent idle during funding.
- Arbitrary ERC-1271 adapters and EIP-7702 delegates require their own acceptance. Full signed-request simulation prevents broadcast when the deployed owner verifier refuses a signature. An undeployed external UEA is refused before signing.
- Three CEA rollout mismatches and the incompatible/missing automatic evaluator remain documented dependencies. No global routing address was changed to bypass a guard.
- No marketplace, kernel, hook or evaluator was deployed or upgraded; only fresh test accounts/wallets were created through existing factories. No package was published.

## Reproduction

```sh
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --silent
node node_modules/jest/bin/jest.js --config packages/core/jest.marketplace-local.config.ts --runInBand
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live --verify
node node_modules/ts-node/dist/bin.js --compiler-options '{"module":"commonjs"}' packages/core/__e2e__/ci/run.ts --group marketplace-live
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.spec.json --noEmit
node node_modules/typescript/bin/tsc -p packages/core/tsconfig.marketplace-local.json --noEmit
node packages/core/scripts/check-agw-docs.js packages/core/MARKETPLACE.md
node packages/core/scripts/check-agw-package.js
node packages/core/scripts/check-agw-api.js --output /tmp/marketplace-api.json
```

Marketplace live remains opt-in and needs the existing test fixture configuration. Default `all` selection is unchanged. Checksums of retained raw results and checked source files are recorded in [validation summary](validation-summary.json) and [checked files](checked-files.json).
