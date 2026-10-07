# Push Agentic Wallet — deployed addresses (Donut)

**Generation `v5` (wallet label)** · Chain ID `42101` · explorer [donut.push.network](https://donut.push.network) ·
new factory and wallet implementation deployed in blocks `23989983`–`23989987` · commit `2e61e13` (branch
`wallet-label`) · `script/DeployWalletAndFactory.s.sol` · `forge 1.5.1-stable`

v5 deployed **three** contracts: the AGW wallet implementation, the AGWFactory logic and a new factory proxy. The
engine, URP (proxy, implementation, ProxyAdmin) and AgentValidator are **the v4 contracts, unchanged**: none of them
stores a factory or wallet-implementation address, and their state is keyed per wallet.

## The two addresses you need

|                                                  | Address                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Factory**: deploy and look up wallets          | [`0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5`](https://donut.push.network/address/0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5) |
| **URP**: name this as every rule's action policy | [`0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af`](https://donut.push.network/address/0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af) |

Both are **proxies**. Point integrations at these, never at an implementation.

## Everything

| Contract                                           | Address                                                                                                                       | Size (B) | Verified |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------: | :------: |
| `factoryProxy` (ERC-1967, UUPS) — **new in v5**    | [`0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5`](https://donut.push.network/address/0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5) |      141 |    ✅     |
| `factoryLogic` (`AGWFactory`) — **new in v5**      | [`0xe549d3D4e85cB16F687448D7acA21D9d13A7cD0f`](https://donut.push.network/address/0xe549d3D4e85cB16F687448D7acA21D9d13A7cD0f) |   10,013 |    ✅     |
| `walletImplementation` (`AGW`) — **new in v5**     | [`0x4D459Da499C14548aa16c46c57fD92880A88EBb4`](https://donut.push.network/address/0x4D459Da499C14548aa16c46c57fD92880A88EBb4) |   17,584 |    ✅     |
| `urp` (Transparent proxy)                          | [`0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af`](https://donut.push.network/address/0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af) |      830 |    ✅     |
| `urpImplementation` (`UniversalRulesPolicy` 3.1.0) | [`0xA2391eee4C9EA1B32AEB3A460B77296EA709F02F`](https://donut.push.network/address/0xA2391eee4C9EA1B32AEB3A460B77296EA709F02F) |   24,326 |    ✅     |
| `urpProxyAdmin` (`ProxyAdmin`)                     | [`0x0b7a31ec85117892aEA90AA5cB6514e2F97c2295`](https://donut.push.network/address/0x0b7a31ec85117892aEA90AA5cB6514e2F97c2295) |      926 |    ✅     |
| `sessionValidator` (`AgentValidator`)              | [`0x068EE2388475A98EE1f5a434C58bFF3444fffFe6`](https://donut.push.network/address/0x068EE2388475A98EE1f5a434C58bFF3444fffFe6) |      806 |    ✅     |
| `sessionEngine` (`SmartSession`, fork `7dc20e4`)   | [`0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a`](https://donut.push.network/address/0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a) |   22,581 |    ✅     |

**All eight verified** on Blockscout. The five rows not marked new are the v4 contracts, reused as they are. Keep
`urpProxyAdmin`: without it URP can never be upgraded.

Check the wiring yourself: `cast call <factoryProxy> 'walletImplementation()(address)'` returns the
`walletImplementation` above, and that implementation's `SESSION_ENGINE()`, `RULES_POLICY()` and `SESSION_VALIDATOR()`
return the engine, URP and validator in this table.

### Push core contracts this deployment points at (not deployed by this repo)

|                             | Address                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `UniversalGatewayPC`        | `0x00000000000000000000000000000000000000C1` (implementation `0x1e41…a659`, 8-field outbound request, selector `0x77b86bec`) |
| `UniversalCore`             | `0x00000000000000000000000000000000000000C0`                                                                                 |
| `UEAFactory`                | `0x00000000000000000000000000000000000000eA`                                                                                 |
| `UNIVERSAL_EXECUTOR_MODULE` | `0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7` (the address core's UniversalCore and PRC20s use; an account with no code)      |

## What changed from v4

|                          | v4                                       | v5                                                                                                    |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Factory proxy            | `0xaF88…1aaF`                            | **`0x8137…Ccc5`**                                                                                      |
| Wallet implementation    | `0x96D6…713c`                            | **`0x4D45…EBb4`**                                                                                      |
| Wallet label             | emitted in `WalletDeployed`, not stored  | **stored on the wallet**: `label()` (default `AGW <index + 1>`), owner-only `setLabel(string)`, `LabelSet` event, 64 bytes max |
| `OwnerIntent` signatures | domain `verifyingContract` = `0xaF88…1aaF` | domain `verifyingContract` = **`0x8137…Ccc5`**: intents must be signed for the new factory              |
| URP, engine, validator   | `0x603E…59af`, `0x165A…102a`, `0x068E…fFe6` | **the same**                                                                                         |
| Rule encoding            | as below                                 | **unchanged**                                                                                          |

## How to grant a rule (what changed from v3.2 to v4, still current)

|                             | v3.2                                                      | v4                                                                                        |
| --------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Policy `initData`           | `abi.encode(string chainNamespace, bytes body)`           | **`abi.encode(uint16 version, string chainNamespace, bytes body)`**, `version = 1`        |
| Tokens per cross-chain rule | exactly 1 (`asset`, `maxAmountPerCall`, `maxAmountTotal`) | **1 to 8** (`assets: AssetCap[]`), each with its own limits and spend counter             |
| PC fee limit                | `maxPCPerCall`                                            | **`maxGasPerCall`** (same meaning: PC per outbound for protocol fee + gas)                |
| Agent door                  | session signature through a validator                     | **`executeAsAgent(rulesId, mode, executionCalldata)`**, callable only by the rule's agent |
| Owner-side changes          | not recorded                                              | **checkpoint counter** (`checkpointCount()`, `Checkpointed` event)                        |

Cross-chain body (EVM destination):

```solidity
struct AssetCap { address token; uint256 maxPerCall; uint256 maxTotal; }   // token = PRC20 on Push
struct UniversalTerms {
    uint48 validUntil; address expectedCEA; AssetCap[] assets; uint256 maxGasPerCall; AllowedCall[] allowedCalls;
}
// ABI tuple: (uint48,address,(address,uint256,uint256)[],uint256,(address,bytes4,uint16,bool,uint256)[])
```

```
cast call 0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af 'pushChainHash()(bytes32)' --rpc-url <donut>
# -> 0x3d6bc1f1d3fb03065860265a8e93840b586e57075d956cd41b4319d040be87f9 == keccak256("eip155:42101")
```

Full design notes: `docs/1_AGW.md`, `docs/2_UniversalRulesPolicy.md`, `docs/multi-asset-review.md`.

## Admin

| Authority                                       | Holder                                                    | How to change it                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Factory `DEFAULT_ADMIN_ROLE` (factory upgrades) | deployer EOA `0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7` | `beginDefaultAdminTransfer(new)`, then the new admin calls `acceptDefaultAdminTransfer()` after the **48-hour** delay |
| URP `ProxyAdmin` owner (URP upgrades)           | deployer EOA `0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7` | `transferOwnership(new)` on `0x0b7a…2295`, immediate                                                                  |
| Factory `PAUSER_ROLE` / `OPERATOR_ROLE`         | **nobody yet**                                            | the default admin must `grantRole` before the factory can be paused or unpaused                                       |

These are different powers, and for production they belong in different multisigs: the factory admin can strand
counterfactually funded addresses; the URP ProxyAdmin owner can rewrite every gate in the security boundary.


## Previous generations (retired)

- **`v4`** (factory `0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF`, wallet implementation
  `0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c`) is no longer current. Deploy new wallets only through the v5 factory.
  v4 wallets keep working, because URP and the engine are shared, but they have no `label()` / `setLabel`.
- **`v3.2`** (factory `0x2578041963f692f8b51A137A1c7ddc0c84a8226A`, URP `0xeAd99E254ACD64219d057400cdC2A2390bC74372`)
  stays on chain but is no longer current. Its wallets and rules do not carry over; owners withdraw through the owner
  door.

Only the current deployment's book is kept in the repo (`deployments/address-book-v5/`). Earlier generations' books are
in git history.
