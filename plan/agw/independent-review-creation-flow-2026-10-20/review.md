# Independent review: AGW creation flow, 20 October 2026

This is an engineering review, not a full security audit. Baseline, commands, block numbers and limitations are in [evidence.md](evidence.md). Raw results are in `data/` and the read-only scripts that produced them are in `scripts/`.

References use these roots:

- `sdk/` = `packages/core/src/lib/`
- `URP` = the deployed AGW source at `ffd567d` (`src/policies/UniversalRulesPolicy.sol`). It was extracted from `deploy-agw@e57998c`, whose `src/` is byte-identical.

## Overall verdict

1. **The Solana omitted-gas change is correct, and strictly better than before. Ship it.**
   - The old `1,000,000` input could never succeed. The SDK capped the gas budget at $10 (100 PC with a Push-native agent), but the gas swap needed about 906 PC at Donut block 24,457,144, so the swap would revert. With a ceiling under 100 PC, the policy refused the send first.
   - The new path (input 0) behaves as follows:
     - Core substitutes its base limit of 960.
     - The SDK raises the gas budget to cover finalization rent.
     - This was verified live for a first SPL send (gas limit 2,285) and a later one (960), and re-derived independently from Solana transactions.
   - The fix is uncommitted on v4. Published `6.0.27-alpha.5` still uses `BigInt(1_000_000)`.

2. **Our preset-route conclusion is partly wrong.** Three default tokens that we report as having no route are Circle USDC on Sepolia, Base Sepolia and Arbitrum Sepolia. All three have **enabled, inbound-backed node routes** that the SDK registry simply omits (F1).
   - With SDK registry work alone, plus a core confirmation, **DEXES Sepolia** and **LENDING Arbitrum Sepolia** can become route-ready.
   - DEXES on Base and Arbitrum would still lack their WETH leg.
   - The other five presets need external provisioning, or a product-approved change of asset.

3. **Apps-optional, all-tokens and spending limits** are constrained by contract facts we have now verified (Findings F7, F10, F11).
   - The contracts require at least one allowed function and at least one destination call per request.
   - There is no asset wildcard; a rule holds 1 to 8 explicit assets.
   - Every destination-side limit applies per call.
   - EVM transfer-only rules can already be written with the public API today.
   - Solana transfer-only rules are impossible without contract work, because the System and SPL Token programs are forbidden targets.

4. **Gas guidance must change.**
   - The uniform "10 PC" observations come from the SDK: a $1 minimum budget, converted at a hardcoded $0.10 per PC for Push-native signers.
   - Measured consumption was 0.0008–2.37 PC per send. The remainder was refunded in the same transaction (confirmed from wallet balances).
   - 20 PC is not robust: BNB-testnet first use exceeded it during this review (F4).
   - Two existing SDK gas-sizing bugs affect AGW (F5).

5. **The tests are better than average** and do what they say. The gaps are listed in F8. Nothing hides a skip or passes unconditionally. The nine live preset cases are blocked, not passing.

## Findings, by severity

Classification for each finding:

- **Type:** bug / evidence correction / ambiguity / product decision / external dependency.
- **Blocks:** publication / preset usability / extension only.

### F1 — High: Circle USDC routes exist on the node but are missing from the SDK registry
**Type:** evidence correction and SDK registry omission. **Blocks:** preset usability (four of the nine presets depend on it).

The node's `uregistry` `AllTokenConfigs` (read via `abci_query` at height 24,457,377; `data/uregistry.json`) lists:

| Source chain | Exact token (Circle USDC) | Node PRC20 | Node label |
|---|---|---|---|
| eip155:11155111 | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E` | USDC.eth.old, enabled |
| eip155:84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x84B62e44F667F692F7739Ca6040cD17DA02068A8` | USDC.base.old, enabled |
| eip155:421614 | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | `0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6` | USDC.arb.old, enabled |

On-chain checks at Donut block 24,457,398 (`data/old-prc20.json`):

