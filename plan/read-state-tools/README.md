# read-state tools

Reference harness for exercising cross-chain read state against **live Donut**. Used for the
first end-to-end reads on 2026-09-09 (`../read-state-sdk-spec.md` § Verified live).

| file | what |
|---|---|
| `live-read-donut.sh` | Deploys a minimal read client, fires one `AccountBalance` read of Sepolia, watches it to `SETTLED`. Needs `DONUT_PK` (funded Push Donut key) and a local `push-chain-core-contracts` checkout on `feat-read-state` (`CONTRACTS_REPO`, defaults to `~/Desktop/work/PUSH/push-chain-core-contracts`). Costs ~0.002 PC per run. |
| `live-read-uea.ts` | The **UEA-originated** variant: a Sepolia-origin signer sends the request through its UEA via the SDK's own `universal.sendTransaction` (Route 1). Proved N1 live on 2026-09-09. Run from `packages/core`: `TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","moduleResolution":"node","esModuleInterop":true,"target":"es2022","skipLibCheck":true}' npx ts-node --transpile-only ../../plan/read-state-tools/live-read-uea.ts`. Needs `EVM_PRIVATE_KEY` (+ `EVM_RPC`) in `packages/core/.env`. |
| `node-read.sh tx <hash>` / `id <requestId>` | Queries `x/ucallback` over ABCI and decodes the `UniversalRead` record (status, result, `pc_tx`) with a raw-protobuf walker — no codegen needed. |
| `ForkReadStateFixVerification.t.sol` | Foundry fork suite (13 tests) asserting the deployed contract's fixed behaviour, the N2 gas-buffer boundary, the N4 regression, and the single-tuple envelope shape validators decode. Copy into `<contracts>/test/fork/` and run with `PUSH_CHAIN_TESTNET_RPC_URL` set; skips cleanly without it. The live script copies it there itself. |

These are ours; the contracts repo is not. Nothing here is committed to that repo.

Still to run (each a small edit to the spec these build): reverting callback, expiry, SVM, web2.
