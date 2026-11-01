# AGW Presets: proposal and rules

Presets are ready-made rule sets for `client.agentic.create`: pick a category, add an agent, a token budget and an expiry, and get one `Rule` per chain that already names the right contracts, calls and pins. The wallet UI and developers read the same presets from `PushChain.utils.agentic.presets`. 

This doc proposes the first preset list, the allowed calls and pins per app, and the contract and SDK changes the rest depends on. It extends page 5 (SDK: AGW), section 7.

- Addresses: read from each protocol's deployment files or docs on 2026-10-13 (Sources at the end). Three carry caveats, listed in section 11, item 12.

# Prerequisites

> 
> 
> 
> [7. Changes proposed on 12 Oct 2026: Presets](https://app.notion.com/p/7-Changes-proposed-on-12-Oct-2026-Presets-07ce163677ef44dfae03a38ea4c16da0?pvs=21) 
> 
> Contract source, what the rules policy checks today: [push-agentic-wallets, branch demo-v2](https://github.com/pushchain/push-agentic-wallets/tree/demo-v2/src), `src/libraries/Types.sol` (the rule shapes) and `src/policies/UniversalRulesPolicy.sol` (the gates); URP 3.1.0, the version on Donut
> 
> [https://www.figma.com/design/FvJL0JWHlsVohsHTERB1Lh/Push-Design-Foundations?node-id=50458-26112&t=GpO3AVzquTow00Gj-0](https://www.figma.com/design/FvJL0JWHlsVohsHTERB1Lh/Push-Design-Foundations?node-id=50458-26112&t=GpO3AVzquTow00Gj-0)
> 

![image.png](AGW%20Presets%20proposal%20and%20rules/image.png)

# Categories

Custom is always open: a user can write any rule by hand in `client.agentic.create`, so a category left out here is not blocked, only not pre-filled. Presets are shortcuts for the common cases.

**Factors a category must pass to be a preset**

1. **Fixed strategy, user fills the blanks.** The preset picks the contracts and functions. The user picks the agent, fn params. If the user would have to pick the contracts too, it is Custom.
2. **The receiver can be locked to the wallet.** Every call that moves funds has a "to" argument we can pin. Aggregators, order books and Universal Router hide it inside a bytes blob, so they are out.
3. **Popular.** Top apps by volume or TVL.

| Category | In v1? | Why |
| --- | --- | --- |
| DEXES | Yes | Swaps on routers with the recipient at a fixed position, 2 to 3 routers. The user names the tokens, the preset pins them (section 7) |
| LENDING | Yes | Supply, withdraw, borrow, repay on 2 to 3 money markets, with the position owner pinned to the wallet |
| STAKING | Yes | Liquid staking and restaking. Pins well: the receipt token goes to `msg.sender`, and the native coin sent is capped per call by `maxValue` |
| VAULTS | No, next | ERC-4626 `deposit`, `withdraw`, `redeem` with the receiver pinned; the most pinnable category. Needs the vault list first |
| PREDICTION | No | The live venues (Polymarket, Kalshi, Limitless) are order books: the user signs an order off-chain and an operator fills it, and a rule allows contract calls, not signed orders. The on-chain AMM-style markets have no volume. Constant ships empty, hidden by the UI |
| PERPS | No | Dynamic order structs (GMX, Drift), so the receiver cannot be pinned; leverage makes the loss case worse |
| AGGREGATORS | No | 1inch, 0x, Paraswap: dynamic calldata by design, nothing to pin. Jupiter `route` on Solana is the exception (user accounts at fixed positions, amounts pinnable from the end of the data) and sits in DEXES as a candidate |
| NFT MARKETS | No | Dynamic order structs (Seaport, Magic Eden) |
| BRIDGES | No | The recipient is on another chain; the AGW already moves funds across chains through Push |
| LAUNCHPADS | No | pump.fun pins fine, but it is the DEXES risk with worse odds |
| PAYMENTS | No, later | ERC-20 `transfer(address,uint256)` and SPL transfer with the recipient pinned to addresses the user passes as a parameter. Pins well and loss is bounded; left out of v1 only because agent payments (vendors, subscriptions) are not a demo case yet. GOVERNANCE (`castVote`, `delegate`) is the same shape with no funds moving and little demand |

# Chains in scope

<aside>

Push today is live on the below testnets and analysis for apps will be done against mainnet for these networks

</aside>

| Chain | Mainnet | Testnet |
| --- | --- | --- |
| Ethereum | eip155:1 | Sepolia, eip155:11155111 |
| Base | eip155:8453 | Base Sepolia, eip155:84532 |
| Arbitrum | eip155:42161 | Arbitrum Sepolia, eip155:421614 |
| BNB Chain | eip155:56 | BSC testnet, eip155:97 |
| Solana | mainnet-beta | devnet |

# DEXES

One rule per chain, two or three routers per chain, single-hop and `address[]`-path swaps only. Every swap pins its recipient to the wallet. An app's calls are the same on every chain it is listed for; addresses are in section 6.

| App | Chains | Allowed call | Pin |
| --- | --- | --- | --- |
| Uniswap V3 SwapRouter02 | Ethereum, Base, Arbitrum, BNB | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `[0,3]` = WALLET (word 3); `[0,0]` = tokenIn, `[0,1]` = tokenOut from the user's list (after page 1, 6.3) |
| Uniswap V3 SwapRouter02 | same | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `[0,3]` = WALLET; `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| Uniswap V3 SwapRouter02 | same | `swapExactTokensForTokens(uint256,uint256,address[],address)` (V2 pools through the same router) | `3` = WALLET (word 3); tokens sit inside `path`, not pinnable |
| Uniswap V2 Router02 | Ethereum | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `3` = WALLET (word 3); tokens not pinnable |
| Uniswap V2 Router02 | Ethereum | `swapTokensForExactTokens(uint256,uint256,address[],address,uint256)` | `3` = WALLET (word 3); tokens not pinnable |
| Curve Router NG | Ethereum | `exchange(address[11],uint256[5][5],uint256,uint256,address[5],address)` | `5` = WALLET (word 43, fixed arrays inlined); `[0,0]` = tokenIn pinnable, tokenOut sits at a variable position in `route`, not pinnable |
| Aerodrome Router | Base | `swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)` | `3` = WALLET (word 3); tokens sit inside `routes`, not pinnable |
| Aerodrome Slipstream SwapRouter | Base | `exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | `[0,3]` = WALLET; `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| Aerodrome Slipstream SwapRouter | Base | `exactOutputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))` | `[0,3]` = WALLET; `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| PancakeSwap V3 SmartRouter | Arbitrum, BNB | `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `[0,3]` = WALLET; `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| PancakeSwap V3 SmartRouter | same | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))` | `[0,3]` = WALLET; `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| PancakeSwap V3 SmartRouter | same | `swapExactTokensForTokens(uint256,uint256,address[],address)` | `3` = WALLET (word 3); tokens not pinnable |
| PancakeSwap V2 Router02 | BNB | `swapExactTokensForTokens(uint256,uint256,address[],address,uint256)` | `3` = WALLET (word 3); tokens not pinnable |
| PancakeSwap V2 Router02 | BNB | `swapTokensForExactTokens(uint256,uint256,address[],address,uint256)` | `3` = WALLET (word 3); tokens not pinnable |
| Camelot V3 SwapRouter | Arbitrum | `exactInputSingle((address,address,address,uint256,uint256,uint256,uint160))` (Algebra: recipient is field 2) | `[0,2]` = WALLET (word 2); `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| Camelot V3 SwapRouter | Arbitrum | `exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` | `[0,3]` = WALLET (word 3); `[0,0]` and `[0,1]` = the user's tokens (after 6.3) |
| Raydium CPMM | Solana | `swap_base_input(u64,u64)`, discriminator `8fbe5adac41e33de`; 13 accounts, `maxAccounts` 13 | account 0 = WALLET; account 5 = WALLET ATA(output mint); data pin: min-out ratio on `(amount_in, minimum_amount_out)` |
| Raydium CPMM | Solana | `swap_base_output(u64,u64)`, discriminator `37d96256a34ab4ad` | same |
| Orca Whirlpool | Solana | `swap(u64,u64,u128,bool,bool)`, discriminator `f8c69e91e17587c8`; 11 accounts plus trailing, `maxAccounts` 0 | account 1 = WALLET; accounts 3 and 5 = WALLET ATA(mint A), WALLET ATA(mint B); data pin: `a_to_b` EQ and the min-out ratio |
| Raydium AMM V4 | Solana | `swapBaseIn(u64,u64)`, 1-byte tag 9; `maxAccounts` 17 | account 16 = WALLET; account 15 = WALLET ATA(output mint); min-out ratio |
| Jupiter v6 (candidate) | Solana | `route(Vec<RoutePlanStep>,u64,u64,u16,u8)`, discriminator `e517cb977ae3ad2a`; pools as trailing accounts, `maxAccounts` 0 | account 1 = WALLET; account 3 = WALLET ATA(output mint); amounts pinned from the end of `ix_data` (`fromEnd`), since Borsh writes the vector first |
- Token pins: only the struct-based single-hop calls (`exactInputSingle`, `exactOutputSingle`) can carry them, since `tokenIn` and `tokenOut` are static fields at words 0 and 1. The path-based calls keep the tokens inside a dynamic array, so once 6.3 lands and the user's token list is enforced, the path rows should be dropped or kept with the warning in section 7. Until 6.3 none of the EVM token pins is checked.
- Out on EVM: `exactInput` and `exactOutput` (recipient inside a struct with `bytes path`), Universal Router `execute`, `multicall`, Curve's four- and five-argument `exchange` overloads.
- Solana: the SVM rulebook already exists in the demo-v2 source. An account pin names one key from `ceaAccounts`, so a swap rule allows one output mint; `maxAccounts` 0 admits the trailing tick, bin and pool accounts Orca, Meteora and Jupiter need; the `RATIO_GTE_LE` data pin enforces a minimum output relative to the input. Jupiter `route` is therefore a candidate, to confirm against the program (`shared_accounts_route` uses program-owned intermediates and stays out). Orca, Raydium CLMM and Meteora share the `swap` discriminator `f8c69e91e17587c8`; a rule keys on program and discriminator.

# LENDING

Supply, withdraw, borrow and repay on two or three money markets per chain. Every position is the wallet's: the call acts on `msg.sender` (Compound-style markets, where the CEA is the sender) or pins `onBehalfOf` on the way in and `to` or `receiver` on the way out. Solana is supply and withdraw only.

| App | Chains | Allowed call | Pin |
| --- | --- | --- | --- |
| Aave V3 Pool | Ethereum, Base, Arbitrum, BNB | `supply(address,uint256,address,uint16)` | `2` = WALLET (onBehalfOf, word 2) |
| Aave V3 Pool | same | `withdraw(address,uint256,address)` | `2` = WALLET (to, word 2) |
| Aave V3 Pool | same | `borrow(address,uint256,uint256,uint16,address)` | `4` = WALLET (onBehalfOf, word 4) |
| Aave V3 Pool | same | `repay(address,uint256,uint256,address)` | `3` = WALLET (onBehalfOf, word 3) |
| Compound V3 Comet (cUSDCv3, cWETHv3) | Ethereum, Arbitrum | `supply(address,uint256)` | none; credits `msg.sender` |
| Compound V3 Comet | same | `withdraw(address,uint256)` | none; pays `msg.sender`. Withdrawing the base asset beyond the balance opens a borrow |
| Morpho Blue | Ethereum, Base, Arbitrum | `supply((address,address,address,address,uint256),uint256,uint256,address,bytes)` | `3` = WALLET (onBehalf, word 7) |
| Morpho Blue | same | `supplyCollateral((address,address,address,address,uint256),uint256,address,bytes)` | `2` = WALLET (onBehalf, word 6) |
| Morpho Blue | same | `withdraw((address,address,address,address,uint256),uint256,uint256,address,address)` | `4` = WALLET (receiver, word 8) |
| Morpho Blue | same | `withdrawCollateral((address,address,address,address,uint256),uint256,address,address)` | `3` = WALLET (receiver, word 7) |
| Morpho Blue | same | `borrow((address,address,address,address,uint256),uint256,uint256,address,address)` | `4` = WALLET (receiver, word 8) |
| Morpho Blue | same | `repay((address,address,address,address,uint256),uint256,uint256,address,bytes)` | `3` = WALLET (onBehalf, word 7) |
| Lista Moolah | BNB | the six Morpho Blue calls, same signatures and selectors | as Morpho Blue |
| Moonwell (mUSDC, mWETH) | Base | `mint(uint256)`, `redeem(uint256)`, `redeemUnderlying(uint256)`, `borrow(uint256)`, `repayBorrow(uint256)` | none; every call acts on `msg.sender` |
| Moonwell Comptroller | Base | `enterMarkets(address[])` | none; needed once before borrowing against a market |
| Venus (vUSDT, vUSDC) | BNB | the same five calls as Moonwell | none |
| Venus Unitroller | BNB | `enterMarkets(address[])` | none |
| Kamino Lend | Solana | `deposit_reserve_liquidity(u64)`, discriminator `a9c91e7e06cd6644`; owner 0, reserve liquidity mint 4, reserve collateral mint 6, user source 7, user destination 8 | account 0 = WALLET; account 8 = WALLET ATA(collateral mint at account 6); `maxAccounts` 12 |
| Kamino Lend | Solana | `redeem_reserve_collateral(u64)`, discriminator `ea75b57db98edc1d`; user source 7, user destination 8 | account 0 = WALLET; account 8 = WALLET ATA(liquidity mint at account 4) |
| Jupiter Lend (Earn) | Solana | `deposit(u64)`, discriminator `f223c68952e1f2b6`; signer 0, depositor token account 1, recipient token account 2 | account 0 = WALLET; account 2 = WALLET ATA(fToken mint); `maxAccounts` 17 |
| Jupiter Lend (Earn) | Solana | `withdraw(u64)`, discriminator `b712469c946da122`; signer 0, owner token account 1, recipient 2 | account 0 = WALLET; account 2 = WALLET ATA(underlying mint); `maxAccounts` 18 |

# PREDICTION, venue by venue

Every live venue on the five chains, plus Polymarket for reference.  "Signed order" means the user signs an EIP-712 order off-chain and an operator-only `matchOrders` settles it: nothing for a rule to allow.

| Venue | Chain | How a trade happens | Fits a rule? | 30-day volume |
| --- | --- | --- | --- | --- |
| PancakeSwap Prediction | BNB (BNB, BTC, ETH markets), Arbitrum (ETH) | Direct call: `betBull(uint256)` and `betBear(uint256)` payable, stake is the value, `claim(uint256[])`; position = `msg.sender` | Yes: one static argument, stake capped by `maxValue` | $7.8M |
| Predict.fun (absorbed Probable, March 2026) | BNB | Signed order, operator `matchOrders`; CTF `splitPosition`, `mergePositions`, `redeemPositions` are direct | No for trading; mint and redeem only | $314M |
| Opinion | BNB | Signed order ("OPINION CTF Exchange"), positions held in a Safe; CTF `0xAD1a38cEc043e70E83a3eC30443dB285ED10D774` | No for trading | $274M |
| Limitless | Base | Order book for new markets; legacy Gnosis FPMM markets still live: `buy(uint256,uint256,uint256)`, `sell(uint256,uint256,uint256)`, buyer = `msg.sender`; CTF `0xC9c98965297Bc527861c898329Ee280632B76e18` | Partial: the AMM calls fit, but each market is its own contract and the volume is in the order book | $4.9M |
| Overtime (Thales) SportsAMMV2 | Arbitrum, Base, Optimism | Direct call `trade(TradeData[],uint256,uint256,uint256,address,address,bool)`, ticket to `msg.sender` | Weak: the bet is a dynamic `TradeData[]` (odds, merkle proofs) a rule cannot read; only the stake at word 1 and the collateral at word 5 are pinnable | $7.6M (Arbitrum $2.3M, Base $1.4M) |
| Azuro | Base (Arbitrum dead since 2023) | v3: bettor signature plus oracle signature, relayer calls `betFor`; v2 `bet` carries `bytes data` | No | $2.8M (Base $96k) |
| Polymarket (reference) | Polygon only; the Jupiter tie-up is a front end | Signed order, `CTFExchangeV2.matchOrders` is `onlyOperator`; NegRiskAdapter split, merge, redeem are direct | No, and not on a chain in scope | $5.2B |
| Jupiter Predict (Polymarket and Kalshi liquidity) | Solana | Jupiter's API returns an unsigned transaction; a keeper fills on the underlying market; program id not published | No: keeper front end, program unverified | not listed |
| Drift BET | Solana | Perp orders: `place_perp_order(OrderParams)` with Borsh `Option` fields, many remaining accounts | No: variable-length arguments | not broken out |
| Augur, Gnosis v1 and every Ethereum L1 market | Ethereum | AMM-style, direct calls | Would fit, but dead | $0 |

Out of scope by chain: Myriad (Abstract, Linea), XO Market (own rollup), Kalshi (off-chain). Sport.fun on Base ($4.8M) publishes no contracts. To open the big venues, the wallet's CEA would have to sign orders under a rule (ERC-1271, with maker, assets and amounts pinned):

# STAKING

| App | Chains | Allowed call | Pin |
| --- | --- | --- | --- |
| Lido stETH | Ethereum | `submit(address)` payable | none; stETH to `msg.sender` (the referral may be pinned to 0) |
| Lido wstETH | Ethereum | `wrap(uint256)`, `unwrap(uint256)` | none |
| Lido WithdrawalQueue | Ethereum | `requestWithdrawals(uint256[],address)` | `1` = WALLET (owner, word 1) |
| Lido WithdrawalQueue | Ethereum | `claimWithdrawals(uint256[],uint256[])`, `claimWithdrawal(uint256)` | none; owner must be `msg.sender`, ETH paid to `msg.sender` |
| Rocket Pool DepositPool | Ethereum | `deposit()` payable | none; rETH to `msg.sender` |
| Rocket Pool rETH | Ethereum | `burn(uint256)` | none; ETH to `msg.sender` |
| ether.fi LiquidityPool | Ethereum | `deposit()` payable, `deposit(address)` payable | none; eETH to `msg.sender` |
| ether.fi weETH | Ethereum | `wrap(uint256)`, `unwrap(uint256)` | none |
| ether.fi LiquidityPool | Ethereum | `requestWithdraw(address,uint256)` | `0` = WALLET (recipient, word 0) |
| ether.fi WithdrawRequestNFT | Ethereum | `claimWithdraw(uint256)` | none; ETH to the NFT's owner |
| EigenLayer StrategyManager | Ethereum | `depositIntoStrategy(address,address,uint256)` | none needed (shares to `msg.sender`); optional `0` = strategy and `1` = token to lock the pair |
| EigenLayer DelegationManager | Ethereum | `queueWithdrawals(...)`, `completeQueuedWithdrawal(...)` | none; withdrawer is forced to `msg.sender`, assets go to the staker |
| Lista StakeManager | BNB | `deposit()` payable | none; slisBNB to `msg.sender` |
| Lista StakeManager | BNB | `requestWithdraw(uint256)`, `claimWithdraw(uint256)` | none; BNB to `msg.sender` |
| BNB StakeHub (native) | BNB | `delegate(address,bool)` payable | `0` = validator, a user parameter; credit to `msg.sender` |
| BNB StakeHub (native) | BNB | `undelegate(address,uint256)`, `claim(address,uint256)` | `0` = the same validator |
| Jito (SPL stake pool) | Solana | `DepositSol(u64)`, tag 14; 10 accounts | 0 = Jito pool; 3 (lamports source) = WALLET; 4 = WALLET ATA(JitoSOL); 6 (referrer fee) = the same account; `maxAccounts` 10 |
| Jito (SPL stake pool) | Solana | `WithdrawSol(u64)`, tag 16; 12 accounts | 0 = Jito pool; 2 (authority) = WALLET; 3 = WALLET ATA(JitoSOL); 5 (SOL destination) = WALLET; `maxAccounts` 12 |
| Marinade | Solana | `deposit(u64)`, discriminator `f223c68952e1f2b6`; 11 accounts, none remaining | 6 (transfer_from) = WALLET; 7 (mint_to) = WALLET ATA(mSOL); `maxAccounts` 11 |
| Marinade | Solana | `liquid_unstake(u64)`, discriminator `1e1e77f0bfe30c10`; 10 accounts | 5 = WALLET ATA(mSOL); 6 (authority) = WALLET; 7 (transfer_sol_to) = WALLET; `maxAccounts` 10 |
- Out: Lido `claimWithdrawalsTo(uint256[],uint256[],address)` (names another recipient); Stader BNBx (deposits disabled 29 Jan 2026, protocol sunset); Marinade `order_unstake` (needs a fresh ticket account per call); Jito restaking `mint_to` (takes an SPL token in, so it belongs with VAULTS).
- Approvals: `wrap`, `requestWithdrawals`, `requestWithdraw`, `depositIntoStrategy` and Lista `requestWithdraw` pull a token from the wallet. Covered by scoped approval (section 8, item 3).
- Rocket Pool's deposit pool address changes on upgrades (the Saturn release deployed a new one in 2026 and the old one reverts on `deposit()`). The SDK should resolve it from `RocketStorage.getAddress(keccak256("contract.addressrocketDepositPool"))` at release time rather than hard-code it.
- `deposit()` has the same selector on Rocket Pool, ether.fi and WETH, and `wrap` and `unwrap` the same on wstETH and weETH; rules key on target plus selector, so no clash.
- Jito's `DepositSol` requires the pool to have been updated this epoch. BlazeStake, vSOL and the Sanctum pools use the same program and instruction, so adding one is a pool address. The StakeHub validator is a user parameter (categories, factor 1).

# Addresses

Read from each protocol's deployment files or docs. 

"none" means no official testnet deployment was found.

<aside>

Not all protocols can be tested on testnet

</aside>

### DEXES

| App | Chain | Mainnet | Testnet |
| --- | --- | --- | --- |
| Uniswap V3 SwapRouter02 | Ethereum | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| Uniswap V3 SwapRouter02 | Base | `0x2626664c2603336E57B271c5C0b26F421741e481` | `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4` |
| Uniswap V3 SwapRouter02 | Arbitrum | `0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45` | `0x101F443B4d1b059569D643917553c771E1b9663E` |
| Uniswap V3 SwapRouter02 | BNB | `0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2` | none |
| Uniswap V2 Router02 | Ethereum | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` | `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3` |
| Curve Router NG v1.2 | Ethereum | `0x45312ea0eFf7E09C83CBE249fa1d7598c4C8cd4e` | none |
| Aerodrome Router | Base | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | none |
| Aerodrome Slipstream SwapRouter | Base | `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F` | none |
| PancakeSwap V3 SmartRouter | Arbitrum | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` | none |
| PancakeSwap V3 SmartRouter | BNB | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | `0x9a489505a00cE272eAa5e07Dba6491314CaE3796` |
| PancakeSwap V2 Router02 | BNB | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | `0xD99D1c33F9fC3444f8101754aBC46c52416550D1` |
| Camelot V3 SwapRouter | Arbitrum | `0x1F721E2E82F6676FCE4eA07A5958cF098D339e18` | none |
| Raydium CPMM | Solana | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | `DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb` |
| Orca Whirlpool | Solana | `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc` | same id |
| Raydium AMM V4 | Solana | `675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8` | `DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav` |

### LENDING

| App | Chain | Mainnet | Testnet |
| --- | --- | --- | --- |
| Aave V3 Pool | Ethereum | `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951` |
| Aave V3 Pool | Base | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` | `0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27` |
| Aave V3 Pool | Arbitrum | `0x794a61358D6845594F94dc1DB02A252b5b4814aD` | `0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff` |
| Aave V3 Pool | BNB | `0x6807dc923806fE8Fd134338EABCA509979a7e0cB` | none |
| Compound V3 cUSDCv3 | Ethereum | `0xc3d688B66703497DAA19211EEdff47f25384cdc3` | `0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e`, unmaintained since June 2026 |
| Compound V3 cWETHv3 | Ethereum | `0xA17581A9E3356d9A858b789D68B4d866e593aE94` | none |
| Compound V3 cUSDCv3 | Arbitrum | `0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf` | none |
| Compound V3 cWETHv3 | Arbitrum | `0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486` | none |
| Morpho Blue | Ethereum | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | none |
| Morpho Blue | Base | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | unconfirmed by Morpho's own sources |
| Morpho Blue | Arbitrum | `0x6c247b1F6182318877311737BaC0844bAa518F5e` | none |
| Lista Moolah | BNB | `0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C` | none |
| Moonwell mUSDC | Base | `0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22` | mUSDbC `0x876852425331a113d8E432eFFB3aC5BEf38f033a` |
| Moonwell mWETH | Base | `0x628ff693426583D9a7FB391E54366292F509D457` | `0x2F39a349A79492a70E152760ce7123A1933eCf28` |
| Moonwell Comptroller | Base | `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C` | `0xC72ba45f2Ae134F21DAEb2b7B5fd5De0064Ee9bB` |
| Venus vUSDT | BNB | `0xfD5840Cd36d94D7229439859C0112a4185BC0255` | `0xb7526572FFE56AB9D7489838Bf2E18e3323b441A` |
| Venus vUSDC | BNB | `0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8` | `0xD5C4C2e2facBEB59D0216D0595d63FcDc6F9A1a7` |
| Venus Unitroller | BNB | `0xfD36E2c2a6789Db23113685031d7F16329158384` | `0x94d1820b2D1c7c7452A163983Dc888CEC546b77D` |
| Kamino Lend | Solana | `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD` | same id |
| Jupiter Lend (Earn) | Solana | `jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9` | `7tjE28izRUjzmxC1QNXnNwcc4N82CNYCexf3k8mw67s3`, stale since May 2025, do not use |