- `SOURCE_CHAIN_NAMESPACE` and `SOURCE_TOKEN_ADDRESS` match exactly. Sepolia returns an address word; Base and Arbitrum return strings.
- `decimals = 6`, which matches the preset `stable6` budget.
- `getOutboundTxGasAndFees` succeeds.
- Total supply minus a 1,200,000 premint equals the destination Vault balance:
  - exactly 1,126.991 on Base;
  - exactly 157.3 on Arbitrum;
  - 120,454.41 against a Vault holding 120,464.41 on Sepolia.

  So these are inbound-backed, settled routes (`data/dest-probe.json`).

The registry also has `.old` USDT routes for all four EVM chains, but those are not preset tokens.

Two earlier statements are wrong:

- [token-route-validation README](../research/token-route-validation-2026-10-20/README.md) says: "Existing USDC PRC20 metadata points at different mock token addresses". That is true only for the PRC20s the SDK registers.
- [questions-zaryab.md](../questions-zaryab.md) asks the team for mappings that can be read from the node.

The reason they were missed: the SDK registry is keyed by symbol. `sdk/universal/prc20-address.ts:126-179` maps (chain, symbol) to one `SYNTHETIC_PUSH_ERC20` key, so it cannot hold two USDCs on one chain. Both the compatibility script and the probe searched only that registry.

What becomes possible:

| Preset | Before | With F1 |
|---|---|---|
| DEXES Sepolia | WETH routed, USDC missing | **both routed**. A WETH/USDC pool has liquidity (fee 500: L=1.30e16; `data/dest-probe.json`) |
| LENDING Arbitrum Sepolia | USDC missing | **routed**. The Aave reserve is this exact Circle USDC |
| DEXES Base / Arbitrum | both missing | USDC routed; WETH still missing (F2) |

Recommendation:

1. Ask core/node to confirm the `.old` routes are supported for outbound and are not being retired.
2. Then add an **address-keyed** AGW route table (chain + exact source address → PRC20) that `presetRoutes` (`sdk/agentic/presets/routes.ts:34-52`) and `resolvePrc20` (`sdk/agentic/runtime.ts:169-187`) consult before the symbol path. Keep the on-chain source check in `prepare.ts:135-154`.
3. Run a funded E2E before calling these presets usable.

### F2 — High: the remaining preset tokens need provisioning, or a product-approved native-wrap variant
**Type:** external dependency or product decision. **Blocks:** preset usability.

None of these tokens appears in `uregistry`:

| Chain | Token | Preset(s) | Vault balance | WETH9 `deposit()` |
|---|---|---|---|---|
| Sepolia | Aave LINK `0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5` | LENDING | 0 | n/a |
| Sepolia | EigenLayer WETH `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` | STAKING | 0 | yes |
| Base Sepolia | WETH `0x4200000000000000000000000000000000000006` | DEXES | 0 | yes |
| Base Sepolia | Aave LINK `0x810D46F9a9027E28F9B01F75E2bdde839dA61115` | LENDING | 0 | n/a |
| Base Sepolia | Moonwell USDbC `0x4616975f7E6045FD9737e95bC527e9e14c727BD2`, Moonwell WETH `0x663A6F02d547dFd639BF689FED298712f2FB69Fb` | LENDING | 0 | WETH: yes |
| Arbitrum Sepolia | WETH `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` | DEXES | 0 | yes (proxy implementation `0x3031a6d5…`) |
| BNB testnet | WBNB `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd` | DEXES | 0 | yes |
| BNB testnet | USDT `0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c`, USDC `0x16227D60f7a0e586C66B005219dfc887D13C9531` | DEXES / LENDING | 0 | n/a |

**An alternative we had not considered: native export plus wrap.**

- The native PRC20 routes (pETH, pETH.base, pETH.arb, pBNB) are live. `gas-live.spec.ts` proved native export into the CEA on all four testnets.
- The CEA multicall can call `WETH.deposit{value}`. A universal rule can authorize that, because `maxValue` is a per-entry value cap (URP:902-906).
- Uniswap's SwapRouter02 can also wrap when `msg.value` is sent with `tokenIn = WETH9`. That needs the router's WETH9 to be verified first.

