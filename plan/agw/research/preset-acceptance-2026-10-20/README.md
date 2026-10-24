# Preset acceptance, compatible tokens and gas — October 20, 2026

## Corrections (independent review, later the same day)

Details are in the [review](../../independent-review-creation-flow-2026-10-20/review.md).

- **Routes.** The node registry (uregistry) has enabled, Vault-backed routes for the exact Circle USDC on Sepolia, Base Sepolia and Arbitrum Sepolia. The SDK's symbol-keyed registry had omitted them, and the compatibility search below covered only that registry. After the SDK fix, DEXES Sepolia and LENDING Arbitrum Sepolia are route-ready; the other seven combinations remain blocked.
- **Gas.** "10 PC" is the SDK's $1 minimum budget at the fixed $0.10 rate used for Push-native signers. It is not a chain fee. On-chain `SwapAndBurnGas` shows 0.0008–2.37 PC actually consumed per send, with the remainder refunded in the same transaction.
- **Gas ceiling.** BNB testnet first sends exceed the 20 PC ceiling while Donut's BNB gas price is high (observed between 0.055 and 1.1 gwei).
- **Solana destination cost.** The relayer was reimbursed 2,184,320 lamports for the first send and 695,880 lamports for the subsequent send, including rent. The fee itself was 5,000 lamports.
- **Gateway allow-list.** The gateway's `isSupportedToken` is an inbound allow-list only. Outbound delivery needs Vault liquidity, or the TSS balance for native coins.
- **Live preset log.** `live-presets-blocked.log` was produced by an earlier revision of the spec file. The outcome is unchanged.

## Result

All nine unchanged preset payloads pass creation and exact readback against the pinned real v6 AGW/URP contracts with locally provisioned PRC20 stand-ins. Live unchanged-preset acceptance is blocked for all nine combinations before funding. Existing prefunded protocol tests remain useful but do not establish default-preset bridge availability.

A fresh public agent SPL test passed on Donut/devnet: exact asset caps and wallet ATA pin survive creation; wrong ATA and an excessive instruction amount are refused without agent nonce advancement; two agent sends credit the owned recipient's USDT ATA exactly. Both sends omit gasLimit. Stored spend reaches exactly 2,000 raw USDT units. This is test_counter.receive_spl, not a newly certified third-party Solana app. The funded run checked reverts and unchanged nonce; a subsequent pinned eth_call probe confirmed the exact SvmDataCeilingExceeded and SvmAccountPinMismatch gates at Donut block 24,456,030 (spl-rejections.json). The test assertions were then strengthened to require those decoded names; no second funded run was needed for that assertion tightening.

## Compatibility audit

Read-only script: `packages/core/scripts/check-agw-preset-compatibility.js`. It loads the shipped catalog and source-token registry, checks exact PRC20 source identities on Donut, and queries reserves/underlyings and factory pools at recorded destination blocks. Snapshot: 2026-10-20T15:18:15.748Z; Donut block 24455488. See compatibility.json for every query result.

| Network | Block | Routed-token compatibility |
|---|---|---|
| eip155:11155111 | 11956140 | No matched Aave reserve or fixed market/strategy underlying; no pool returned for queried routed ERC20 pairs at the preset router factory. |
| eip155:84532 | 48370608 | No matched Aave reserve or fixed market/strategy underlying; no pool returned for queried routed ERC20 pairs at the preset router factory. |
| eip155:421614 | 321097574 | No matched Aave reserve or fixed market/strategy underlying; no pool returned for queried routed ERC20 pairs at the preset router factory. |
| eip155:97 | 137909051 | No matched Aave reserve or fixed market/strategy underlying; no pool returned for queried routed ERC20 pairs at the preset router factory. |

No default-token substitutions were made. Adding arbitrary routed USDC/USDT would generate unusable lending/staking permissions; the queried DEX factories have no routed pair to execute. This is bounded evidence for the current registry, catalog contracts, queried fee tiers and block snapshots, not proof that no alternative protocol or unpublished route exists. Wrapped-native and native coins are not interchangeable.