### STAKING

Testnets: Hoodi (eip155:560048) for Lido, Rocket Pool and EigenLayer; EigenLayer is also on Sepolia. ether.fi and Lista have no official testnet deployment.

<aside>

Most staking apps now only are on Hoodi rather than sepolia

</aside>

| App | Chain | Mainnet | Testnet |
| --- | --- | --- | --- |
| Lido stETH | Ethereum | `0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84` | Hoodi `0x3508A952176b3c15387C97BE809eaffB1982176a` |
| Lido wstETH | Ethereum | `0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0` | Hoodi `0x7E99eE3C66636DE415D2d7C880938F2f40f94De4` |
| Lido WithdrawalQueue | Ethereum | `0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1` | Hoodi `0xfe56573178f1bcdf53F01A6E9977670dcBBD9186` |
| Rocket Pool RocketStorage | Ethereum | `0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46` | Hoodi `0x594Fb75D3dc2DFa0150Ad03F99F97817747dd4E1` |
| Rocket Pool DepositPool (current) | Ethereum | `0xCE15294273CFb9D9b628F4D61636623decDF4fdC` | Hoodi `0x425E6f83e27f1676AD78BC39dA79C2C7b33d3Fd8` |
| Rocket Pool rETH | Ethereum | `0xae78736Cd615f374D3085123A210448E74Fc6393` | Hoodi `0x7322c24752f79c05FFD1E2a6FCB97020C1C264F1` |
| ether.fi LiquidityPool | Ethereum | `0x308861A430be4cce5502d0A12724771Fc6DaF216` | none |
| ether.fi weETH | Ethereum | `0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee` | none |
| ether.fi WithdrawRequestNFT | Ethereum | `0x7d5706f6ef3F89B3951E23e557CDFBC3239D4E2c` | none |
| EigenLayer StrategyManager | Ethereum | `0x858646372CC42E1A627fcE94aa7A7033e7CF075A` | Hoodi `0xeE45e76ddbEDdA2918b8C7E3035cd37Eab3b5D41`; Sepolia `0x2E3D6c0744b10eb0A4e6F679F71554a39Ec47a5D` |
| EigenLayer DelegationManager | Ethereum | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A` | Hoodi `0x867837a9722C512e0862d8c2E15b8bE220E8b87d`; Sepolia `0xD4A7E1Bd8015057293f0D0A557088c286942e84b` |
| EigenLayer stETH strategy | Ethereum | `0x93c4b944D05dfe6df7645A86cd2206016c51564D` | Hoodi `0xf8a1a66130d614c7360e868576d5e59203475fe0` |
| Lista StakeManager | BNB | `0x1adB950d8bB3dA4bE104211D5AB038628e477fE6` | none published |
| Lista slisBNB | BNB | `0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B` | unverified |
| BNB StakeHub | BNB | `0x0000000000000000000000000000000000002002` | same (system contract) |
| SPL stake pool program (Jito) | Solana | `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy` | devnet build `DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib` |
| Jito pool, JitoSOL mint | Solana | `Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb`, `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` | `JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ`, `J1tos8mqbhdGcF3pgj4PCKyVjzWSURcpLZU7pPGHxSYi` |
| Marinade program | Solana | `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD` | same id |
| Marinade state, mSOL mint | Solana | `8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC`, `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` | state not documented for devnet; mint the same |

# Open questions and decisions needed

1. **Approvals.** Scoped approval in URP, or one spender per token per rule for v1, which means one app per chain per preset and an allowance that outlives the rule? (Rules policy owner)
2. **Output tokens.** Until page 1, 6.3 lands no token pin is checked on EVM, and a pin holds one value. Ship DEXES with one output token per rule, or ship LENDING first and DEXES after the set pin
3. **One instruction per transaction on Solana.** Blocks every borrow flow (Kamino, Save, MarginFi need refresh instructions in the same transaction) and creating the output token account before a first swap. Relax to one allowed instruction plus instructions from a fixed list (refresh, create token account, compute budget)? (Rules policy owner)
4. **Missing cap.** Should `presets.get` throw when an asset has no `maxTotal`, since a missing cap means zero and the rule would move nothing?

# Sources

Deployment files and interfaces opened on 2026-10-13. Where a docs site was unreachable, the protocol's GitHub deployment file or published npm package was used instead.

- Uniswap: [V3 Ethereum deployments](https://github.com/Uniswap/docs/blob/main/docs/content/protocols/v3/deployments/v3-ethereum-deployments.mdx), [V3 Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments), [V3 Arbitrum deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-arbitrum-deployments.md), [sdk-core addresses](https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts), [IV3SwapRouter](https://raw.githubusercontent.com/Uniswap/swap-router-contracts/main/contracts/interfaces/IV3SwapRouter.sol), [IV2SwapRouter](https://raw.githubusercontent.com/Uniswap/swap-router-contracts/main/contracts/interfaces/IV2SwapRouter.sol), [IUniswapV2Router02](https://raw.githubusercontent.com/Uniswap/v2-periphery/master/contracts/interfaces/IUniswapV2Router02.sol)
- Curve: [curve-router-ng](https://raw.githubusercontent.com/curvefi/curve-router-ng/master/README.md), [deployed contracts](https://raw.githubusercontent.com/CurveDocs/curve-docs/master/docs/references/deployed-contracts.md)
- Aerodrome: [contracts README](https://raw.githubusercontent.com/aerodrome-finance/contracts/main/README.md), [IRouter](https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/interfaces/IRouter.sol), [Slipstream README](https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/README.md), [Slipstream ISwapRouter](https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/contracts/periphery/interfaces/ISwapRouter.sol)
- PancakeSwap: [v3 addresses](https://raw.githubusercontent.com/pancakeswap/pancake-developer/master/docs/pages/contracts/v3/addresses.md), [v3-periphery deployments](https://raw.githubusercontent.com/pancakeswap/pancake-v3-contracts/main/projects/v3-periphery/deployments/bscMainnet.json), [IPancakeRouter02](https://raw.githubusercontent.com/pancakeswap/pancake-swap-periphery/master/contracts/interfaces/IPancakeRouter02.sol), npm `@pancakeswap/smart-router@7.8.0`
- Camelot: [Algebra V1.9 ISwapRouter](https://raw.githubusercontent.com/cryptoalgebra/AlgebraV1.9/main/src/periphery/contracts/interfaces/ISwapRouter.sol), [verified source mirror, Router v3](https://www.codeslaw.app/contracts/arbitrum/0x1f721e2e82f6676fce4ea07a5958cf098d339e18)
- Aave: [address book, Ethereum](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Ethereum.sol), [Sepolia](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Sepolia.sol), [Base](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol), [Base Sepolia](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3BaseSepolia.sol), [Arbitrum](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Arbitrum.sol), [Arbitrum Sepolia](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3ArbitrumSepolia.sol), [BNB](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3BNB.sol), [IPool](https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/interfaces/IPool.sol)
- Compound V3: [mainnet USDC roots](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/mainnet/usdc/roots.json), [Arbitrum USDC roots](https://raw.githubusercontent.com/compound-finance/comet/main/deployments/arbitrum/usdc/roots.json), [CometMainInterface](https://raw.githubusercontent.com/compound-finance/comet/main/contracts/CometMainInterface.sol)
- Morpho: [IMorpho](https://raw.githubusercontent.com/morpho-org/morpho-blue/main/src/interfaces/IMorpho.sol), [SDK addresses](https://raw.githubusercontent.com/morpho-org/sdks/main/packages/morpho-ts/src/addresses.ts), [docs addresses](https://docs.morpho.org/get-started/resources/addresses/)
- Moonwell: [Base addresses](https://raw.githubusercontent.com/moonwell-fi/moonwell-contracts-v2/main/chains/8453.json), [Base Sepolia addresses](https://raw.githubusercontent.com/moonwell-fi/moonwell-contracts-v2/main/chains/84532.json), [MToken](https://raw.githubusercontent.com/moonwell-fi/moonwell-contracts-v2/main/src/MToken.sol)
- Venus: [mainnet addresses](https://raw.githubusercontent.com/VenusProtocol/venus-protocol/develop/deployments/bscmainnet_addresses.json), [testnet addresses](https://raw.githubusercontent.com/VenusProtocol/venus-protocol/develop/deployments/bsctestnet_addresses.json), [VBep20](https://raw.githubusercontent.com/VenusProtocol/venus-protocol/develop/contracts/Tokens/VTokens/VBep20.sol)
- Lista: [lista-skills](https://raw.githubusercontent.com/lista-dao/lista-skills/main/skills/lista-lending/SKILL.md), npm `@lista-dao/moolah-sdk-core@1.0.12`
- Raydium: [program addresses](https://docs.raydium.io/reference/program-addresses.md), [CPMM IDL](https://github.com/raydium-io/raydium-idl), [AMM V4 instruction.rs](https://raw.githubusercontent.com/raydium-io/raydium-amm/master/program/src/instruction.rs)
- Orca: [whirlpools](https://github.com/orca-so/whirlpools)
- Meteora: [DLMM overview](https://docs.meteora.ag/developer-guide/guides/dlmm/overview), [dlmm-sdk](https://github.com/MeteoraAg/dlmm-sdk)
- Jupiter: [jupiter-cpi IDL](https://raw.githubusercontent.com/jup-ag/jupiter-cpi/main/idl.json), [development basics](https://developers.jup.ag/docs/get-started/development-basics.md), [Lend program addresses](https://developers.jup.ag/docs/lend/program-addresses.md), [jupiter-lend](https://github.com/jup-ag/jupiter-lend)
- Kamino: [klend](https://github.com/Kamino-Finance/klend), [klend-sdk](https://github.com/Kamino-Finance/klend-sdk)
- MarginFi: [marginfi-v2](https://github.com/mrgnlabs/marginfi-v2)
- Save: [token-lending instruction.rs](https://raw.githubusercontent.com/solendprotocol/solana-program-library/master/token-lending/program/src/instruction.rs)
- Volume and TVL: [DefiLlama DEXes, Ethereum](https://defillama.com/dexs/chains/Ethereum), [Base](https://defillama.com/dexs/chains/base), [Arbitrum](https://defillama.com/dexs/chain/arbitrum), [Arbitrum lending](https://defillama.com/protocols/lending/arbitrum), [prediction markets, Ethereum](https://defillama.com/protocols/prediction-market/ethereum), [Polymarket](https://defillama.com/protocol/polymarket)
- Prediction markets: [Drift BET launch](https://www.theblock.co/post/311888/solana-based-drift-protocol-launches-prediction-market), [Jupiter and Polymarket](https://www.coindesk.com/markets/2026/02/02/jupiter-brings-polymarket-to-solana-and-lands-usd35-million-investment-deal), [Jupiter Forecast](https://solanacompass.com/news/jupiter-launches-forecast-solanas-first-native-prediction-market-with-multi-market-maker-quoting)
- Staking: [Lido deployed contracts](https://raw.githubusercontent.com/lidofinance/docs/main/docs/deployed-contracts/index.md), [Lido Hoodi](https://raw.githubusercontent.com/lidofinance/docs/main/docs/deployed-contracts/hoodi.md), [WithdrawalQueue.sol](https://raw.githubusercontent.com/lidofinance/core/master/contracts/0.8.9/WithdrawalQueue.sol), [Rocket Pool contracts](https://raw.githubusercontent.com/rocket-pool/docs.rocketpool.net/main/docs/en/protocol/contracts-integrations.md), [RocketDepositPool.sol](https://raw.githubusercontent.com/rocket-pool/rocketpool/master/contracts/contract/deposit/RocketDepositPool.sol), [ether.fi deployed contracts](https://etherfi.gitbook.io/etherfi/developers/contracts-and-integrations/deployed-contracts), [LiquidityPool.sol](https://raw.githubusercontent.com/etherfi-protocol/smart-contracts/master/src/core/LiquidityPool.sol), [eigenlayer-contracts README](https://raw.githubusercontent.com/Layr-Labs/eigenlayer-contracts/main/README.md), [Lista smart contracts](https://docs.bsc.lista.org/for-developer/liquid-staking-slisbnb/smart-contract.md), [ListaStakeManager.sol](https://raw.githubusercontent.com/lista-dao/synclub-contracts/master/contracts/ListaStakeManager.sol), [BNB staking developer guide](https://docs.bnbchain.org/bnb-smart-chain/staking/developer-guide/), [StakeHub.sol](https://raw.githubusercontent.com/bnb-chain/bsc-genesis-contract/master/contracts/StakeHub.sol), [Stader BNBx sunset](https://www.staderlabs.com/blogs/sunsetting-bnbx-focusing-stader-on-high-impact-ecosystems/), [SPL stake pool instruction.rs](https://raw.githubusercontent.com/solana-program/stake-pool/main/program/src/instruction.rs), [Jito deployed programs](https://www.jito.network/docs/jitosol/jitosol-liquid-staking/security/deployed-programs/), [Marinade contract addresses](https://docs.marinade.finance/developers/contract-addresses), [Marinade deposit.rs](https://raw.githubusercontent.com/marinade-finance/liquid-staking-program/main/programs/marinade-finance/src/instructions/user/deposit.rs), [BlazeStake addresses](https://stake-docs.solblaze.org/developers/addresses.md)