This covers the wrapped-native leg of DEXES on Base, Arbitrum and BNB, and the Sepolia EigenLayer WETH. Aave's Base WETH reserve is `0x4200…06` itself.

It is **not** reachable through `presets.get` today:

- DEX presets refuse native markers (`sdk/agentic/presets/index.ts:233-243`).
- Swap pairs are generated only from export assets (`:268-296`).

It changes the preset's export asset (ETH instead of WETH) and adds a wrap permission, so it needs product approval and SDK catalog work. No contract change is required.

**What stays blocked even then:** LENDING Sepolia (LINK), LENDING Base (LINK, Moonwell), LENDING BNB and the DEXES BNB USDT leg (Venus tokens). These need provisioning, or a different reviewed protocol asset.

### F3 — High: "10 PC" is an SDK floor, not a fee; attached, consumed and refunded amounts are now measured
**Type:** evidence correction. **Blocks:** publication of gas guidance.

How the SDK sizes the gas budget:

- `sdk/orchestrator/internals/gas-usd-sizer.ts:105-117` puts the budget in one of three bands:
  - below $1: raised to $1;
  - $1 to $10: passed through;
  - above $10: capped at $10.
- `pc-usd-oracle.ts:42-48` has no Push Chain origin, so a Push-native signer falls back to `usdcToPush` at a fixed $0.10 (`pc-usd-oracle.ts:322-333`). That makes $1 exactly 10 PC.
- The E2E agents and `check-agw-gas-quotes.js` all sign as Push-native, so every observation was this floor.

A signer from another chain is priced through the Donut WPC/USDT pool for its origin. At the review blocks (`data/push-probe.json`, `data/sdk-quotes.json`):

| Signer origin | PC/USD | $1 minimum attached |
|---|---|---|
| Push-native (fixed fallback) | $0.10 | 10 PC |
| Ethereum Sepolia UEA | $0.2326 | 4.30 PC |
| Arbitrum Sepolia | $0.0988 | ≈10.1 PC |
| Base Sepolia | $0.0993 | ≈10.1 PC |
| BNB testnet | $0.1031 | ≈9.7 PC |
| Solana UEA | $0.0910 | 10.99 PC |

Measured from the live receipts (`SwapAndBurnGas.pcIn`; `data/push-probe.json`). Each send attached 10 PC:

| Send | gasLimit used | gasFee | PC consumed by gas swap | Refunded |
|---|---:|---:|---:|---:|
| SPL first use | 2,285 | 2,285,000 lamports | 2.0697 | 7.93 |
| SPL subsequent | 960 | 960,000 lamports | 0.8695 | 9.13 |
| Sepolia first / subsequent | 2,000,000 / 500,000 | 2.20e12 / 5.50e11 wei | 0.0032 / 0.0008 | ≈10 |
| Base first / subsequent | 2,000,000 / 500,000 | 1.32e13 / 3.30e12 | 0.5915 / 0.1479 | 9.41 / 9.85 |
| Arbitrum first / subsequent | 2,000,000 / 500,000 | 4.52e13 / 1.13e13 | 1.9297 / 0.4820 | 8.07 / 9.52 |
| BNB first / subsequent | 2,000,000 / 500,000 | 2.20e14 / 5.50e13 | 2.3652 / 0.5913 | 7.63 / 9.41 |

The refund is confirmed:

- The SPL wallet's PC balance fell by exactly `pcIn` at Push blocks 24,455,663 and 24,455,695: −2.06965 and −0.86953 PC (`data/dest-receipts.json`).
- `swapAndBurnGas` refunds `msg.value − amountInUsed` to the caller.

Separately, the agent's own Push gas was 0.00042–0.00053 PC per send.

Recommendation: report all six quantities separately (see the decision matrix, E). Remove "10 PC quoted" as a fee claim.

### F4 — High: a 20 PC ceiling fails BNB-testnet first use at current Donut gas prices
**Type:** confirmed risk. **Blocks:** preset usability on BNB; the 20 PC guidance.