The core/node/gateway team still needs to provide or provision exact source-token → PRC20 routes. The SDK can register verified mappings once provided. Mainnet execution was not attempted.

## SDK gas fix

Public Solana sends previously used gasLimit=1,000,000 when omitted. At the current Donut quote that requests 100 PC, exceeding a 20 PC rule. Omitted Solana gas now uses route sizing (0 as the quote input), retaining the existing live finalization/rent floor. Explicit gas inputs remain passed through. This changes neither rule caps nor the gas budget the owner authorizes.

Current read-only quotes show 10 PC attached for checked EVM inputs and route-sized Solana. The old explicit million-unit Solana input quotes 100 PC. These are quote observations, not fixed future fees. The 0.1 PC custom-rule UI prefill is too small for these observed quotes. The existing 20 PC preset ceiling covers the observations and the fresh SPL deliveries; custom rule authoring still requires an explicit budget.

Fresh SPL first-use quote: 10 PC, resolved input 2,285; subsequent quote: 10 PC, resolved input 960. On Solana the two transactions used 116,402 and 98,301 compute units and each charged a 5,000-lamport transaction fee. These differ from the quoted attached PC budget. Push signer gas was 0.0005265045 PC and 0.0005029245 PC respectively. See live-spl-evidence.json for hashes and Push blocks 24,455,663 and 24,455,695. No claim about exact net quote consumption/refunds is made.

## Acceptance commands

- Local: AGW_LOCAL_DIR=/tmp/agw-preset-defaults-v6 node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand --runTestsByPath packages/core/__agw-local__/preset-acceptance.spec.ts
- Live unchanged presets: opt-in group agw-presets-acceptance (9 explicit cases). Preflight checks all nine readiness results before any funding; tests do not silently skip blocked routes.
- Live public SPL: opt-in group agw-svm-agent-spl. Exact wallet ATA pin, instruction cap and actual recipient delivery are asserted.
- Live EVM gas: opt-in group agw-gas. Four native-token routes, two agent sends each; results recorded separately from preset acceptance.

## Validation and remaining scope

405 AGW unit tests pass, 9 new real-contract local cases pass, spec/local typechecks and core build pass, package/guide checks pass. All 14 new live scenario selectors resolve to their expected tests. The nine live preset cases fail explicitly on unavailable routes before any funding. The one live SPL case passes and includes two destination deliveries. All four live EVM gas scenarios pass, including first/subsequent sends on every testnet (eight destination deliveries). Together with SPL, five live scenarios establish ten destination deliveries. These are distinct from the nine blocked preset scenarios. The funded SPL run preceded the assertion-only tightening described above. ESLint reports no errors in changed test/source files; existing-style non-null assertions generate warnings.

No all-token wildcard, implicit arbitrary transfer permissions or default cap broadening was introduced. Apps-optional transfer recipients and all-token scope still require product/contract decisions. A separate devnet protocol recommendation still requires a compatible verified deployment; the successful SPL case continues to use the known test program.

Changes remain local on v4; no release or publication is performed by this task.

## Fresh EVM gas results

One clean run: 4 passed, 0 failed, 715.584 seconds. Each scenario created a fresh wallet/rule, exported the chain's native PRC20 twice, confirmed destination receipt success and CEA-origin execution, and checked exact destination native balances and total rule spend. No gasLimit was supplied to either send. These are the existing counter fixtures, not preset protocols.

| Testnet | First destination gas used | Subsequent destination gas used |
|---|---:|---:|
| Ethereum Sepolia | 1,265,722 | 223,683 |
| Base Sepolia | 325,448 | 123,187 |
| Arbitrum Sepolia | 325,424 | 123,163 |
| BNB testnet | 325,919 | 123,637 |

All observed attached quote budgets were 10 PC, within the explicit 20 PC rule ceiling. Keep this separate from measured destination fees and Push signer gas. Full hashes, block numbers and costs are in live-evm-gas-evidence.json. The EVM run used the same production code as the final state; a read-only RPC chain guard was added to the test source after invocation without changing sends or assertions for gas/delivery.
