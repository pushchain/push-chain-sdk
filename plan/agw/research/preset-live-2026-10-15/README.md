# Preset live acceptance — October 15, 2026

## Scope

Real Donut v6 wallets and real Sepolia protocol contracts; no mainnet broadcasts. Test group `agw-presets` is opt-in and excluded from `all`. It contains two distinct scenarios, verified against the actual test names.

The tests generate allowed calls through public presets.get and preserve their pins/approvals. They intentionally set the rule's bridge assets to []: Uniswap's WETH/Circle USDC and Aave's mock LINK do not form a supported SDK PRC20 pair. Destination accounts are prefunded separately (owner bridges ETH and wraps WETH; owner calls Aave's official testnet faucet). These tests prove destination balances can be used under preset permissions, not support for bridging arbitrary preset tokens.

## Uniswap — passed

- Fresh AGW, owner outbound wraps 0.000002 Sepolia ETH in its CEA.
- Agent uses the catalog's approval and exactInputSingle calls, with token, amount and wallet-recipient pins.
- Different recipient rejected by URP.
- 0.000001 WETH consumed; Circle USDC balance increased by 45,586 raw units.
- Destination success receipt and CEA UniversalTxExecuted event attribute the exact swap to the wallet. Exact output amount is observed evidence, not a future expectation.

Transaction hashes are retained in live-evidence.jsonl. No mainnet or mocked destination execution is included in this result.

## Aave — LINK passed; original USDC prerequisite failure retained

The initial USDC supply reverted on Sepolia with Error(51), SUPPLY_CAP_EXCEEDED in the official Aave Errors.sol. DAI and USDT also fail this gate. Read-only probes are in aave-prerequisites.json (block is an observed head, not a pinned snapshot across the calls). The test now uses faucet LINK and fails before funding if an unfunded supply probe cannot reach the expected token-balance check. The revised LINK test passed: faucet funding, agent approval/supply, and withdrawal of the same 10^12 raw LINK units all succeeded. Supply/Withdraw events identify the wallet CEA as user/beneficiary, and balances independently confirm the round trip. Direct mint on the underlying token is owner-restricted and is not used.

Error source: https://raw.githubusercontent.com/aave/aave-v3-core/master/contracts/protocol/libraries/helpers/Errors.sol. This is a protocol capacity issue, not a passing test or a silent skip.

Both scenarios passed in separate focused runs, not one combined invocation. The USDC attempt failed and remains in the evidence; the LINK result does not assert USDC capacity.

## Commands

From packages/core:

- `node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/preflight.ts --group agw-presets --dry-run` (run with initial one-scenario manifest; balances exceeded the subsequent combined budget).
- `node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/run.ts --group agw-presets` (initial Uniswap-only run).
- `AGW_E2E=1 node ../../node_modules/jest/bin/jest.js --config jest.e2e.config.ts --runInBand --forceExit --runTestsByPath __e2e__/agw/presets-live.spec.ts --testNamePattern 'agw presets live 2'` (Aave focused follow-up).
- `node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/run.ts --group agw-presets --list --verify` (two scenarios, two distinct tests).

Root validation: full unit suite 2,096 passed / 12 skipped; build, library/spec typechecks, public guide typecheck, package import/declaration check and source/compiled API check passed. No full old AGW live rerun was needed for the catalog-only additions.

## Remaining coverage

These original Sepolia results do not establish other-chain coverage. A subsequent [expanded run](../preset-expanded-live-2026-10-15/README.md) now establishes Base/Arbitrum Uniswap, BNB PancakeSwap/Venus, Base/Arbitrum Aave, Base Moonwell and Sepolia EigenLayer flows. Mainnet templates have official-source and read-only code checks only. Unsupported/unverified proposal entries are documented in the mainnet catalog review. No external protocol address was deployed or changed by this work.