- Donut's BNB `gasPriceByChainNamespace` read 55,000,000 / 110,000,000 / 1,100,000,000 wei across blocks 24,455,072–24,457,472, roughly 100 minutes (`data/gasprice-history.json`). The live BNB test ran at 0.11 gwei. Other chains were stable.
- At 1.1 gwei, a first BNB send (2,000,000 gas, 0.0022 BNB) attaches:
  - 53.5 PC for a Push-native signer (traced; `scripts/trace-bnb.cjs`);
  - 23.0 PC for a Sepolia UEA;
  - 58.8 PC for a Solana UEA.

  Every one is above 20 PC, so URP refuses with `PCValueExceedsCap` (URP:593). The refusal is safe: it is decoded before broadcast into "The required gas exceeds this rule's gas budget" (`sdk/agentic/error-messages.ts:146`).
- Subsequent BNB sends still fit: 13.4 / 5.75 / 14.7 PC.
- Part of the excess is F5(a).

### F5 — High (existing SDK bugs, not caused by this change): gas sizing does not match what the gateway charges
**Type:** confirmed bugs. **Blocks:** none on these testnets except the cases noted; they block mainnet use and explicit large gas limits.

**(a) BNB gas is priced with ETH/USD.**
- `gas-usd-sizer.ts:74-77` uses Sepolia for every EVM destination, and its log labels BNB gas as "pETH".
- At ETH $2,432 this inflates BNB budgets by about the ETH/BNB price ratio.

**(b) The over-$10 overflow is dropped on the AGW path.**
- `gas-calculator.ts:253` returns `gasLegNativePc + protocolFee`, and `sdk/agentic/runtime.ts:141-159` passes only that value on.
- The gateway does an exact-output swap for the full `gasFee` (core `UniversalCore.sol:224-246`), so it reverts.
- Example: the legacy 1,000,000 Solana input attaches 100 / 43.0 / 109.9 PC, depending on origin, against 905.8 PC required.

**(c) The SDK sizes by dollars, but the contract pays the Donut pool rate.**
- A Sepolia-UEA BNB first send attaches 23.00 PC, but the pool quote needs 23.65 PC. The swap would revert even under a high ceiling.

Recommendation (SDK-only):
- Size the gas budget from Donut QuoterV2 `quoteExactOutputSingle(WPC → gasToken, gasFee)` plus headroom.
- Fail before signing when the result exceeds the rule's `maxGasPerCall`, using a typed error.
- Fix the BNB price source.

### F6 — Medium: the compatibility method was narrower than our conclusions
**Type:** evidence correction.

What `scripts/check-agw-preset-compatibility.js` actually covers:

- Candidates are only the SDK `MOVEABLE_TOKENS` entries that map through the symbol registry (`:61-104`).
- Native routes are skipped (`:65`).
- DEX pools are searched only between pairs where *both* tokens are routed (`:133-150`). That misses the useful case of one routed token traded against a destination-held token.
- The script does treat RPC errors correctly as failures, both per pool and per protocol, with a non-zero exit. One gap: a candidate whose Push `SOURCE_*` read fails is silently recorded as `unavailable`, with no exit-code impact (`:101-107`).

The external gateway's `isSupportedToken` is an **inbound** allow-list:

- `UniversalGateway.sol:770`: `tokenToLimitThreshold[token] != 0`, used only in `_handleDeposits`.
- Outbound ERC20 settlement needs Vault liquidity (`Vault.sol:417-423`). Native outbound is funded from the TSS balance.

So "allow-listed" never proved route availability. The Vault balances above are the relevant check.

Our "no substitution" recommendation still stands, now for the right reason: same-symbol mocks have no Aave, Moonwell or Venus market and no protocol pools.

### F7 — Medium: spending limits are narrower than "spending limit" suggests
**Type:** product decision and wording. **Blocks:** UI copy for publication.

Verified in source:

