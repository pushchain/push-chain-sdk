# Questions for the core/node and gateway teams

Updated October 21, 2026. **On hold; not sending now.** None of these blocks Riyanshu or any SDK work, and the SDK already handles each one:

- the labels say failed sends count toward the total;
- the gas budget never attaches less than the pool cost, and a send that doesn't fit is refused before signing;
- the registry check is an internal script;
- Aman question 1 covers whether the `.old` routes stay.

The "send when" line under each question says what would make it worth asking.

- AGW contract questions are in [questions-zaryab.md](questions-zaryab.md).
- Preset token routes are in [questions-aman.md](questions-aman.md).
- What we verified ourselves (node `testnet/donut` `ca3b8d4e`, deployed contracts, live runs) is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

Intro when sending: "A few questions from the agentic wallet (AGW) work on Donut. We checked node testnet/donut (ca3b8d4e, v1.1.44-donut) and the deployed contracts first; these are what we couldn't settle ourselves."

---

## Core / node team

### 1. Is wiring `creditRevert` for failed agent sends planned?

When an agentic wallet's outbound fails on the destination, the node re-mints the token to the wallet and refunds unused gas. But the rule still counts that amount against its total limit. `UniversalRulesPolicy.creditRevert` exists to undo that count, but nothing calls it on any node branch; its own comment says the executor doesn't call it yet.

**Question:** is wiring it planned, and when? Until then, we tell users that failed sends count toward the total.

**Send when:** Harsh answers question 3.1 and doesn't accept that failed sends count toward the total, or before mainnet.

### 2. Is the BNB testnet gas price voting set up as intended?

On Donut the BNB testnet gas price jumps between 0.055, 0.11 and 1.1 gwei, often within minutes. From the node code:

- each validator reads `eth_gasPrice` from a rotating public RPC and adds 10%;
- only two validators vote for BSC testnet, and the chain takes the higher vote;
- there is no smoothing or clamp.

So the gas for a wallet's first agent send to BNB swings between about 2.4 PC and 24 PC depending on the moment.

**Question:** is this intended? Could more validators vote, or could a smoothing window or clamp be added?

**Send when:** a BNB preset becomes route-ready, or users hit the gas-budget error on BNB.

### 3. Can the SDK rely on `abci_query` to read the token registry?

The public REST and gRPC query endpoints aren't reachable. Tendermint `abci_query /uregistry.v1.Query/AllTokenConfigs` on `donut.rpc.push.org` works, and the SDK uses it in a check that its routes match the node.

**Question:** is this a supported way to read the registry, or will a public REST endpoint be exposed?

**Send when:** the SDK needs to read the registry at runtime rather than in a check script.

### 4. Can the USDC `.old` config files be restored on `develop`?

The live registry keeps `USDC.eth.old`, `USDC.base.old` and `USDC.arb.old`, and two AGW presets depend on them. The `develop` branch dropped their config files (merge `47ef4c9a`); `testnet/donut` and main still have them.

**Question:** can they be restored on `develop`, so a future config sync doesn't remove routes in use?

**Send when:** Aman confirms the `.old` routes are staying.

---

## Core and gateway teams

### 5. Can the exact deployed sources be committed or tagged?

We matched both deployments by bytecode and build strings, but neither exact source is in any commit:

- **UniversalCore** on Donut (implementation `0xa0023b356344ff623c7e20679cf9d170e44fbbd1`) matches `core-testnet` `8bc60ae`. The verified file differs only in import paths and comments.
- **The Solana gateway at `CFVS…`** was built from `pc20-3rd-iteration` with `declare_id` changed locally. No branch declares CFVS.

**Question:** can the exact deployed sources be committed or tagged, so the SDK and audits can pin them?

**Send when:** an audit starts, or before mainnet.
