# Universal Read documentation examples

`playgrounds.spec.ts` executes three exact website playgrounds stored in `fixtures/`:

- `universal_read_evm_balance`: fresh Donut wallet, default registry, decoded Sepolia balance
  (Read Universal State).
- `universal_read_batch`: prepared EVM and Solana balance reads executed together, ordered
  results (Read Multiple Universal States).
- `universal_read_resume`: tracking with a read-only client by your own request ID, a
  predefined request ID and a transaction hash (Track Universal Read).

Source: `push-chain-website/docs/chain/03-build/04-universal-reads/`.
The harness substitutes imports with the SDK source under test and replaces funding/input
prompts with test automation. It preserves request options and default timeout behavior.
Each funded playground gets 0.05 test PC; remaining balances are returned after the suite.
The resume scenario seeds a request if run on its own. Requires `PUSH_PRIVATE_KEY` in
`packages/core/.env`. No website checkout is needed to execute the E2Es.

Verify mirrors from the SDK repository root (requires the sibling website checkout, or pass its MDX path):

```sh
node scripts/check-read-state-doc-examples.mjs          # check
node scripts/check-read-state-doc-examples.mjs --write  # re-copy the fixtures from the docs
```

Run all four docs scenarios, including the existing custom-receiver preparation flow:

```sh
cd packages/core
npx jest -c jest.e2e.config.ts --runInBand --forceExit --testPathPattern=docs-examples/13-read-state
```

All scenarios are also registered in `e2e:ci --group read`.