- `assets[i].maxPerCall` and `maxTotal` meter only `req.amount` exported from Push. The check is at URP:584-591; spend is written at :605-608, only when `amount > 0`.
- `creditRevert` is inactive (URP:1052-1054), so **a send that later fails on the destination still consumes `maxTotal`**.
- Destination pins (`EQ`/`MAX`) and `maxValue` are checked per inner call (URP:775-791, 879-938). There is no sum within a request (up to 10 calls, URP:81, 770) and none across requests.
- Balances already held in the CEA can be redeployed until the rule expires. The contract docs say so: `docs/1_AGW.md:454`, `docs/5_SDK_Owner_Integration.md:226`.
- `maxGasPerCall` bounds the PC attached to each request (URP:593). There is no gas counter (URP:1055-1056); only the wallet's PC balance bounds cumulative gas.
- Preset DEX swap pins fix tokenIn, tokenOut, recipient and the input amount. They do not fix the fee tier, `amountOutMinimum` or the price limit (`presets/index.ts:283-296`). The value lost to slippage or a manipulated pool is bounded only per call.
- Lending `borrow` is capped per call; cumulative debt is not.
- `approve` caps each allowance, not cumulative pulls.
- Native Push rules differ:
  - The contract supports `maxValueTotal`, `maxCalls` and a cumulative `AmountRule` (URP:672-735).
  - The public SDK shape hard-codes unlimited totals and calls (`sdk/agentic/public-rule.ts:255-263`) and rejects `amount` / `maxValueTotal` / `maxCalls` (`:128-144, 171-183`).

  So stronger native totals need SDK and spec work only, not contract work.

### F8 — Medium: test gaps (no false passes found)
**Type:** test quality. **Blocks:** none, but some claims should be narrowed.

1. `expectStoredPreset` (`__e2e__/shared/agw-preset-acceptance.ts:55-108`) does not assert `expectedCEA`, and the local suite mocks the CEA (`__agw-local__/preset-acceptance.spec.ts:27-30`). The live suite does assert it (`presets-acceptance.spec.ts:252-265`). So for the local suite, "destination identity is compared" is not true.
2. The SPL readback uses `toMatchObject` with `arrayContaining`, which checks the assets and only the account-1 pin (`svm-agent-spl.spec.ts:121-137`). The counter, recipient-ATA, CEA and token-program pins, and the data ceiling, are not compared. There is no wrong-recipient rejection case. The data ceiling and the account-1 pin are proven by the decoded rejections.
3. The live preset suite funds the fresh agent 0.5 PC in `setupAgw()` (`_fixture.ts`) before the pool, protocol and owner-PRC20 prerequisite checks (`presets-acceptance.spec.ts:216-247`). Only the route-readiness check is truly before funding.
4. `live-presets-blocked.log` cites spec lines 200 and 331. The current file throws at line 211 with case 1 at line 356, and it was edited at 15:43:00Z, after the 15:31Z log. The blocked outcome is determined by unchanged `src` readiness code, but the current spec revision has never run.
5. `svm-send-defaults.spec.ts` covers only the owner funds-only native-SOL path, and mocks `quoteOutbound`, so the finalize floor is not exercised. The agent door's omitted gas is covered only by the live run.
6. `check-agw-gas-quotes.js` cannot observe anything but the floor (F3). It omits gasFee, gasPrice, USD band, pool cost and the SPL first-use ATA case.
7. The live preset operation builders were reviewed and are consistent:
   - token and market order (Venus vUSDT first, Base LINK supply first);
   - `approve` before the call;
   - recipient pinned to the CEA;
   - spend metered at 1× then 2×.

   They test one swap direction only, and use `amountOutMinimum: 1`.

What is right: the EVM gas test proves the CEA had no code before first use, exact native credit, `UniversalTxExecuted` from the CEA with `originCaller` = wallet, and spend. I re-verified all eight destination receipts myself (`data/dest-receipts.json`). The SPL test proves delivery with exact amounts; I re-verified the Solana transactions, the CEA derivation, the ATA owner, the mint and the token program.

### F9 — Medium: Solana destination cost is misreported
**Type:** evidence correction.

