# Push Agentic Wallet — deployed addresses (Donut)

**Generation `v4` (multi-asset rules, versioned envelope, agent sender door, checkpoints)** · Chain ID `42101` ·
explorer [donut.push.network](https://donut.push.network) · deployed in blocks `23923806`–`23923810` ·
commit `e8db748` (branch `deploy-agw` = `pushAgenticWallet_v3`) · `forge 1.5.1-stable`

## The two addresses you need

|                                                  | Address                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Factory**: deploy and look up wallets          | [`0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF`](https://donut.push.network/address/0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF) |
| **URP**: name this as every rule's action policy | [`0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af`](https://donut.push.network/address/0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af) |

Both are **proxies**. Point integrations at these, never at an implementation.

## Everything

| Contract                                           | Address                                                                                                                       | Size (B) | Verified |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------: | :------: |
| `factoryProxy` (ERC-1967, UUPS)                    | [`0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF`](https://donut.push.network/address/0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF) |      141 |    ✅     |
| `factoryLogic` (`AGWFactory`)                      | [`0xe138Dc6EfC10233BE1e6c8aF1Caf8cABe599cfC2`](https://donut.push.network/address/0xe138Dc6EfC10233BE1e6c8aF1Caf8cABe599cfC2) |    9,992 |    ✅     |
| `walletImplementation` (`AGW`)                     | [`0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c`](https://donut.push.network/address/0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c) |   16,564 |    ✅     |
| `urp` (Transparent proxy)                          | [`0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af`](https://donut.push.network/address/0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af) |      830 |    ✅     |
| `urpImplementation` (`UniversalRulesPolicy` 3.1.0) | [`0xA2391eee4C9EA1B32AEB3A460B77296EA709F02F`](https://donut.push.network/address/0xA2391eee4C9EA1B32AEB3A460B77296EA709F02F) |   24,326 |    ✅     |
| `urpProxyAdmin` (`ProxyAdmin`)                     | [`0x0b7a31ec85117892aEA90AA5cB6514e2F97c2295`](https://donut.push.network/address/0x0b7a31ec85117892aEA90AA5cB6514e2F97c2295) |      926 |    ✅     |
| `sessionValidator` (`AgentValidator`)              | [`0x068EE2388475A98EE1f5a434C58bFF3444fffFe6`](https://donut.push.network/address/0x068EE2388475A98EE1f5a434C58bFF3444fffFe6) |      806 |    ✅     |
| `sessionEngine` (`SmartSession`, fork `7dc20e4`)   | [`0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a`](https://donut.push.network/address/0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a) |   22,581 |    ✅     |

**All eight verified** on Blockscout. Keep `urpProxyAdmin`: without it URP can never be upgraded.

### Push core contracts this deployment points at (not deployed by this repo)

|                             | Address                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `UniversalGatewayPC`        | `0x00000000000000000000000000000000000000C1` (implementation `0x1e41…a659`, 8-field outbound request, selector `0x77b86bec`) |
| `UniversalCore`             | `0x00000000000000000000000000000000000000C0`                                                                                 |
| `UEAFactory`                | `0x00000000000000000000000000000000000000eA`                                                                                 |
| `UNIVERSAL_EXECUTOR_MODULE` | `0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7` (the address core's UniversalCore and PRC20s use; an account with no code)      |

## How to grant a rule (what changed from v3.2)

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


## Previous generation (retired)

`v3.2` (factory `0x2578041963f692f8b51A137A1c7ddc0c84a8226A`, URP `0xeAd99E254ACD64219d057400cdC2A2390bC74372`) stays on
chain but is no longer current. Its wallets and rules do not carry over; owners withdraw through the owner door. Its
record is in `deployments/address-book-v3/`.
