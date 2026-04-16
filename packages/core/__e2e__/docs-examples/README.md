# Docs Examples — E2E

These tests are **1:1 mirrors** of the runnable code blocks in the website docs at
`push-chain-website/docs/chain/03-build/06-Send-Universal-Transaction.mdx`,
`07-Universal-Transaction-Scenarios.mdx`, and `08-Send-Multichain-Transactions.mdx`.

## Intent

Each docs example uses `ethers.Wallet.createRandom()` plus a `readline` prompt that asks
the user to fund the new wallet at a specific address with specific amounts, e.g.

> Fund these accounts, then press Enter:
>   • UOA `0x…` on Sepolia — at least 0.005 ETH (gas to sign)
>   • UEA `0x…` on Push Chain — at least 1 PC + 0.002 pETH (burned to release ETH on Sepolia)

In CI / e2e we cannot stop and wait for a human to send funds. These tests therefore:

1. Generate the same fresh random wallet (matches the docs example)
2. **Auto-fund** that wallet from a pre-funded **master wallet** loaded from `.env`
   (`EVM_PRIVATE_KEY`, `PUSH_PRIVATE_KEY`, `BNB_PRIVATE_KEY`, `SOLANA_PRIVATE_KEY`)
   using the **exact amounts the prompt asks for** — no bumping, no buffering
3. Run the **exact code block** from the docs (every line under `// Code` in the MDX)
4. Add proper assertions on the response and on cross-chain receipt

Anything that drifts from the docs example is a bug — either in the test or in the docs.
The test files reference the docs slug (`customPropGTagEvent=…`) and line range so it's
trivial to keep them in sync.

## Layout

One spec file per docs page (or route family within a page). Inside each file, every
`it()` block mirrors one `customPropGTagEvent` slug from the docs and cites its MDX
line range in a leading comment.

```
docs-examples/
├── _helpers/
│   └── docs-fund.ts                                  # auto-fund a fresh wallet from master,
│                                                     # matching the prompt amounts verbatim
├── 06-send-universal-transaction/
│   └── send-universal-transaction.spec.ts            # mirrors 06-*.mdx
├── 07-transaction-scenarios/
│   ├── route1.spec.ts                                # all UOA_TO_PUSH slugs from 07-*.mdx
│   ├── route2.spec.ts                                # all UOA_TO_CEA slugs from 07-*.mdx
│   └── route3.spec.ts                                # all CEA_TO_PUSH slugs from 07-*.mdx
└── 08-multichain-transactions/
    └── multichain-transactions.spec.ts               # mirrors 08-*.mdx
```

Each spec file's header comment cites the **slug** and **MDX line range** it mirrors so
that updating a docs example is a straightforward "find the matching `it()`, update both."

## Required env vars

`.env` (under `packages/core/`) must define:

| var | what it pays for |
|---|---|
| `EVM_PRIVATE_KEY` | Sepolia ETH (UOA signing gas), Sepolia ERC-20 USDT/USDC (bridged-in tests), and BNB Testnet BNB+USDT (Route 3 CEA funding — same hex private key, since BSC Testnet is EVM) |
| `PUSH_PRIVATE_KEY` | Push Chain native PC (sent to fresh UEA where the docs prompt asks for `… PC + … pETH`) and any PRC-20s the master holds (pETH, pUSDT(BNB)) for Route 2 burn tests |
| `SOLANA_PRIVATE_KEY` | Solana Devnet SOL (UOA signing gas for the SVM examples) |

Tests `it.skip` themselves when the env var they need is missing, so partial setups still
run their applicable subset.

## Known prerequisites

Every funding helper pre-checks the master's balance and **throws a clear error** if the
master is short — the test fails hard so the missing balance can't be silently ignored in
CI. The error message points at the exact address + asset to top up.

A handful of Route 2 examples burn `pETH` or `pUSDT(BNB)` on the UEA, so the master Push
Chain wallet must hold a small amount of those PRC-20s. If you see
`[fund] master Push wallet … needs X units of pETH`, top up the master via a Route 1
funds-bridge (see `route1_funds_erc20` / `route1_move_funds_native_ethers` in the
`07-transaction-scenarios/route1.spec.ts`) and re-run.

### Pre-flight balance check

Before running the suite, use the dev script to verify all master wallets are funded:

```
cd packages/core
npx ts-node --transpile-only __e2e__/docs-examples/_helpers/check-balances.ts
```

It queries each master wallet on every chain, compares the balance to the aggregate
amount all 25 tests collectively need, and prints a table:

```
┌───────────────┬────────────┬───────┬─────────┬────────┐
│     Chain     │   Asset    │ Need  │  Have   │ Status │
├───────────────┼────────────┼───────┼─────────┼────────┤
│ Sepolia       │ ETH        │  0.11 │  0.8918 │   ✓    │
│ Sepolia       │ USDT       │  0.24 │ 9999.99 │   ✓    │
│ Sepolia       │ USDC       │  0.10 │       0 │   ✗    │
│ BNB Testnet   │ BNB        │  0.10 │  1.2434 │   ✓    │
│ BNB Testnet   │ USDT       │  0.04 │     500 │   ✓    │
│ Push Chain    │ PC         │    10 │ 4366.15 │   ✓    │
│ Push Chain    │ pETH       │ 0.004 │   0.271 │   ✓    │
│ Push Chain    │ pUSDT(BNB) │  0.04 │   1.198 │   ✓    │
│ Solana Devnet │ SOL        │  0.02 │  0.0948 │   ✓    │
└───────────────┴────────────┴───────┴─────────┴────────┘
```

Exit code is **0** when every row is `✓`, **1** when one or more are short — so it's
safe to gate CI or a pre-test hook on it. Missing rows are re-listed below the table
with the top-up amount and asset so it's obvious what to fund.

## Running

```
# all docs-examples specs
pnpm --filter @pushchain/core test __e2e__/docs-examples

# one file
pnpm --filter @pushchain/core test __e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts

# one slug — use Jest's -t flag to match the it() title
pnpm --filter @pushchain/core test __e2e__/docs-examples/07-transaction-scenarios/route2.spec.ts -t 'route2_funds'
```