- The README says each Solana send "charged a 5,000-lamport transaction fee". That is the relayer's signature fee only.
- The gateway reimbursed the relayer **2,184,320** lamports (first use: 5,000 + 690,880 `ExecutedSubTx` rent + 1,488,440 CEA-ATA rent) and **695,880** lamports (subsequent), out of `gas_fee` budgets of 2,285,000 and 960,000 (`data/sol-probe.json`).
- Devnet rent is now 690,880 lamports for 8 bytes and 1,488,440 for 165 bytes. The SDK's fallback constants (946,560 and 2,039,280; `svm-rent.ts:37-40`) are higher. That is safe, because they over-budget.

### F10 — Medium: Solana transfer-only rules are impossible under the current contracts
**Type:** contract constraint. **Blocks:** extension only.

`SvmRulebook.sol:30-41` forbids the System, SPL Token, Token-2022, Stake, BPF-loader and lookup-table programs, as well as the gateway and the CEA. Agents also cannot send funds without an instruction (`SvmPayloadEmpty`, :525). So SOL or SPL can reach a third party only through an allow-listed program's CPI, as `test_counter.receive_spl` does.

### F11 — Medium: public Solana authoring is narrower than the contract
**Type:** ambiguity / capability gap. **Blocks:** extension only.

| | Contract (`SvmRulebook`) | Public API |
|---|---|---|
| Discriminators | 1–8 bytes, or dataless (:176) | 8 bytes only: Anchor-derived or raw 16-hex (`public-rule.ts:347-368`) |
| Data pins | EQ / GTE / LTE / RATIO, with `fromEnd` | equals or max on fixed-width named args |
| Send-time accounts | — | Resolved from a registered Anchor-style IDL: fixed address, const-seed PDA, or `cea_authority` (`sdk/orchestrator/svm-idl/resolve.ts:55-128`) |

Unsupported in the public API: short or non-Anchor discriminators, dataless instructions, dynamic args (vec / string / option), optional accounts and nested account groups. The contract cannot parse dynamic args either; it offers only `fromEnd` scalars.

Related: a Solana rule with `maxGasPerCall = 0` is accepted by the SDK (`codec/svm-terms.ts:175`), while EVM rejects it (`codec/universal.ts:53-54`). Every agent send would then fail.

### F12 — Medium: Solana SPL PRC20s do not identify their mint on-chain
**Type:** ambiguity.

- `SOURCE_TOKEN_ADDRESS` returns a zero word for USDT.sol, USDC.sol, DAI.sol and pSOL (`data/push-probe.json`).
- `readSvmSourceToken` then falls back to the SDK's own registry (`sdk/agentic/contracts/prc20-metadata.ts:51-72`), so the mint is not verified on-chain.
- `uregistry` has the authoritative mapping. For USDT it is `EiXDnrAg…` → `0x4f1A…`, which matches the SDK.

Recommendation: verify against `uregistry`, or snapshot it in tests.

### F13 — Low: Base Sepolia WETH registry entry is wrong (existing bug)
**Type:** data bug.

`sdk/constants/tokens.ts:234-239` lists Base Sepolia WETH at `0xfff9976782d46cc05630d1f6ebab18b2324d6b14`, which is the Ethereum Sepolia address. That address has no code on Base Sepolia (`data/dest-probe.json`). AGW is currently unaffected, because the symbol switch refuses non-Sepolia WETH.

### F14 — Low: `protocolFee` is counted twice in attached value (latent)
**Type:** latent bug.

`nativeValueForGas` already includes `protocolFee` (`gas-calculator.ts:253`). `outbound.ts:235-236` and `svm-public.ts:169, 188-190` add it again to `value` and also pass it as `maxPCForGas`. With a non-zero fee, a send would over-attach and use more of the `maxGasPerCall` ceiling. `protocolFee` is 0 on every PRC20 checked.

### F15 — Low: Solana finalize margin and gas-limit inputs
**Type:** robustness and documentation.

- The finalize floor's only margin is the 100,000-lamport buffer, about 4.6% of the first-use budget. A drop in Donut's Solana gasPrice between quote and execution larger than that would underfund the send (`InsufficientGasBudget` on Solana). The gasPrice was a constant 1000 across the sample.
- A re-quote that is still insufficient only logs a warning (`svm-rent.ts:253-258`).
- An explicit `gasLimit` below the chain base (960 on Solana devnet, 500,000 on the EVM testnets) reverts at quote time on deployed core (`data/sdk-quotes.json`; 500,001 is accepted). Document that inputs must be 0 or at least the base.

