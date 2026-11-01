# Team questions (draft only; nothing has been sent)

> **Superseded on 21 October** by [questions-harsh.md](../questions-harsh.md) (product decisions, no recommendations, gas ceiling removed as UI work), [questions-aman.md](../questions-aman.md) (presets: tokens, routes, native ETH/BNB wrap), [questions-zaryab.md](../questions-zaryab.md) (AGW contract only) and [questions-core-gateway.md](../questions-core-gateway.md) (gas price, registry endpoint, deployed sources, Solana gateway). This file is the review-time snapshot.

These are the smallest set of open questions after the review. Questions already answered by source, chain state or evidence are listed at the end, with their answers, so they can be dropped from our existing drafts.

## Harsh (product / SDK spec)

1. **Apps optional.** For "tokens only" rules, may the UI generate EVM ERC20 `transfer(to, amount)` permissions with **named recipients** and a **per-transfer** cap?
   - That permission also lets the agent move tokens already in the wallet's destination account to those recipients, an unlimited number of times until expiry.
   - Native coins (ETH/BNB) and Solana are excluded from this first version.
   - Alternatives: any recipient (not recommended), or only the owner's own address on that chain.
2. **All tokens.** Should "no tokens selected" stay as "no tokens sent from Push" (current behaviour)? Should an explicit **"All supported tokens (N)"** choice expand into a visible list of at most 8 tokens per chain, each with its own cap? Only a new contract model could cover future tokens.
3. **Limit wording.** Can we ship the labels in [decision-matrix.md §D](decision-matrix.md)? They say per-send, per-action and per-transaction gas; that the total counts sends that later fail; that wallet-held funds are not counted; and that DEX price and slippage are not limited.
   - Is a combined per-request limit, or a cumulative destination limit, required? Both need contract work.
   - For Push-native rules, should the public shape expose total caps (`maxValueTotal`, call counts, cumulative token amount)? The contract already supports them; this is SDK and spec work only.
4. **Wrapped-native presets.** For the WETH/WBNB legs (DEX on Base, Arbitrum and BNB) and Sepolia EigenLayer WETH, may a preset export the native coin (pETH / pBNB) and wrap it on the destination, instead of exporting the wrapped ERC20? Caps would stay in the same units. This works with deployed contracts; it is SDK catalog work.
5. **Gas ceiling policy.** Which should we adopt?
   - (a) A fixed 20 PC with a BNB-testnet caveat.
   - (b) Per-chain ceilings, for example BNB 60 PC.
   - (c) A public read-only gas-budget quote helper that the UI uses to prefill: at least 20 PC, or 2× the current first-send quote.

   Please also confirm that a per-transaction ceiling with no total gas limit is acceptable.
6. **Native function count.** Spec §6.h says 1..32 allowed calls for every chain. Deployed Push-native rules allow 8 distinct (target, function) pairs. Can the spec say 1..8 for Push rules, or is more than 8 a real requirement (contract change)?

## Core / node owners (uregistry, UniversalCore)

1. **Confirm the three Circle USDC routes** below support **outbound** delivery and are not being retired, despite the `.old` label:

   | Chain | Token | Push token |
   |---|---|---|
   | eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E` |
   | eip155:84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x84B62e44F667F692F7739Ca6040cD17DA02068A8` |
   | eip155:421614 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6` |

   - What we checked: they are enabled in the node's token registry at height 24,457,377; their on-chain source address, decimals (6) and outbound quotes are correct; and their supply is backed by the destination Vault.
   - **What the SDK does next:** add address-keyed mappings, then run a funded test of creation and delivery. That makes DEXES Sepolia and LENDING Arbitrum route-ready.

2. **Provision these routes, or say they won't be supported.** For each token we need: a uregistry `TokenConfig` (chain, address, decimals, enabled, and the Push token address); the Push token deployed and initialised with the matching source chain and address; UniversalCore gas config; an inbound gateway threshold; and Vault liquidity.

   | Token | Address |
   |---|---|
   | Sepolia Aave LINK | `0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5` |
   | Sepolia WETH9 (EigenLayer strategy underlying) | `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` |
   | Base Sepolia WETH | `0x4200000000000000000000000000000000000006` |
   | Base Sepolia Aave LINK | `0x810D46F9a9027E28F9B01F75E2bdde839dA61115` |
   | Base Sepolia Moonwell USDbC | `0x4616975f7E6045FD9737e95bC527e9e14c727BD2` |
   | Base Sepolia Moonwell WETH | `0x663A6F02d547dFd639BF689FED298712f2FB69Fb` |
   | Arbitrum Sepolia WETH | `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |
   | BNB testnet WBNB | `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` |
   | BNB testnet USDT (Venus) | `0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c` |
   | BNB testnet USDC (Venus) | `0x16227D60f7a0e586C66B005219dfc887D13C9531` |

   The WETH and WBNB legs can drop off this list if product approves the wrapped-native alternative (Harsh 4).

