# Verified marketplace baseline

Observed October 20, 2026. Deployment source: `443b4e2dd9ca5dd9ffc8efebdfcecd619dd66c47`, branch `sdk-iteration-v1` in `pushchain/push-chain-core-contracts`. AGW dependency: `ffd567d3e49b2d27c6f50ad36093274dbac3090f`, matching the existing SDK v6 adapter.

## Live Donut deployment

RPC `https://evm.donut.rpc.push.org/`, chain ID 42101. [Pinned observations](research/2026-10-20/live-deployment.json): block **24447347**. The address book reports deployment on October 20, final transaction block 24443653; this review independently checked current code/wiring, not every deployment transaction.

| Component | Address |
| --- | --- |
| Marketplace | `0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4` |
| Kernel | `0x977cf1AC973E9eC4332791d531507575006157Ed` |
| Rules hook | `0xDe7A94e510b6C571DE7880d441349689F73A32b3` |
| Rules helper | `0x5b98A8E0df5b918DF76cD2BE84bA7995B39dfd44` |
| JobSpecBuilder library | `0x2de1e3F053b0bBa0cE0C6953144534a0b055f59e` |
| Payment token, pUSDC / `USDC.eth`, 6 decimals | `0x7A58048036206bB898008b5bBDA85697DB1e5d66` |
| Current evaluator, EOA | `0x1afC81396f1bb36F91f74506284952b81e4bd47c` |
| AGW factory | `0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc` |
| SmartSession engine | `0xf63DC0628fe1B25049FE3E3a3585Ef051CB98c1d` |

Marketplace reports `version() == "2.0.0"`. Marketplace/kernel are unpaused; the hook is whitelisted; hook/factory/engine/kernel wiring matches the supplied book. Platform and evaluator fees are zero. `MIN_EXPIRY_WINDOW = 300` seconds; `EVALUATOR_GRACE_PERIOD = 3600`. No cards or kernel jobs existed at the pinned observation.

Supported card destinations: Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia and BSC Testnet. Registered CEA factories/implementations match the book. Four independent EIP-1167/CREATE2 calculations agree with `computeCEA` for a sample predicted AGW. This checks the marketplace's registered derivation, not destination liquidity or current remote factory configuration.

Proxy implementation/admin slots match the address book. Executable runtimes of all five marketplace-stack components match the pinned build after resolving library linking/self-address and excluding compiler metadata. The matching artifacts all use 1,000 optimizer runs. The README's larger 99,999-run helper/kernel sizes are not the live sizes; see [comparison](research/2026-10-20/runtime-comparison.json). Full bytecode including metadata is not identical, and this is not an audit.

## Implemented contract behavior

1. Provider `registerAgentCard` creates one integer-ID card; another registration by that provider reverts. `updateAgentCard` preserves provider, execution chain and active flag, bumps version and clears verification. Verification is a version-specific tag, not an execution gate.
2. A card combines `AgentCard`, `abi.encode(AgentCardRules)` and `abi.encode(JobSpecTemplate)`. `jobType` is a bytes32 hash, not a recoverable string. Full views and an ABI inventory are under [contracts](contracts/).
3. Rules are `assets`, `principalAsset`, `maxGasPerCall`, `allowedCalls`. PRC20 assets are on Push and report the card's destination chain. The principal asset's total is `MARKER_PRINCIPAL`; its per-call cap may be that marker or a nonzero literal. Other asset caps match byte-for-byte.
4. `approve` is allowed with a nonzero literal EQ spender pin and a MAX amount pin. `increaseAllowance` is refused. Transfer recipients must be bound to the user's destination CEA. There is **no owner-approvals array**.
5. `MARKER_WALLET = keccak256("push.marketplace.marker.WALLET")`; `MARKER_PRINCIPAL = keccak256("push.marketplace.marker.PRINCIPAL")`. Cards store markers; signed sessions store resolved addresses/amounts. Public SDK sentinels need not equal these wire values.
6. `previewIntent` and `buildCreateJobCalldata` provide exact intent/calldata. `previewIntent` alone does not perform all `openJob` eligibility checks; SDK preview must also check ranges, pause, version, wallet occupancy and session compatibility.
7. `openJob` accepts an OwnerIntent and the owner's signature, checks content and nonces, deploys/reuses AGW, grants the session, and creates the kernel job. No deposits or escrow. The intent binds card version through the built description's `origin`. `label` is deploy-only cosmetic input outside the signed intent.
8. Deposits and kernel funding are subsequent operations. Provider calls `setBudget`; client funds with `expectedBudget` and exactly 32 bytes `abi.encode(rulesId)` for the interim hook. `providerFee` on the card is a reference price; the kernel only checks the client's supplied expected budget against its current budget.
9. The interim hook proves client is an AGW, permission enabled, and no Funded/Submitted hook-bound job. It does not check agent/provider equality, expiry, criteria, baseline or verdict. Marketplace checks bind provider/expiry when opening, but manual wallet edits and plain kernel jobs require separate consideration at fund.
10. Client or provider may reject an Open job. Only evaluator may reject Funded/Submitted. Cancellation is `reject`, not a separate deployed `cancel` selector. Marketplace `activeJobOf` becomes zero for Rejected; permissions are not revoked automatically. `claimRefund` is unpausable and callable by anyone after the relevant deadline; funds go to the recorded client.

The marketplace's occupancy includes unexpired Open jobs, unlike the hook's Funded/Submitted-only occupancy. A plain hookless job is outside that hook's accounting. The marketplace kernel is immutable configuration; moving to K-12 on another kernel requires an upgrade/redeploy and hook wiring, not an SDK address substitution.

## Wire supported by this deployment

`JobSpec = (reads, checks, logic, allowedMutability, origin, executeBy, failFinalAt)`.

- `Read`: split namespace/chainId, confirmations, 20-byte target, 4-byte selector, args, output-type codes, field path.
- `Check`: one read index, Evaluation, Operation, int256 target.
- `Logic`: ALL=0 / ANY=1 / AT_LEAST=2, direct check indices and child-logic indices; root index 0.
- `AllowedMutability`: NONE=0 / CLIENT=1 / PROVIDER=2 / BOTH=3, carried without enforcement.
- Limits defined with the schema: 16 reads, 16 checks, 32 logic entries. Builder does not enforce all evaluator semantic limits. Template order: reads, checks, logic, allowedMutability, params.
- `origin = keccak256(abi.encode(marketplace, cardId, cardVersion, principal))`; plain specs use zero.
- Wire `FillSource.CEA` / `TargetSource.CEA` map to SDK `AGENTIC.WALLET` without renaming the ABI.

## Not implemented here

K-12 per-job tokens; createJob hooks; mutable criteria negotiation/freezing; automated snapshot/verify/retry; compatible evaluator; verified ratings; recurring jobs; Solana/Push-native cards; non-EVM evaluation reads. There is no evidence that setting the EOA evaluator to the other demo evaluator would work; the repo explicitly documents incompatible kernel/token/hook/wire assumptions.

The latest linked evaluator source `8059817` changes not only reads/checks but top-level field order, logic nodes and enum ordinals. See [gap W01](analysis/spec-and-contract-gaps.md). Retain separate explicit wire profiles in research; do not silently translate or ship a universal decoder claiming compatibility.