### F16 — Info: baseline drift and other notes

- The local contract checkout is on stale `main` (`9ddd954`, 4 September, a different design). The deployed source is `deploy-agw` / `ffd567d`.
- Core `main` (`b2f22241`) returns 5 values from `getOutboundTxGasAndFees`; deployed core returns 6. The pinned SVM gateway source declares `DJoF…`; the SDK and the live transactions use `CFVS…`. Live behaviour was therefore verified empirically.
- The EigenLayer `depositIntoStrategy` strategy argument is unpinned. Deposits credit the CEA, and only whitelisted strategies are accepted.

## Specific answers

**A.**
- Omissions in the SDK registry: the three Circle USDC routes (F1).
- Routes that need provisioning: the table in F2.
- The external allow-list does not establish route availability (F6).
- Metadata handling: string and address-word metadata are handled. Solana mints are not identified on-chain (F12).
- The compatibility scope was too narrow (F6). RPC errors were not turned into "unsupported", except the candidate-read gap noted in F6.
- The native-wrap alternative is viable but needs product approval (F2).

**B.**
- At least one call is required, by both contracts and both doors.
- EVM ERC20 transfer rules are fully SDK-side, and already expressible with the public API.
- Native coins are not expressible as value-only agent calls (URP:784; `outbound.ts:210-221`).
- Solana is impossible (F10).
- On Push, value-only `VALUE_SELECTOR` actions go to up to 8 fixed recipients.
- See the decision matrix for the comparison of options.

**C.** `[]` (or omitted assets, in general rules) means one zero-cap gas-PRC20 entry on both EVM and Solana (`prepare.ts:89-101`; `management/svm-public.ts:45-47`), so nothing can be exported from Push. Calls the rule allows can still use balances the CEA already holds.

**D.** See F7.

**E.** See F3, F4, F5, F9 and F15. The decision matrix gives the recommendation.

