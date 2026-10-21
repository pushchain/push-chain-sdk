# Questions for the core/node and gateway teams

Updated October 21, 2026. Draft; nothing sent.

- AGW contract questions are in [questions-zaryab.md](questions-zaryab.md).
- Preset token routes are in [questions-aman.md](questions-aman.md).
- What we verified ourselves (node `testnet/donut` `ca3b8d4e`, deployed contracts, live runs) is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

---

## Core / node team

### 1. Is wiring `creditRevert` for failed agent sends planned?

When an agentic wallet's outbound fails on the destination, the node re-mints the token to the wallet and refunds unused gas.

But the wallet's rule still counts that amount against its total limit. The AGW policy has `creditRevert` to undo the count. Its own comment says the executor module does not call it yet, and no node code on any branch calls it.

**Question:** is calling `creditRevert` on failed outbounds from AGW wallets planned, and when? Until then we tell users that failed sends count toward the total.

### 2. BNB testnet gas price: is the current voting setup intended?

The BNB testnet gas price on Donut jumps between 0.055, 0.11 and 1.1 gwei, often within minutes. From the node code and chain data:

- Each validator reads `eth_gasPrice` from a rotating public RPC and adds 10%.
- Only two validators vote for BSC testnet, and the chain takes the higher of the two.
- There is no smoothing or clamp.

A first agent send to BNB testnet then needs about 2.4 PC or about 24 PC, depending on the moment.

**Question:** is this setup intended? Could more validators vote, or could a smoothing window or a clamp be added?

### 3. Can the SDK rely on `abci_query` to read the token registry?

The REST and gRPC query endpoints aren't reachable publicly. Tendermint `abci_query /uregistry.v1.Query/AllTokenConfigs` on `donut.rpc.push.org` works.

The SDK uses it in a check that the SDK's routes match the node.

**Question:** is this a supported way to read the registry, or will a public REST endpoint be exposed?

### 4. Can the `.old` USDC config files be restored on `develop`?

The live registry keeps the three `USDC.*.old` routes, which two presets depend on. But the node's `develop` branch dropped their config files (merge `47ef4c9a`). `testnet/donut` and main still have them.

**Question:** can they be restored on `develop`, so a future config sync doesn't remove routes in use?

---

## Core and gateway teams

### 5. Can the exact deployed sources be committed or tagged?

We matched both deployments by bytecode and build strings, but neither exact source is in any commit:

- **UniversalCore** on Donut (implementation `0xa0023b35…`) matches `core-testnet` `8bc60ae`. The verified file differs only in import paths and comments.
- **The Solana gateway at `CFVS…`** was built from `pc20-3rd-iteration` with `declare_id` changed locally. No branch declares CFVS.

**Question:** can the exact deployed sources be committed or tagged, so the SDK and audits can pin them?
