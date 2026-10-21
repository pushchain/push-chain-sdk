# Evidence: independent review, 20 October 2026

Review window: 16:00Z–16:45Z on 20 October 2026.

I made no changes to production code, made no commits or pushes, published nothing, deployed nothing and broadcast no transactions. I did not load `.env` files or keys.

## 1. Revisions and working tree

### SDK `push-chain-sdk`, branch `feat/agw-sdk-v4`

- HEAD `525c7186795b43ce1d9c9436701080826b049e22`, which matches `origin/feat/agw-sdk-v4`.
- Working tree at the start and the end of the review was the same 17 entries (`git status --porcelain` md5 `292be838177608c819a080d17cc388ca`).
- Modified, tracked: `packages/core/AGW.md`, `__e2e__/ci/preflight.ts`, `__e2e__/ci/suite.ts`, `src/lib/agentic/execution/svm-public.ts`, `plan/agw/implementation-status.md`, `plan/agw/questions-harsh.md`, `plan/agw/questions-zaryab.md`.
- Untracked:
  - `__agw-local__/preset-acceptance.spec.ts`
  - `__e2e__/agw/{gas-live,presets-acceptance,svm-agent-spl}.spec.ts`
  - `__e2e__/shared/{agw-gas-evidence,agw-preset-acceptance}.ts`
  - `scripts/check-agw-{gas-quotes,preset-compatibility}.js`
  - `src/lib/agentic/__tests__/svm-send-defaults.spec.ts`
  - `plan/agw/research/preset-acceptance-2026-10-20/`
- Every file above was read in full. The raw working-tree diff was taken with `rtk proxy git diff`.

### Release worktree `push-chain-sdk-agw-v5`, branch `feat/agw-sdk-v5`

- HEAD `71d556b60f987f8579ef4d639034b86e8dbbb90f`, clean.
- `origin/feat/agw-sdk-v5` = `fa50f367…`, the version-bump commit.
- `git diff 525c7186 71d556b6 -- packages/core/src packages/core/AGW.md` shows only the `package.json` version, so `packages/core/src` is identical at both HEADs.

### npm

- `latest` = 6.0.26; `alpha` = 6.0.27-alpha.5, with `gitHead` `71d556b6`.
- Tarball sha256 `fd5b6c0f93da1c87e16e3e16560d683f44fd080278f82bbcafc967fe2695d621`. It contains `const gasLimit = p.gasLimit ?? BigInt(1_000_000);` (`src/lib/agentic/execution/svm-public.js:53`). **The Solana fix is not published.**

### Contracts, pinned as extracted copies; no checkout was modified

| Repo | Local HEAD | Pinned for review | Notes |
|---|---|---|---|
| push-agentic-wallets | `main` `9ddd954` (4 September, older design) | `deploy-agw` `e57998c2d8ef` | Its `src/` is identical to the deployed source `ffd567d3e49b` (empty `git diff ffd567d e57998c -- src`). The local harness `/tmp/agw-preset-defaults-v6/.agw-pin` = `ffd567d…` |
| push-chain-core-contracts | `8183-v1` `01439d1` | `main` `b2f22241` | Same commit the earlier route validation used. Deployed UniversalCore differs: it returns 6 values |
| push-chain-gateway-contracts | `pc20-3rd-iteration` `bcbf7df` | `gateway-testnet` `b205770f` | The SVM source declares `DJoF…`; the live gateway is `CFVS…` |
| push-chain (node) | `develop` `cfe8952c` | as-is | Used only for `uregistry` proto definitions |

Remote heads were read with `git ls-remote`, without fetching. Extraction used `git archive <rev> | tar -x` into the session scratchpad.

**Credential note:** while running `git remote -v` I saw that the three contract repos' `origin` URLs embed a GitHub personal access token in plaintext. I did not record or use it. Consider rotating it and switching to a credential helper.

## 2. Commands and results

All runs were from the SDK root unless stated.

| Check | Result |
|---|---|
| `node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand --testPathPattern=agentic/__tests__` (16:39:57Z) | **26 suites, 405 tests passed** |
| `tsc -p packages/core/tsconfig.spec.json --noEmit` | exit 0 |
| `tsc -p packages/core/tsconfig.agw-local.json --noEmit` | exit 0 |
| `AGW_LOCAL_DIR=/tmp/agw-preset-defaults-v6 … jest.agw-local.config.ts --runTestsByPath packages/core/__agw-local__/preset-acceptance.spec.ts` (16:41:05Z, anvil 1.5.1) | **9/9 passed** |
| `eslint` on the 10 changed or new files | 0 errors, 19 warnings (non-null assertions) |
| Core build, package/guide checks | **Not re-run.** I used the existing `dist/` (built 15:25:56Z, after the `svm-public.ts` edit at 15:22:29Z; `dist/…/svm-public.js:56` has `?? BigInt(0)`) |
| Funded live suites | Not run (out of scope) |

Read-only probes (scripts in `scripts/`, outputs in `data/`):