**F.** The SPL test proves what it claims (F8). Candidate extra program: SPL Memo v2 `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, verified executable on devnet (`data/sol-probe.json`) and not forbidden. It needs:

- a raw 8-byte memo-prefix discriminator;
- a CEA account pin;
- a synthetic IDL registered through `PushChain.utils.svm.registerIdl`.

It has not been verified through the gateway and URP. It moves no tokens.

**G.**
- Deployed: `MAX_NATIVE_ACTIONS = 8` distinct (target, selector) pairs. Pins do not count; duplicates are refused with `DuplicateAction` (AGW.sol:86, 738, 765).
- Universal EVM rules allow 1–32 entries (URP:84, 347-350); Solana allows 1–32 programs.
- The SDK enforces 8 for native rules (`public-rule.ts:211-215`).

This is a spec clarification, unless product needs more than 8 native functions.

## Addendum, 21 October 2026: SDK changes made after the review

All changes are local, uncommitted, on v4. Results are in `data/post-change-*.json`.

| Finding | Status | Change |
|---|---|---|
| F1 | SDK side done; core confirmation pending | `agentic/token-routes.ts` resolves the three node-registered Circle USDC routes by exact address, for AGW only. DEXES Sepolia and LENDING Arbitrum Sepolia are route-ready |
| F5(a) | Fixed | BNB testnet gas is valued at the Push pool rate in `gas-usd-sizer.ts`, because no BNB/USD feed exists (the BSC gateway feed is ETH/USD). Route 2 and Route 3 already floored at the pool cost |
| F5(b)(c) | Fixed for AGW | `agwGasBudget` keeps the over-$10 share and never attaches less than the pool cost plus 20% |
| F6 | Fixed | The compatibility script includes exact routes, separates read errors from missing routes, and searches each DEX preset's own pair. The new `check-agw-route-registry.js` compares the SDK with uregistry: 20 match, 0 mismatch |
| F8(1) | Fixed | The local suite asserts the stored `expectedCEA` |
| F8(2) | Fixed | The SPL readback compares every pin, the data ceiling and the program exactly; the wrong-recipient refusal is added. Both were checked read-only against the Oct 20 rule (`data/spl-*.json`) |
| F8(3) | Fixed | The live preset suite funds the agent only after its prerequisites pass. The new opt-in group `agw-presets-routed` covers the two ready presets |
| F8(5) | Fixed | Agent-door omitted-gas unit test added |
| F8(6) | Fixed | The quote script records signer origin, gas fee, pool cost and the SPL first-use case |
| F11 (Solana zero gas) | Fixed | `preparePublicSvmRule` rejects `maxGasPerCall = 0` |
| F13 | Fixed | Base Sepolia WETH address corrected |
| F14 | Fixed (latent) | AGW's `nativeValueForGas` excludes protocolFee |
| F15 | Fixed | An explicit gasLimit below the chain base is refused before quoting with `INVALID_RULE` and `details.minimum`. A Solana budget still short after one re-quote is refused before signing (`INCONSISTENT_READ`) |

New finding from the drift check: the SDK cannot resolve DAI.sol. Its PRC20 is registered, but `getPRC20Address` has no `DAI` case. Not preset-relevant; left unchanged.

Validation: 2,276 units passed and 12 skipped; 9/9 local v6 preset cases pass; lib, spec, agw-local and marketplace-local typechecks and the core build pass; ESLint reports 0 errors.

### Live validation of the changes, 21 October (02:23–02:40Z)

These runs used the post-change working tree.

- **`agw-svm-agent-spl`: 1/1 passed.** This included the new exact-pin readback, the data ceiling and program checks, and the wrong-recipient refusal. Both omitted-gas SPL sends were delivered (Push blocks 24,471,877 and 24,471,906).
- **`agw-gas`: 4/4 passed.** Sepolia, Base Sepolia, Arbitrum Sepolia and BNB testnet each had a first and a subsequent send: eight destination deliveries, checked against the CEA.
- **Gas.** Every send attached 10 PC. The pool cost recorded for each was 0.0002–2.07 PC.
- **Not exercised.** BNB's Donut gas price was 0.055 gwei during the run, so the high-gas BNB case, where the pool floor exceeds the sized budget, was not hit live. It is covered by unit tests only.

Evidence: `data/live-2026-10-21-evidence.json` and `data/live-2026-10-21-results.log`. Still not run: `agw-presets-routed`. It needs the owner to hold WETH.eth and Circle USDC (Arbitrum) PRC20s, and core still has to confirm the routes.

### Routed presets live, 21 October (02:48–03:03Z)

The owner bought 0.199606 USDC.eth.old and 0.197913 USDC.arb.old on Donut's Uniswap pools for 2 PC each (txs `0x9de1…6dbc` and `0xab55…7138`).

- **LENDING Arbitrum Sepolia: passed.** Two agent sends exported Circle USDC through the `.old` route and supplied it to Aave. Destination gas used: 536,341 and 292,561. This is the first live proof that a node-registered Circle USDC route settles outbound.
- **DEXES Sepolia: the first run failed on the subsequent send.**
  - The first send passed: 1,502,039 gas at the 2,000,000 first-use limit.
  - The subsequent send ran at the 500,000 network base and reverted on Sepolia with CEA `ExecutionFailed` (`0xacfdb444`, tx `0xe480…e336`).
  - The call trace (`data/sepolia-dex-subsequent-oog-trace.json`) shows `pool.swap` out of gas. The vault's Circle USDC transfer and the approve took most of the budget, and nested calls forward only part of the remaining gas.
- **SDK fix.** Agent EVM sends without an explicit gasLimit now use 1,000,000 when they export a non-native token or make more than one call; first use stays at 2,000,000. The swap direction followed the owner's holdings: the test now starts from the held default asset, here USDC→WETH.
- **DEXES Sepolia re-run: passed.** Destination gas used: 1,502,063 and 362,079.

Both route-ready presets have now passed unchanged-preset live acceptance (`data/live-2026-10-21-routed-presets.json`). Full unit suite after the fix: 2,278 passed, 12 skipped.
