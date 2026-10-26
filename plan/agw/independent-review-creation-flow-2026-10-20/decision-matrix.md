# Decision matrix: AGW creation flow, 20 October 2026

"Today" means what works with the deployed v6 contracts and the current public SDK API, with no code changes. Findings (F#) refer to [review.md](review.md).

## A. Preset routes and default tokens

| Option | Supported today | Requires SDK work | Requires contract / infra work |
|---|---|---|---|
| A1. Keep the exact protocol tokens and add **node-registered** routes the SDK is missing (Circle USDC on Sepolia, Base and Arbitrum → `0x387b…`, `0x84B6…`, `0xa261…`) | The routes are on-chain, enabled and Vault-backed | An address-keyed AGW route table (the symbol registry cannot hold two USDCs on one chain), then readiness, preparation and a funded E2E | Core/node confirms the `.old` routes are supported for outbound |
| A2. Keep the exact tokens; provision missing routes (LINK ×2, EigenLayer WETH, Base/Arbitrum WETH, WBNB, Venus USDT/USDC, Moonwell ×2) | No | Register them once supplied | Per token: a uregistry `TokenConfig` with PRC20 `native_representation`, PRC20 deploy/init, UniversalCore gas config, inbound gateway threshold, and Vault liquidity from inbound deposits |
| A3. Native export plus destination wrap for the WETH/WBNB legs and EigenLayer WETH | Authorable today as a *custom* rule (`maxValue` on `deposit()`) | `presets.get` refuses native markers in DEX presets and builds swap pairs only from export assets. Needs catalog/generation changes and a check of each router's WETH9 | None (native routes are live) |
| A4. Replace protocol tokens with same-symbol routed mocks | Possible, but unusable | — | No Aave/Venus/Moonwell market or protocol pools exist for the mocks |
| A5. "Partial" presets: export only the routed tokens, and still allow swaps or supplies of a destination-held token | No (swap pins are built from export assets) | Separate "operation tokens" from "export assets" in preset generation | None |

**Recommendation:** do A1 now, gated on the core confirmation. This turns DEXES Sepolia and LENDING Arbitrum Sepolia ready, and covers the USDC leg of DEXES Base/Arbitrum.

- Ask product to choose between A3 and A2 for the WETH/WBNB legs and EigenLayer.
- Ask core for A2 on the LINK, Moonwell and Venus tokens.
- Reject A4.
- A5 is optional and needs product sign-off, because it changes what "selected token" means.

**Change from our recommendation:** "keep actual protocol tokens and obtain PRC20 routes" remains right. However, three of those routes do not need to be "obtained": they already exist in the node registry. The ask to core shrinks from 13 tokens to 10, plus one confirmation.

## B. Apps optional / transfer-only

What the contracts require:

- Universal rules: at least one allowed call, and at least one destination call per request.
- `req.recipient` must be empty, so funds always land in the wallet's CEA.
- Value-only inner calls are refused.
- Solana's System and Token programs are forbidden targets.

| Option | Today | SDK work | Contract work | What it permits |
|---|---|---|---|---|
| B1. Named recipient allow-list (EVM ERC20) | **Yes, as an explicit rule**: `transfer(address,uint256)` with `arg 0 = R` and `arg 1 ≤ X` | An optional UI/SDK helper that synthesizes the entries (≤32 entries / ≤32 pins; 2 pins each) | None | Exported *and* CEA-held units of each listed token go only to R. Each transfer is ≤ X; there are ≤10 per request and unlimited requests until expiry. Exports are also capped by `maxPerCall`/`maxTotal` |
| B2. Any recipient | Yes (no pin on `to`) | Helper | None | Full custody of CEA-held balances of those tokens. Exports are still capped. **Not recommended** without explicit security sign-off |
| B3. Wallet-owned destination only | `to = CEA` is a self-transfer and does nothing. "Owner's own address on that chain" is B1 with R = owner | The SDK can prefill R when the owner's origin chain equals the destination | None | Same as B1 |
| B4. Keep requiring explicit app functions | Yes (current behavior; `ALLOWED_FUNCTION_REQUIRED`) | Better UI copy only | None | — |
| Native coins on EVM (ETH/BNB) | No agent value-only call. Possible as wrap-then-transfer WETH (two entries) | Helper; the label must say "WETH" | A value-transfer primitive would be contract work | The recipient receives WETH, not ETH |
| Solana SOL/SPL | **No** | — | Allow a constrained transfer path, or deploy a reviewed transfer-router program | — |
| Push native (PC / Push tokens) | Value-only actions to ≤8 fixed recipients; ERC20 `transfer` per token with one pinned recipient (duplicates are refused) | Exposing native `maxValueTotal`, `maxCalls` and `AmountRule` needs a spec/SDK change | None (the contract supports totals) | Per-call caps today; totals are possible with SDK work |

**Recommendation:** ship B4 now. After product agrees the semantics, build B1 as the "apps optional" option for EVM ERC20 only, with explicit recipients and **per-transfer** caps. Example scope:

```ts
{
  agent, chainNamespace: 'eip155:11155111', validUntil, maxGasPerCall: parseEther('20'),
  assets: [{ token: WETH, maxPerCall: parseEther('0.001'), maxTotal: parseEther('0.01') }],
  allowedCalls: [{ target: WETH, selector: 'transfer(address,uint256)',
    pins: [{ arg: 0, expected: RECIPIENT }, { arg: 1, max: parseEther('0.001') }] }],
}
```

This allows at most 0.001 WETH exported per send and 0.01 WETH exported over the rule's lifetime. It also allows WETH already in the Sepolia CEA to go to `RECIPIENT`, at most 0.001 per transfer, an unlimited number of times until expiry.

Exclude native coins and Solana from the first version.

**Change from our recommendation:** the direction is correct. Add three things:
- this needs no contract change for EVM ERC20;
- Solana is contract work, not just "representability limits";
- B3 is meaningless unless it means the owner's own address.

## C. No tokens selected / all tokens

Facts:

| Topic | Fact |
|---|---|
| General rules | `assets` omitted or `[]` becomes `[{gas PRC20, 0, 0}]` on EVM (`prepare.ts:89-101`) and on Solana (`management/svm-public.ts:45-47`). Nothing can be exported; allowed calls can still use balances the CEA already holds |
| Presets | Omitted means curated defaults with reviewed caps. `[]` means no assets, and readiness reports `ASSETS_REQUIRED` and `TOKEN_PAIR_REQUIRED` |
| Contract | 1..8 explicit assets (`Types.sol:199`; `RulesLib.sol:39`). No wildcard: `address(0)` and `0xEeee…` fail `InvalidAsset`. Future tokens are never implicitly authorized |

| Option | Today | SDK work | Contract work |
|---|---|---|---|
| C1. `[]` = no export authority (current) | Yes | Wording | None |
| C2. "All supported tokens (N)", expanded to an explicit list ≤8 per chain with per-token caps. Routed counts today: Sepolia 7, Base 5, Arbitrum 5, BNB 4, Solana 4 | Yes for assets and transfer rules. Not for DEX presets (N(N−1)×2 swap entries exceed 32 when N≥5) | Expansion from uregistry or the registry; read decimals on-chain; a reviewed per-token cap table; regenerate when the registry changes | None |
| C3. True wildcard (any current or future PRC20, aggregate cap) | No | — | New asset model, and possibly an oracle for value-based caps |

**Recommendation:** keep C1. Offer C2 only with caps the user enters or that come from a reviewed table, never implicit maximums, and show the expanded list before signing. C3 needs product and contract design.

**Change from our recommendation:** none; confirmed. Add that "empty" restricts exports only, not activity with balances the destination already holds.

## D. Spending-limit scope

Ship now, with these labels:

- **"Max per send from Push"** → `assets[i].maxPerCall`
- **"Total sendable from Push with this rule"** → `maxTotal`. Help text: "Counts tokens sent from Push, including sends that later fail on {chain}. Funds already in the wallet's {chain} account are not counted."
- **"Max per action"** → pin `max` / `maxValue`. Help text: "Each action is limited separately. The agent can repeat actions until the rule expires."
- **"Gas budget per transaction (PC)"** → `maxGasPerCall`. Help text: "The most PC attached for gas on one transaction. Unused gas is refunded. There is no total gas limit; the wallet's PC balance is the only limit."
- For DEX presets: "Limits amounts, not price. Swaps can execute at a poor price."
- For lending: "Borrowing is limited per action, not total debt."

| Want | Requires |
|---|---|
| Sum of calls within one request | Contract |
| Cumulative destination spend per token | Contract (destination accounting) |
| Refund of `maxTotal` after a failed send | Push-core executor calling `creditRevert` |
| Cumulative native (Push) totals | **SDK/spec only** (the contract supports `maxValueTotal`, `maxCalls`, `AmountRule`) |
| Slippage bounds | SDK catalog work (pin `amountOutMinimum` relative to the amount where the protocol allows it) or product acceptance of the risk |

**Change from our recommendation:** confirmed, with two corrections. `maxTotal` also counts sends that fail on the destination, and native rules *can* enforce totals today at contract level.

## E. Gas: what each quantity means, and the guidance

| Quantity | Meaning | Observed |
|---|---|---|
| 1. `maxGasPerCall` | Owner ceiling on the PC `value` attached per request (URP:593) | Preset 20 PC |
| 2. `gasLimit` | Multiplier for the chain's gas price. EVM: gas units. Solana: units × 1000 lamports. 0 means the core base (500,000 EVM; 960 Solana). Below the base reverts | EVM first use 2,000,000 (SDK); subsequent 500,000. Solana 2,285 / 960 |
| 3. Attached PC | The SDK budget: max($1, gas USD), capped at $10, plus protocolFee, converted at the agent-origin rate | 10 PC (Push-native at fixed $0.10) |
| 4. Push signer gas | The agent EOA's own Push transaction fee | 0.00042–0.00053 PC |
| 5. Destination fee | EVM gas used × price; Solana relayer reimbursement | EVM 123k–1.27M gas. Solana 2,184,320 / 695,880 lamports |
| 6. Net consumed / refunded | `SwapAndBurnGas.pcIn` consumed; the remainder refunded in the same transaction (balances confirmed) | 0.0008–2.37 PC consumed; 7.6–10 PC refunded |

| Option | Today | SDK work | Contract work |
|---|---|---|---|
| E1. Keep 20 PC for presets | Works for Sepolia, Base, Arbitrum and Solana at current prices. **Fails BNB first use** when Donut's BNB gas price is 1.1 gwei | Per-chain caveat | None |
| E2. Per-chain preset ceilings (for example BNB 60 PC) | Yes | Constants | None |
| E3. Quote-driven UI prefill (`max(20 PC, 2 × current first-use attached quote)` for the agent's origin) | No public quote helper | A public read-only `quoteGasBudget(chain, {agentOrigin, firstUse})` (spec addition) | None |
| E4. Size the gas budget from the Donut pool, not USD; fix BNB pricing; stop dropping the over-$10 overflow (F5) | — | Yes | None |
| E5. A cumulative gas cap | — | — | Contract |

**Recommendation:**

- Keep the Solana fix.
- Keep 20 PC only as a ceiling, never as an expected fee, and add a BNB-testnet caveat or move to E2 now.
- Do E4 before mainnet.
- The custom-rule prefill of 0.1 PC can never work: the SDK's minimum attached amount is 4.3–11 PC depending on agent origin. **Do not change the SDK's custom-rule default** (zero is rejected for EVM, which is intended). Have the UI prefill with the preset per-chain values, or with E3 once it exists.
- Also reject zero `maxGasPerCall` on Solana (F11).

**Change from our recommendation:** "20 PC covers the checked quote profiles" must become "covered the runs at these blocks; BNB first use exceeds it at Donut's current BNB gas price". The 10 PC figure must be described as the SDK's floor.

## F. Solana program coverage

| Option | Today | SDK work | Contract / infra |
|---|---|---|---|
| F1. Keep `test_counter.receive_spl` | Verified (SPL credit, ATA pin, data ceiling) | Add a wrong-recipient case and full-pin readback | None |
| F2. SPL Memo v2 `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (executable on devnet, not forbidden) | Rule: raw 8-byte prefix plus CEA account pin. Send: synthetic IDL through `utils.svm.registerIdl` | Local URP acceptance and a funded run | Gateway owners confirm a CEA-signed non-Anchor CPI works |
| F3. A third-party devnet protocol | Mostly no (dynamic args, optional accounts and non-Anchor are unsupported in the public API) | Large | — |
| F4. A team-deployed reviewed program with fixed-width args | — | Register the IDL | Program ID, IDL, deployment |

**Recommendation:** F1 plus F2 for UI E2E. Memo proves a second, non-test-counter program executes under the CEA's signature. It does not test token movement. If token movement through a second program is required, request F4.

## G. Native function count

| Option | Today | Work |
|---|---|---|
| G1. Spec says 1..32 for EVM/Solana and 1..8 distinct (target, function) for Push | SDK enforces 8 | Spec/doc only |
| G2. Raise the native ceiling | No | Contract (`MAX_NATIVE_ACTIONS`) and redeploy |

**Recommendation:** G1, unless product shows a real need for more than 8 Push functions in one rule. Users can also create several rules for the same agent. This is not a delivery blocker.