| Script | What it does | Endpoint | Pinned block or slot | Time (UTC) |
|---|---|---|---|---|
| `push-probe.cjs` | 10 live Push receipts with `SwapAndBurnGas`, `UniversalTxOutbound` and `OutboundMetered` decoded; UniversalCore fee inputs and quotes; QuoterV2 exact-output gas cost; PC/USD per origin; 18 registry PRC20 metadata | `evm.donut.rpc.push.org` (chain 42101) | 24,457,144 (block time 16:25:31) | 16:25 |
| `uregistry-probe.cjs` | `abci_query /uregistry.v1.Query/AllTokenConfigs` (26 configs, 5 chains), node `pchain v0.0.49` | `donut.rpc.push.org:443` | height 24,457,377 | 16:34 |
| `old-prc20.cjs` | Metadata, supply and outbound quote for the 7 `.old` PRC20s | Donut EVM | 24,457,398 | 16:35:54 |
| `sol-probe.cjs` | Devnet rent; CEA derivation; program accounts; both SPL transactions parsed | `api.devnet.solana.com` (genesis `EtWTRABZ…`) | slot 513,220,877 | 16:29:02 |
| `dest-probe.cjs` | Preset-token code, decimals, Vault balances, inbound support; pools; Aave reserves; EigenLayer underlying; ETH/USD | publicnode Sepolia / Base Sepolia / Arbitrum Sepolia / BSC testnet | 11,956,507 / 48,372,829 / 321,115,011 / 137,918,895 | 16:32:02 |
| `dest-receipts.cjs` | 8 destination receipts with `UniversalTxExecuted`; CEA code and balance; SPL wallet PC deltas at Push 24,455,662→663 and 24,455,694→695 | same | as found | 16:3x |
| `sdk-quotes.cjs` | The SDK's own `agenticRuntime.quoteOutbound` for Push-native, Sepolia-UEA and Solana-UEA signers (read-only clients) | Donut | 24,457,436–24,457,448 | 16:37 |
| `trace-bnb.cjs` | The same quote with `printTraces`, for the BNB first-use case | Donut | ≈24,457,460 | 16:38 |
| `gasprice-history.cjs` | `gasPriceByChainNamespace` every 200 blocks | Donut | 24,455,072–24,457,472 | 16:39 |
| Inline checks | Arbitrum WETH EIP-1967 implementation; explicit EVM gasLimit 100,000 / 499,999 (revert) and 500,001 (ok) | Arbitrum Sepolia, Donut | latest | 16:4x |

Key values are summarised in [review.md](review.md). The full data is in `data/*.json`.

## 3. Verifying the existing evidence

| Claim in the existing evidence | Independent result |
|---|---|
| Ten live destination deliveries | **Confirmed.**<br>EVM: all 8 receipts succeeded, sent by relayer `0x9fed…` to the chain's Vault, each with `UniversalTxExecuted` from the expected CEA where `originCaller` = wallet and the target is the counter. Each CEA now holds exactly 2×10¹² wei.<br>Solana: both transactions succeeded; vault → CEA ATA → recipient `oVL4…` moved exactly 1000 raw units each, with CEA authority `DKbAi…`; the mint is `EiXD…` on the classic Token program |
| SPL stored spend of 2,000 | `OutboundMetered` amounts 1000 and 1000 in the Push receipts (amounts only) |
| "Each charged a 5,000-lamport fee" | True of the signature fee only. The relayer was reimbursed 2,184,320 and 695,880 lamports |
| Quote figures | `gasLimit` 2,285 / 960 and 2,000,000 / 500,000 reproduced from the `UniversalTxOutbound` events |
| "No claim about net consumption" | Now measured from `SwapAndBurnGas.pcIn` and wallet deltas: 0.0008–2.37 PC consumed, the rest refunded |
| `spl-rejections.json` | Not re-executed; its block and decoded selectors are consistent with the source error names |
| Blocked preset log | Same outcome reproduced through local readiness. The log came from an earlier revision of the spec file (stack lines 200/331 against 211/356 now). The file was modified at 15:43:00Z, after the log at 15:31:51Z |
| Run timing | `gas-live.spec.ts` was modified at 15:33:11Z, during its run (≈15:29:45Z–15:41:40Z), as the README says. `svm-agent-spl.spec.ts` was modified at 15:41:32Z, after the funded run (15:25–15:27Z) |

## 4. Limitations

- I ran no funded or live transactions, so F1's routes and F2's native-wrap alternative are unproven end to end. Outbound for the `.old` USDC routes is inferred from registry, metadata, quote and Vault-backing evidence only.
- The node registry was read through `abci_query` with my own protobuf decoder, not an official client.
- The PC/USD, gas-price and BNB-attached figures are point-in-time testnet values that changed during the review window.
- Solana pricing used Donut pools and the SDK's sizing, not an independent SOL/USD feed.
- `isSupportedToken` was read on the external gateways only; the deployed UniversalCore has no such function (it reverted).
- The contract-source analysis is of pinned source, and the deployed core and SVM gateway differ from the pinned commits (F16). Live behaviour was checked empirically wherever it mattered.
- I could not access Harsh's Notion page. Spec text was taken from `plan/agw/research/section6-feedback-2026-10-12/sdk-latest.md` (for example §6.h `allowedCalls: AllowedCall[]; // 1..32`).
- Not re-run: build, package and guide checks, API comparison, and the full 2,181-unit suite.

## 5. Source changes during the review

None to production code, tests or existing evidence. The only files I added are under `plan/agw/independent-review-creation-flow-2026-10-20/`: `review.md`, `decision-matrix.md`, `team-questions.md`, `evidence.md`, `data/*.json` and `scripts/*.cjs`. The scripts are read-only probes with no keys; they run from any directory and use the SDK's `node_modules`.

`npm pack` of 6.0.27-alpha.5 was extracted only inside the session scratchpad. No other process wrote to `dist/`, `e2e-logs/` or the contract checkouts.
