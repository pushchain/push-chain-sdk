# Preset questions for Aman: agentic wallet presets

Updated October 21, 2026. Final; ready to send. Internal (not part of the message): our evidence is in [pre-question findings](research/pre-question-findings-2026-10-21/README.md).

## Context

Presets are ready-made agent rules for Uniswap/PancakeSwap, Aave/Moonwell/Venus and EigenLayer. Each preset lists the exact tokens that app uses on each test chain.

A preset can only be created if Push can send every one of those exact tokens to that chain. That needs a Push token (PRC20): a token on Push that represents that exact token and can be sent out as it. We call that a route. The SDK never swaps in a different token with the same name, because the app wouldn't accept it.

**Why it matters now:** Riyanshu's create screen keeps a preset's Create button disabled until all its routes exist, so 7 of the 9 presets can't be used on testnet.

Status in `@pushchain/core` 6.0.27-alpha.6, with the token registry checked on October 21. "Ready" means a real agent created that preset and ran its actions on testnet on October 21.

| Preset | Sepolia | Base Sepolia | Arbitrum Sepolia | BNB testnet |
|---|---|---|---|---|
| DEX | **ready** | blocked: WETH | blocked: WETH | blocked: WBNB, USDT |
| Lending | blocked: LINK | blocked: LINK, Moonwell USDbC, Moonwell WETH | **ready** | blocked: USDT, USDC (Venus) |
| Staking | blocked: WETH (EigenLayer) | — | — | — |

Questions 1 and 2 may belong to whoever runs the Push token registry (core team). If so, tell us who and we'll ask them directly. Question 3 is a preset design choice.

---

## 1. Can we treat the three Circle USDC ".old" routes as permanent?

These routes carry Circle's USDC, which the presets use:

| Chain | Circle USDC | Push token | Used by |
|---|---|---|---|
| Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E` (USDC.eth.old) | DEX Sepolia (ready) |
| Arbitrum Sepolia | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6` (USDC.arb.old) | Lending Arbitrum (ready) |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x84B62e44F667F692F7739Ca6040cD17DA02068A8` (USDC.base.old) | DEX Base (its other token, WETH, is what blocks it) |

- They were renamed ".old" on April 16, when the plain "USDC" names were pointed at newer mock test tokens. Uniswap and Aave don't accept those mock tokens.
- Nothing marks the ".old" routes as deprecated, and sends through all three were delivered on October 21.
- One risk: the node's `develop` branch no longer has their config files, so a future config sync from `develop` could remove them.
- If they were removed, the two ready presets would be blocked again, and anyone holding those Push tokens couldn't send them out.

**Question:** are these routes staying? If they will be retired, what replaces them?

## 2. Can routes be added for the missing preset tokens?

- **Sepolia:** Aave LINK `0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5`; WETH (EigenLayer) `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`
- **Base Sepolia:** WETH `0x4200000000000000000000000000000000000006`; Aave LINK `0x810D46F9a9027E28F9B01F75E2bdde839dA61115`; Moonwell USDbC `0x4616975f7E6045FD9737e95bC527e9e14c727BD2`; Moonwell WETH `0x663A6F02d547dFd639BF689FED298712f2FB69Fb`
- **Arbitrum Sepolia:** WETH `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73`
- **BNB testnet:** WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`; USDT `0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c` (used by both the DEX and Venus Lending presets); USDC (Venus) `0x16227D60f7a0e586C66B005219dfc887D13C9531`

The token registry admin on the core team adds routes. For whoever does it, each route needs:

- a token config (`MsgAddTokenConfig`, signed by admin `push1negskcfqu09j5zvpk7nhvacnwyy2mafffy7r6a`);
- a Push token for that exact token;
- gas settings for it on Push;
- a liquidity pool against Push's own coin, used to pay gas;
- support in that chain's gateway and vault.

**Question:** which of these can be added, by whom, and roughly when? Which won't be supported? For those, we'd pick a different token that we've checked the app accepts.

## 3. Can presets send native ETH/BNB and wrap it on arrival?

Sending native ETH/BNB from Push already works on all four test chains. Instead of waiting for WETH/WBNB routes, a preset could send ETH/BNB and wrap it into WETH/WBNB in the wallet's account on that chain, as the first step of the same transaction. The app still receives the WETH/WBNB it expects.

**How it works:**

- The preset shows ETH/BNB as the token sent from Push. Its limits are counted in ETH/BNB sent from Push, and the wrap step is capped to the same amount.
- If any step fails on arrival, the whole transaction reverts and the ETH/BNB comes back to the wallet on Push. As with any failed send today, it still counts toward the preset's total limit.
- After the wrap, everything is the same as the WETH/WBNB version, including how funds come back.
- SDK work only. We'll estimate it if you lean toward A.

**What it would unblock:**

- **No longer blocked by routes:** DEX Base, DEX Arbitrum, Staking Sepolia.
- **Still blocked:**
  - DEX BNB: USDT;
  - Lending Base: LINK, USDbC (wrapping covers its Moonwell WETH);
  - Lending Sepolia and Lending BNB: none of their tokens are wrapped native.

**Options:**

- **A. Allow native + wrap**
- **B. Keep WETH/WBNB exactly:** those presets wait for the routes in question 2

**Decision needed:** A or B? With A, the WETH/WBNB entries drop out of question 2.
