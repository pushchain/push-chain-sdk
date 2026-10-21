# Preset questions for Aman: agentic wallet presets

Updated October 21, 2026. Draft; nothing sent. What we verified ourselves is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

## Context

Presets are ready-made agent rules for popular apps:

- **DEX:** Uniswap or PancakeSwap.
- **Lending:** Aave, Moonwell, Venus.
- **Staking:** EigenLayer.

Each preset lists the exact tokens that app uses on each test chain, with default limits.

A preset can be created only if every one of its tokens can be sent from Push to that chain. That requires a Push token (PRC20) route for that exact token. The SDK never swaps in a different token with the same name, because the app would not accept it.

Status with the latest SDK update (not yet released). Both ready presets passed a live test on October 21:

| Preset | Sepolia | Base Sepolia | Arbitrum Sepolia | BNB testnet |
|---|---|---|---|---|
| DEX | **ready, live-tested** | blocked: WETH | blocked: WETH | blocked: WBNB, USDT |
| Lending | blocked: LINK | blocked: LINK, Moonwell USDbC and WETH | **ready, live-tested** | blocked: Venus USDT, USDC |
| Staking | blocked: WETH (EigenLayer) | — | — | — |

---

## 1. Will the three Circle USDC routes be kept?

The two ready presets depend on these node routes:

| Chain | Token on that chain | Push token |
|---|---|---|
| Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E` ("USDC.eth.old") |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x84B62e44F667F692F7739Ca6040cD17DA02068A8` ("USDC.base.old") |
| Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6` ("USDC.arb.old") |

What we have verified:

- On October 21, sends through all three routes were delivered on Sepolia, Base and Arbitrum. The two presets also passed over them.
- The routes were renamed ".old" on April 16 (node commit `c84f9a97`), when the plain "USDC" names were pointed at newer mock tokens. Nothing marks them deprecated.
- The node's `develop` branch no longer contains their config files. That only matters if configs are ever re-synced from `develop`.
- Removing one of these configs would stop every holder of that Push token from withdrawing it.

**Question:** can we treat these three routes as permanent for the presets? If they will be retired, what is the replacement?

## 2. Can the missing preset-token routes be added?

These preset tokens have no route today:

- Sepolia: Aave LINK `0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5`; WETH used by EigenLayer `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`
- Base Sepolia: WETH `0x4200000000000000000000000000000000000006`; Aave LINK `0x810D46F9a9027E28F9B01F75E2bdde839dA61115`; Moonwell USDbC `0x4616975f7E6045FD9737e95bC527e9e14c727BD2`; Moonwell WETH `0x663A6F02d547dFd639BF689FED298712f2FB69Fb`
- Arbitrum Sepolia: WETH `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`
- BNB testnet: WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`; Venus USDT `0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c`; Venus USDC `0x16227D60f7a0e586C66B005219dfc887D13C9531`

From the node code, adding a route takes all of the following:

1. A token config added by the registry admin (`MsgAddTokenConfig`; admin `push1negskcfqu09j5zvpk7nhvacnwyy2mafffy7r6a`).
2. A Push token deployed for that exact source token.
3. Gas configuration in UniversalCore.
4. A WPC pool.
5. Support in the destination gateway and vault.

**Question:** which of these can be added, by whom, and roughly when? Which will not be supported? For those, we could choose different reviewed tokens for the preset.

## 3. May presets send native ETH/BNB instead of WETH/WBNB?

Sending native ETH/BNB from Push already works on all four test chains. For the presets that need WETH or WBNB (DEX on Base, Arbitrum and BNB, and Sepolia staking), the preset could send native ETH/BNB, then wrap it into WETH/WBNB on arrival, with the same amounts and limits. The app still receives the WETH/WBNB it expects.

| Option | Result |
|---|---|
| A. Allow native plus wrap | Those presets don't wait for WETH/WBNB routes. The preset shows ETH/BNB as the token sent from Push. SDK work only |
| B. Keep WETH/WBNB exactly | Those presets wait for the WETH/WBNB routes in question 2 |

**Decision needed:** A or B. With A, the WETH/WBNB entries can be dropped from question 2.
