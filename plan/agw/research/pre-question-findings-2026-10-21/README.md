# Answers we could establish before asking the team: 21 October 2026

These answers come from read-only analysis of the deployed node, contract and gateway code, from on-chain data, and from funded testnet runs. The question drafts in `plan/agw/questions-*.md` now contain only what this work could not settle.

## Sources pinned

| Component | Deployed source | How confirmed |
|---|---|---|
| Push node (Donut) | `push-chain` `origin/testnet/donut` = release/v1.1.44-donut, `ca3b8d4e` | Newest upgrade `cea-read-ingest` applied at height 23,217,721 (abci `AppliedPlan`). Later commits on `develop` are not deployed |
| UniversalCore `0x…C0` | `push-chain-core-contracts` `origin/core-testnet`, `src/UniversalCore.sol` from `8bc60ae` | EIP-1967 proxy; implementation `0xa0023b356344ff623c7e20679cf9d170e44fbbd1` is verified on Blockscout. Compiling `8bc60ae` reproduces the bytecode; only the metadata hash differs. The exact verified file is not committed |
| Solana gateway `CFVS…` | Built from `push-chain-gateway-contracts` `pc20-3rd-iteration` (`da6cca5`…`bcbf7df`), with `declare_id` swapped to CFVS locally | Instruction-name strings, PC20 strings and the `emit_cpi` layout in the deployed binary (program data `DqeV1gi…`, deployed slot 496,655,369, 2026-09-11) match. No committed branch declares CFVS |
| AGW contracts | `ffd567d` (`deploy-agw` `e57998c`) | As in the review |

## Answers

### Routes and registry (Aman, core/node)
- **The Circle USDC `.old` routes settle outbound on all three chains.**
  - Owner-door sends of 0.01 USDC were delivered on Sepolia (`0x7de758af…`, 1,286,650 gas), Base (`0xcd4f3ab7…`) and Arbitrum (`0xbc22d5c6…`).
  - The DEXES Sepolia and LENDING Arbitrum presets also passed live over these routes.
- **Where they came from.** Node commit `c84f9a97` (2026-04-16) pointed the plain `USDC.*` names at new mock tokens and kept the previous Circle configs as `USDC.*.old`.
  - Nothing marks them deprecated.
  - `develop` no longer has their config files (dropped by merge `47ef4c9a`), so there is drift risk if configs are re-synced from `develop`.
- **`TokenConfig.enabled` is never read by the node.** A config's presence is what makes a route work.
  - Removing a config would block withdrawals for existing holders of that PRC20.
  - Outbound uses the registry's `address` as the destination token. The node never reads the PRC20's `SOURCE_TOKEN_ADDRESS`, so the zero word on Solana PRC20s does not matter to routing.
- **Adding a route is admin-curated.** `MsgAddTokenConfig` must be signed by the uregistry admin, `push1negskcfqu09j5zvpk7nhvacnwyy2mafffy7r6a`. A route also needs:
  - the PRC20 deployed and initialised for that exact source token;
  - UniversalCore gas token, base gas limit and voted gas prices;
  - a WPC pool for auto-swap;
  - destination gateway and vault support.
- **Reading the registry.** The public REST and gRPC endpoints are not reachable. Tendermint `abci_query /uregistry.v1.Query/AllTokenConfigs` works and is what `check-agw-route-registry.js` uses.

### Gas (core/node, gateway)
- **Unused EVM destination gas is refunded** to the wallet (the revert recipient) as PC, in a later Push transaction.
  - Example: our DEXES Sepolia subsequent send had gasFee 220,027,000,000 and used 362,079 gas at 220,027.
  - Refund `RefundUnusedGas` in tx `0x75fad72a…ea92` (block 24,472,797): 140,359,843,867 pETH-wei, swapped to 0.000205 PC.
  - So larger default gas limits cost only the gas actually used, minus swap slippage.
- **Unused Solana gas is also refunded.** The gateway keeps `gas_to_refund` in its vault and emits it. The node then refunds `gasFee − gas_used` the same way. Live events match: for example 960,000 budget, 695,880 used, 264,120 refunded.
  - If a Solana outbound never executes, the full gas fee is refunded.
- **Why the BNB testnet gas price jumps.**
  - Each validator reads `eth_gasPrice` from a different public RPC every interval and adds a 10% markup (operator config).
  - Donut has only two voters for BSC testnet, and the chain takes the upper median, which is the higher vote.
  - Providers report 0.05–1 gwei, and there is no smoothing or clamp.
- **Solana gas price.** The constant 1000 is the node's fallback when devnet priority fees are zero.
- **Base gas limits** (500,000 EVM; 960 Solana) are UniversalCore admin settings.
- **Gas limits are used as given.** The EVM destination transaction uses the request's gasLimit exactly, with no buffer. Solana compute is fixed at 400,000 CU; gasLimit only prices the fee.

### Failure handling and policy (Zaryab, core/node)
- **On a failed destination execution** the node re-mints the bridged PRC20 to the revert recipient (the wallet) and refunds unused gas.
  - Payload-only sends get no fund revert.
  - The protocol fee is not refunded.
- **Nothing calls `UniversalRulesPolicy.creditRevert`.** I searched all 161 node branches; the contract itself says it ships inert. So a failed agent send still counts against the rule's `maxTotal`. Wiring it is node work.
- **`MAX_NATIVE_ACTIONS = 8` is a deliberate sanity bound, not a gas bound** (`AGW.sol:73-86`; `docs/1_AGW.md:532,573`). It keeps a grant readable and bounds the duplicate scan and revoke cost. The session engine has no cap, and raising the limit is described as a design change.
- **Confirmed SvmRulebook gap: `fromEnd` data pins can be shifted by appending bytes.**
  - The instruction-data length is not tied to the matched rule; only a 1024-byte cap and an exact outer-payload length apply.
  - So an agent can append bytes that a `fromEnd` pin then reads.
  - Account pins still hold. Whether a target program ignores trailing data decides whether this is exploitable.
  - The SDK does not create `fromEnd` pins.

### Solana programs (gateway)
- **SPL Memo v2 works as a second test program.** Owner door: Push `0x480c55ae…`, Solana `kaQ3QrRC…`. Agent door: Push `0xae951445…`, Solana `4PF7bSEs…`.
  - The agent door used a rule with a raw 8-byte prefix and a CEA pin. A different prefix was refused before broadcast.
  - The gateway has no target-program allowlist; the CEA is the only CPI signer.
  - Payload trap: the payload's target must be zero or equal to the recipient. The SDK already sets it equal.

## Evidence files
- `live-routes-memo-evidence.json` and `live-routes-memo-results.log`: the five live cases above.
- Routed-preset and gas runs: `../../independent-review-creation-flow-2026-10-20/data/live-2026-10-21-*`.
- New opt-in e2e groups: `agw-exact-routes` (`__e2e__/agw/exact-routes-live.spec.ts`) and `agw-svm-memo` (`__e2e__/agw/svm-memo-live.spec.ts`).