3. **BNB testnet gas price.** Donut's `gasPriceByChainNamespace("eip155:97")` moved between 0.055, 0.11 and 1.1 gwei within about 100 minutes (blocks 24,455,072–24,457,472). Is that expected oracle behaviour? It decides whether a 20 PC ceiling covers a first BNB send.
4. **Supported registry endpoint.** Can the SDK rely on `abci_query /uregistry.v1.Query/AllTokenConfigs` (or a public REST/gRPC endpoint) as the canonical route source, or should it ship a snapshot?
5. **Deployed UniversalCore source.** Which commit is deployed? It returns 6 values (with `gasLimitUsed`) and reverts below the base limit; core `main` (`b2f22241`) returns 5.

## Gateway owners (Solana)

1. **Which source is deployed at `CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS`?** The pinned `gateway-testnet@b205770f` declares `DJoF…`.
   - Please confirm the finalize gas formula is "signature fee + `ExecutedSubTx` rent + first-use CEA ATA rent". Live reimbursements matched it: 2,184,320 and 695,880 lamports.
   - Is the unused `gas_fee` refunded to the wallet on Push?
2. **A second E2E program.** Can the gateway run a CEA-signed CPI into SPL Memo v2 (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, non-Anchor, data only)? If not, please give us a devnet program ID and IDL for a reviewed program with fixed-width arguments that moves SPL tokens.

## AGW contract owners (Zaryab)

1. **Native ceiling.** Confirm 8 native actions is intentional for v6. Ask only if Harsh's answer to question 6 is "more than 8".
2. **`fromEnd` data pins (information only).** Rules do not limit instruction-data length. Can an agent append trailing bytes that a `fromEnd` pin would read, while the program ignores them? The SDK does not expose `fromEnd` today.

## Already answered: remove from our drafts

| Old question | Answer |
|---|---|
| "Canonical PRC20s for the preset tokens?" (questions-zaryab) | Partly answered by the node registry: the three Circle USDC routes exist. Only the list in Core question 2 remains |
| "Does gateway allow-listing establish a route?" | No. `isSupportedToken` is an inbound threshold only (`UniversalGateway.sol:770`). Outbound needs Vault liquidity (`Vault.sol:417-423`) or the TSS balance for native coins |
| "Do Solana pins enforce wallet token accounts in every case?" (questions-zaryab 2) | Answered by source. URP cannot check which account belongs to whom (`Types.sol:585-587`); the owner pins positions, and the SDK pins the wallet's token account. Pins compare exact keys; writable and signer flags are not checked |
| "Are allowed functions required?" | Yes. EVM: `AllowListOutOfRange(0)` (URP:347). Solana: at least one program rule, each with an account pin (`SvmRulebook.sol:132, 251`). Every request needs at least one call |
| "Is there an asset wildcard?" | No. 1..8 explicit Push tokens on the chain; no sentinel (`RulesLib.sol:39`, `:64-71`) |
| "What does the total cap count?" | Only the amount sent from Push per request, over the rule's lifetime. Never decremented; `creditRevert` is inactive (URP:584-608, 1052) |
| "What does the 10 PC quote mean?" | The SDK's $1 minimum at the fixed $0.10 rate for Push-native signers. Gas actually spent was 0.0008–2.37 PC |
