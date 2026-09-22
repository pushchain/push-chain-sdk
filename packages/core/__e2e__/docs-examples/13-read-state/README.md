# Universal Read documentation examples

`playgrounds.spec.ts` executes the three exact website playgrounds stored in `fixtures/`:

- `universal_read_registry`: fresh Donut wallet, default registry, decoded Sepolia balance.
- `universal_read_batch`: EVM balance, Web2 extraction, typed EVM call and finalized Solana balance, ordered results.
- `universal_read_resume`: existing request tracked using a read-only client.

Source: `push-chain-website/docs/chain/03-build/13a-Universal-Read.mdx` (core 6.0.25).
The harness substitutes imports with the SDK source under test and replaces funding/input
prompts with test automation. It preserves request options and default timeout behavior.
Each funded playground gets 0.05 test PC; remaining balances are returned after the suite.
The resume scenario seeds a request if run on its own. Requires `PUSH_PRIVATE_KEY` in
`packages/core/.env`. No website checkout is needed to execute the E2Es.

Verify mirrors from the SDK repository root (requires the sibling website checkout, or pass its MDX path):

```sh
node scripts/check-read-state-doc-examples.mjs
```

Run all four docs scenarios, including the existing custom-receiver preparation flow:

```sh
cd packages/core
npx jest -c jest.e2e.config.ts --runInBand --forceExit --testPathPattern=docs-examples/13-read-state
```

All scenarios are also registered in `e2e:ci --group read`.
