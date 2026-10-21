# Agentic wallets on Push Chain

This branch implements the SDK-only October 12 feedback against the deployed Donut v6 contracts. The runtime targets v6 only; existing v5 wallets are not silently adapted.

## Connect

Use an application-managed key; examples do not load secrets or execute automatically.

```ts
import {
  PushChain,
  AgenticError,
  AgenticRevertError,
  type Rule,
} from '@pushchain/core';
import {
  createWalletClient,
  http,
  parseEther,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type WalletTransaction = Awaited<ReturnType<PushChain['universal']['sendTransaction']>>;

const NETWORK = PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT;
const PUSH = PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT;
const SEPOLIA = PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA;
const ETH = PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH;

async function connectPush(key: Hex, wallet?: Address): Promise<PushChain> {
  const walletClient = createWalletClient({
    account: privateKeyToAccount(key),
    transport: http('https://evm.donut.rpc.push.org/'),
  });
  const signer = await PushChain.utils.signer.toUniversalFromKeypair(
    walletClient,
    { chain: PUSH, library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM },
  );
  return PushChain.initialize(signer, {
    network: NETWORK,
    ...(wallet ? { agenticWallet: wallet } : {}),
  });
}
```

## Create and manage rules

Every chain uses `Rule.allowedCalls`. Omit `chainNamespace` for Push. The agent is always its Push address: a native EOA or an external signer's UEA. The owner cannot be its own agent.

```ts
async function createNative(owner: PushChain, agent: Address, token: Address, recipient: Address) {
  const rule: Rule = {
    agent,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    allowedCalls: [{
      target: token,
      selector: 'transfer(address,uint256)',
      pins: [{ arg: 0, expected: recipient }, { arg: 1, max: 10n }],
    }],
  };
  return owner.agentic.create('operations', { rules: [rule] });
}

async function manage(owner: PushChain, address: Address, id: Hex) {
  const wallet = owner.agentic.wallet(address);
  const record = await wallet.rules.get(id);
  // Reads preserve the constraints needed by update.
  const changed = await wallet.rules.update({
    rules: [{ rulesId: id, rule: { ...record.rule, validUntil: record.validUntil + 3600 } }],
  });
  await wallet.setLabel('renamed'); // direct cosmetic write; no checkpoint
  await wallet.rules.delete([changed.rules[0].rulesId]);
  // Delete all requires an explicit target:
  // await wallet.rules.delete({ all: true });
  return wallet.info();
}
```

`derive({ index? })` returns the predicted address, index and deployment state. `list()` enumerates the connected owner's wallets. A wallet handle provides `info`, `owner`, `checkpoints`, `setLabel`, and `rules.list/get/add/update/delete`. Deleted rules are not returned in v1. Rule IDs may change during update.

`create` and `rules.add` reject a duplicate agent/chain pair with `DUPLICATE_RULE`. Put several permitted calls in the same rule. Existing overlapping grants can still cause `AMBIGUOUS_RULE` when sending; the owner must resolve the overlap. The contract validates every actual agent call.

On deployed v6, native rules allow at most **eight** calls, eight equality/maximum pins per call. Public native lifetime budgets, `maxCalls`, `amount`, single-call shorthand and `actions[]` are retired. Native value and call counters accumulate for reporting and atomic updates. A v6 MAX pin only bounds an individual call and does not increment amountSpent; that counter belongs to the separate internal amount meter.

## Pins and zero defaults

An equality pin fixes an argument; a maximum pin bounds it. For EVM signatures, `arg` is a zero-based static argument position. With a raw four-byte selector, it is a 32-byte ABI head-word position. Reads return a raw selector and these word positions. For full signatures, a path such as `arg: [0, 3]` selects a field within a static tuple or fixed array. Dynamic layouts fail explicitly. Reads retain exact word positions rather than guessing missing ABI metadata.

`PushChain.CONSTANTS.AGENTIC.WALLET` resolves to the AGW on Push, its CEA on an EVM destination, or its CEA/selected token ATA on Solana. Deployment addresses and encoding helpers are internal.

For directly authored rules, omitted `maxValue`, `assets[].maxTotal`, and `maxGasPerCall` default to **zero**. Presets supply explicit policy values as described below. Asset totals meter tokens sent from Push; they do not meter trading or lending using capital already in the destination CEA. Specify positive caps for sends that need value, tokens or destination gas. Native value is limited per call; there is no public native lifetime-total cap.

## EVM destinations

```ts
function evmRule(agent: Address, target: Address): Rule {
  return {
    agent,
    chainNamespace: SEPOLIA,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    assets: [{ token: ETH, maxPerCall: 1_000n, maxTotal: 10_000n }],
    maxGasPerCall: parseEther('20'),
    allowedCalls: [{
      target,
      selector: 'deposit(address,uint256)',
      pins: [{ arg: 0, expected: PushChain.CONSTANTS.AGENTIC.WALLET }],
    }],
  };
}
```

The deployed v6 policy supports up to eight EQ/MAX pins per EVM destination call and 32 across the rule. Multiple entries for the same target/function are alternatives; every constraint in one entry must pass. The SDK rejects a bare alternative beside a pinned one because it would bypass the pins.

When the caller omits destination `gasLimit`, a fresh EVM CEA gets a 2,000,000 gas default to cover first-use deployment. An existing CEA uses the normal quote default. An explicit caller value is preserved. The rule's gas/value caps still apply.

## Displaying errors in the UI

Use `userMessage` for `AgenticError` and `AgenticRevertError`. Keep `code`, `message`, `hint`, `details`, `decodedError` and `cause` for diagnostics or application-specific translations. Unknown exceptions should get a neutral fallback instead of raw RPC/ABI text.

```ts
function walletErrorText(error: unknown): string {
  if (error instanceof AgenticError || error instanceof AgenticRevertError) {
    return error.userMessage;
  }
  return 'The request could not be completed. Check wallet activity before trying again.';
}
```

Creation and rule-preparation errors include a zero-based `details.ruleIndex` when a rule can be identified, with `assetIndex`, `callIndex` and `field` where available. The UI message uses a one-based rule number. Use these details to show the error on the relevant rule instead of only in a footer. Read/receipt failures preserve their causes and transaction hashes; do not automatically retry a submitted transaction whose outcome is unknown.

`TOKEN_ROUTE_UNAVAILABLE` means an asset cannot be resolved for transfers from Push. Choose a token with a supported route on this network, or wait for a verified PRC20 route for that exact token address. Changing a symbol does not create a route. Display `error.userMessage` and check preset readiness before creation.

A DEX condition-limit failure reports `details.reason = 'RULE_CONSTRAINT_LIMIT'`, `actual`, `limit` and `callCount`. Conditions here are generated input checks (for example token, recipient and amount checks), rather than the number of visible function names. A stock two-token, single-router preset contains six allowed-call entries and twenty conditions. Appending the same call list again makes forty conditions. The SDK rejects this; it does not deduplicate, remove conditions or split authority automatically. Preserve per-chain rules and regenerate after edits rather than appending generated calls.

For the review screen, show the actual network (including testnet name), selected token addresses and limits. Label maxGasPerCall as a maximum PC gas budget, not a guaranteed fee or execution gas-unit count. maxTotal meters cumulative Push outbounds, including outbounds whose destination execution later fails; it is not a lifetime destination-spend limit. Destination pins and maxValue limit each call separately.

## Solana destinations

Rules use fixed-width signatures and numeric positions, without an IDL:

```ts
function solanaRule(agent: Address, program: string): Rule {
  return {
    agent,
    chainNamespace: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    maxGasPerCall: parseEther('20'),
    allowedCalls: [{
      target: program,
      selector: 'receive_sol(u64)',
      pins: [
        { account: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET },
        { arg: 0, max: 1_000n },
      ],
    }],
  };
}
```

Use the program's actual account positions. `{ account, expected: WALLET, token: mint }` pins the wallet's ATA, using the verified mint/token-program context. Fixed integer, bool, pubkey and fixed-array layouts are supported; dynamic or undefined layouts fail before signing. Raw eight-byte discriminators support account pins; argument pins also need argument types. A nonzero per-call EVM `maxValue` has no Solana encoding.

Solana reads return `format: 'decoded'` with exact stored discriminators, offsets and constraints. This raw form is accepted by `rules.update`, preserving restrictions without inventing an IDL. Reusing it for another wallet/gateway is rejected. Send-data encoding still uses the existing `utils.helpers.encodeTxData` IDL helper; rule authoring and transaction encoding are separate operations.

## Spend, checkpoints and execution

`rules.get/list` return `spent`. Universal spend contains one entry per asset in stored order. A single native call has scalar value/amount/call counters. Several native calls return `spent.actions`, with each entry identified by target and selector; unrelated token amounts are not summed.

Native historical terms with lifetime limits or differing per-action expiries that the new public shape cannot preserve return an explicit capability error rather than silently dropping restrictions.

Connect with `PushChain.initialize(signer, { agenticWallet: address })` to send from the wallet. Signer identity determines the owner or agent door. Native agent arrays are atomic and every call passes policy checks. `from` cannot be overridden. Responses identify the wallet as `from` and signer as `origin`, including wait/replay results.

Updates assert existing spend, delete the old rule and grant its replacement atomically. Native updates assert each action separately: a rule with N native actions records N+4 checkpoints on current v5. Agent execution records no owner checkpoint. Direct `setLabel` records none.

## V6 deployment and creation

The runtime uses factory `0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc` and URP `0xBA32e7A1500cb34311a31127bcD40CA52C8CFd36`, from source `ffd567d`. URP still reports 3.1.0; verified deployment wiring and the v6 ABI identify the supported generation.

`create` uses one index-bound `createWalletWithSig` call from the owner's Push identity, with the contract's owner-caller empty-signature path. The wallet and up to eight initial rules are committed atomically. A concurrent slot change returns INDEX_RACE; a receipt-read failure retains the submitted hash for recovery. CREATE_PARTIAL is removed. No sequential creation fallback exists.

For outbound sends on either door, the wallet approves the gateway inside the transaction after policy authorization, executes the outbound, and clears remaining allowance. No separate approval or SDK allowance check is needed; GATEWAY_ALLOWANCE_INSUFFICIENT is removed. Approval/cleanup uses the contract's best-effort token calls. To stop an agent, delete its rules; clearing the gateway allowance does not disable an otherwise valid rule.

The wire encoder uses uint32 maximum for unlimited native calls and 255 for unspecified Solana account count. Neither uses the retired zero sentinel. The envelope remains version 1. Existing v5 wallets and addresses do not become v6 wallets.

`rules.delete` is the public name; on-chain `revokeRules` names/events remain unchanged. Revert errors retain decoded details and cause. Core transaction response fields used by other SDK routes are not globally removed.

## Preset discovery and templates (section 7)

`PushChain.utils.agentic` contains `presets.list/get`. The categories are `AGENTIC.PRESETS.CATEGORY.DEXES`, `LENDING`, `STAKING` and `PREDICTION`. The catalog includes mainnet and testnet templates. Discovery is network-independent: pass `chainNamespace` to select the intended chain. A mainnet template does not imply that the connected Push network supports execution to it:

- DEXES: Uniswap V3 on Ethereum, Base and Arbitrum (mainnet and their Sepolia testnets); PancakeSwap V3 on BNB mainnet and BSC testnet.
- LENDING: Aave on Ethereum, Base, Arbitrum and BNB mainnets, plus Sepolia/Base Sepolia/Arbitrum Sepolia; Moonwell on Base mainnet/testnet and Venus on BNB mainnet/testnet.
- STAKING: EigenLayer deposits on Ethereum mainnet and Sepolia; Lido stake and wrap/unwrap on Ethereum mainnet. Withdrawal requests with dynamic amounts, claims with position-derived amounts and EigenLayer withdrawals are excluded from these bounded presets. A selected native asset supplies the Lido `submit` value cap; omitted caps in explicitly supplied assets remain zero.
- PREDICTION: no entries yet. Hide categories with empty `chains` lists.

```ts
const { presets } = PushChain.utils.agentic.presets.list({ type: 'CATEGORY' });
const availablePresets = presets.filter(preset => preset.chains.length > 0);
const { rules: reviewTemplates } = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
);
// Every populated chain includes curated destination tokens in rule.assets.
// The SDK supplies spending limits, a PC budget and a seven-day expiry.
// Supply the agent to get complete Rule[] configuration.
const configuredPreset = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.LENDING,
  { chainNamespace: 'eip155:11155111', agent: '0x0000000000000000000000000000000000001234' },
);
// Destination assets must already be funded; no Push token exports are granted.
// Show configuredPreset.readiness.chains[0].selectedAssets in the review UI.
// Pass configuredPreset.rules directly to create after checking readiness.
// The helper below illustrates explicit overrides, rather than required UI input.

function filledPreset(agent: Address, tokenIn: Address, tokenOut: Address) {
  return PushChain.utils.agentic.presets.get(
    PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
    {
      chainNamespace: 'eip155:11155111',
      agent,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      maxGasPerCall: BigInt(10) ** BigInt(18),
      assets: [
        { token: tokenIn, maxPerCall: BigInt(100), maxTotal: BigInt(1000) },
        { token: tokenOut, maxPerCall: BigInt(100), maxTotal: BigInt(1000) },
      ],
    },
  );
}
```

The example caps are illustrative raw units; choose caps for the actual token decimals and gas requirements. `get` groups calls into one rule per chain. The result is `{ rules, readiness }`. With an agent supplied, `rules` is typed as `Rule[]`; otherwise it is `PresetRuleTemplate[]` with a generated expiry and missing agent. This type distinction alone does not establish readiness. When `assets` is omitted, each chain includes its curated destination tokens with the explicit spending limits below. An explicit `assets` array replaces the defaults for every returned chain; `[]` selects no tokens. Assets in an explicit list must name their chain unless a single chain filter is supplied. For an explicit asset list, omitted caps still default to zero. An omitted gas budget uses the preset policy; an explicit zero remains zero.

DEX discovery without `assets` includes a curated wrapped-native/stablecoin pair per chain, with both swap directions, exact-input/output functions and the token-specific input caps below. It does not require the UI to select tokens separately for every network. DEX discovery also works with an explicit empty asset list or with assets for only some chains. A chain with fewer than two explicitly supplied tokens returns full-signature review calls with wallet-recipient pins and an explicit zero input-amount maximum. A single supplied token is also pinned as the input. These calls cannot spend swap input tokens, even if asset budgets are filled later. Call `get` again after selecting both tokens to replace the review calls with the complete token-pinned rules; merely assigning `rule.assets` is insufficient.

With two ERC20 tokens, `get` expands ordered pairs into exact-input and exact-output calls with token, wallet-recipient and input-amount pins. Native markers and expansions exceeding the policy's 32-pin limit are rejected. Two tokens fit the shipped router template; three do not. Static tuple fields use paths such as `[0, 3]`.

Reviewed EVM spenders generate approvals pinned to that spender and bounded by the asset's per-call cap. Money-market approvals are restricted to the market's underlying token. Distinct spenders become separate pinned alternatives under v6. These destination approvals are ordinary ERC20 allowances; the wallet's automatic Push-side gateway approval is separate.

Templates describe permissions, not available liquidity or guaranteed execution. Verify destination token balances, supported reserves and source PRC20 routes before use: protocol testnet mock tokens may differ from MOVEABLE tokens. Presets do not sign, fetch app ABIs or modify wallets. Dynamic-path swaps, Solana protocol templates and unconfirmed deployments are excluded. Mainnet addresses were checked read-only; no mainnet transactions were executed. Other mainnet protocols in the proposal remain excluded until their deployment and permission constraints are verified. Local policy tests do not execute the destination protocols.

### Curated token defaults

These are small, protocol-specific subsets chosen to fit the 32-call/32-pin ceilings. The full reserve catalog is not automatically granted.

| Network | DEX pair | Lending tokens |
| --- | --- | --- |
| Ethereum | WETH / USDC | WETH, USDC |
| Base | WETH / USDC | USDC (Aave and Moonwell) |
| Arbitrum | WETH / native USDC | WETH, native USDC |
| BNB | WBNB / USDT | USDT (Aave and Venus) |
| Sepolia | DEX WETH / Circle USDC | Aave faucet LINK |
| Base Sepolia | WETH / Circle USDC | Aave faucet LINK, Moonwell mock USDbC and WETH |
| Arbitrum Sepolia | WETH / Circle USDC | Aave USDC |
| BSC testnet | WBNB / Venus USDT | Venus USDT, USDC |

Staking defaults are ETH/stETH/wstETH on Ethereum and the reviewed EigenLayer strategy's WETH on Sepolia. Testnet tokens with similar names can have different addresses; the returned addresses are authoritative. Defaults do not guarantee active reserves, liquidity or a Push PRC20 route. An unmodified preset cannot be granted when its assets lack matching PRC20 routes. The SDK preserves the selected tokens and caps and reports unavailable routes; it never removes assets to bypass this check. On Donut, every default asset of DEXES Sepolia and LENDING Arbitrum Sepolia currently has a registered route; the other testnet combinations do not. No runtime metadata/price fetch is added to get.

### Funding and release-network checks

Missing PRC20 registry entries produce `BRIDGE_ASSET_UNAVAILABLE`, and readiness is false while the returned rule retains all requested assets. No address or cap is silently replaced. `network` defaults to `TESTNET_DONUT` (`TESTNET` is accepted as an alias). Networks without a verified AGW deployment report `AGW_NETWORK_UNAVAILABLE`.

The public preset API has no `funding` option. Remove it from existing integrations; supplying it now produces `INVALID_RULE` rather than silently changing permissions. Internal prefunded CEA test fixtures explicitly clear bridge assets to isolate protocol constraints. Those fixtures do not demonstrate that an unsupported preset route is executable.

Existing mappings distinguish token identity by chain and address, including address casing for EVM. WETH/stETH Sepolia mappings and string/address-word source metadata are supported; mainnet or other-chain WETH is never aliased to them. Exact routes enabled in the Push node registry are also resolved by address: Circle testnet USDC on Sepolia, Base Sepolia and Arbitrum Sepolia maps to its own PRC20, separate from the routed mock USDC. Grant preparation still verifies each PRC20 source on chain. Protocol mock LINK, Moonwell/Venus tokens, Base/Arbitrum WETH, BNB testnet WBNB and the EigenLayer WETH remain unavailable for bridge funding until matching routes exist.

### Default permission policy

Only preset-generated assets receive these positive values. Direct rules, unknown tokens and explicit asset lists do not acquire guessed limits.

| Selected token | Per allowed call / Push outbound | Cumulative Push-outbound total |
| --- | --- | --- |
| USDC / USDT / mock USDbC | 10 tokens | 100 tokens |
| ETH / WETH / stETH / wstETH | 0.001 token | 0.01 token |
| WBNB | 0.01 token | 0.1 token |
| LINK | 1 token | 10 tokens |

Amounts use verified token decimals, keyed by chain and address, rather than symbol or live prices. For example, the USDT per-call limit is `10 * 10^18` on BNB mainnet and `10 * 10^6` on BSC testnet. These are fixed token quantities, not USD budgets.

The default expiry is seven days from each get call, computed once for all returned rules. The default gas ceiling is **20 PC per outbound**, including the value checked by URP; it is not a flat fee or a reservation. Actual sends obtain a fresh quote and remain subject to the rule cap. This ceiling has testnet protocol-flow coverage; mainnet templates do not have funded execution acceptance. Quotes may exceed the cap, requiring an explicit higher budget.

Explicit `validUntil` and `maxGasPerCall` override policy values; zero gas is preserved and reports incomplete readiness. An explicit `assets` array replaces all default tokens and limits, and omitted caps inside it remain zero. To change a preset cap while retaining its token set, take the returned assets, replace the caps and pass them back to get. Do not just edit the returned rule assets: the allowed-call pins and approvals also need regeneration.

`maxPerCall` applies to each allowed destination call; multiple calls may each consume that amount. `maxTotal` meters assets sent from Push, not aggregate destination activity. No destination lifetime limit is implied by these defaults. The general rules API continues to treat omitted caps as zero.

### Configure, inspect and regenerate

`readiness.ready` requires complete configuration plus offline SDK deployment, destination and bridge-registry support. Per-chain `configurationReady` reports input completeness separately. These checks do not verify live balances, reserve flags, liquidity or deployed bytecode. Grant preparation verifies wiring and token metadata on-chain before signing. Per-chain `selectedAssets` mirrors the selected rule assets; `bridgeAssets` reports registry presence, not verified live deployment. Mainnet templates remain discoverable but report `DESTINATION_UNAVAILABLE` on Donut. Check readiness before passing `rules` to create/update.

Tokens and permission defaults come directly from the SDK: omitted `assets` populates the curated subset and its caps in every returned `rule.assets`. Omitted gas and expiry use the policy below. The caller supplies the agent and can filter chains; no per-network token selection is required. Show the generated permissions for owner review and allow explicit overrides. Regenerate via get after an edit so operation pins/approvals match the new caps. Show explicitly zero-cap calls as disabled and present excluded calls clearly. A zero bridge limit can be intentional when assets are already at the destination; it is reported separately from operation readiness.

```ts
async function createConfiguredDex(
  client: PushChain, agent: Address, tokenIn: Address, tokenOut: Address,
) {
  const configured = filledPreset(agent, tokenIn, tokenOut);
  if (!configured.readiness.ready) {
    // Render these issues in the configuration screen; do not present it as ready.
    return { issues: configured.readiness.chains };
  }
  return client.agentic.create('My DEX agent', { rules: configured.rules });
}

async function replaceConfiguredDex(
  client: PushChain, wallet: Address, rulesId: Hex,
  agent: Address, tokenIn: Address, tokenOut: Address,
) {
  // Re-run get after editing tokens or limits. Changing rule.assets alone
  // does not regenerate allowedCalls, token pins or approvals.
  const configured = filledPreset(agent, tokenIn, tokenOut);
  if (!configured.readiness.ready) throw new Error('Complete the preset inputs');
  return client.agentic.wallet(wallet).rules.update({
    rules: [{ rulesId, rule: configured.rules[0] }],
  });
}
```

Save the preset category and editable inputs in the UI if subsequent edits should regenerate the preset. On-chain rules do not retain preset provenance or display metadata. A regenerated result is a replacement: do not append it to the old allowedCalls or keep the old token approvals. An update creates a new rulesId and resets counters, as documented above.

### Amount units and enforcement scope

| Preset operation | Generated restriction |
| --- | --- |
| DEX swap | Selected input/output token equality, wallet recipient, maximum input amount |
| Aave supply/withdraw/borrow/repay | Listed reserve token equality, wallet beneficiary, amount maximum |
| Moonwell/Venus mint/redeemUnderlying/borrow/repayBorrow | Maximum in the market's underlying-token units |
| EigenLayer deposit | Selected token equality and deposit amount maximum |
| Lido wrap/unwrap | stETH/wstETH input limits respectively; their units are not interchangeable |
| Lido submit | Native-value cap from the selected native asset's maxPerCall |

Aave reserve choices come from the reviewed official address book; fixed-token markets only enable for their actual underlying. Unknown assets do not receive an Aave approval or a positive Aave operation cap. A reserve listing is not a guarantee that its current supply cap, pause state or liquidity allows a transaction.

Market `redeem(uint256)` takes shares: it is excluded and `redeemUnderlying(uint256)` is provided instead. Lido's dynamic withdrawal arrays and position-based claims are also excluded because an underlying amount cap cannot safely be converted into those arguments by this pure helper. Custom rules remain possible through the normal rule API.

**A per-call limit applies to each allowed contract call, not the sum of several calls in one transaction. `maxTotal` is the cumulative Push-outbound amount, not lifetime turnover on the destination.** These statements also hold when a call's tokens are already in the CEA. Destination lifetime or batch-total accounting requires contract support. Bounded approvals do not supply such accounting.

The contract allows at most 32 pins across a universal rule. Expansion fails explicitly if the selected assets/apps exceed that ceiling; no restrictions are silently dropped. Two Aave reserves fit its four-operation template; three do not. Blank/incomplete inputs return zero-cap review calls, and regeneration replaces them with the selected token-specific calls.

## Validation

Run `node packages/core/scripts/check-agw-docs.js` to typecheck these examples. Unit tests use the normal core Jest configuration. `jest.agw-local.config.ts` uses pinned real AGW contracts and a stub gateway. Live E2Es are opt-in under `__e2e__/agw`; preflight verifies the deployment and funding limits. Local tests do not prove destination delivery, and historical live results do not count as validation of a changed public API.


### Live preset acceptance

The opt-in `agw-presets` E2E group exercises real Donut-to-Sepolia protocol calls. From `packages/core`, run `npm run e2e:preflight -- --group agw-presets --dry-run`, then `npm run e2e:ci -- --group agw-presets`. It uses the existing E2E credentials in memory. Each scenario funds a fresh wallet with at most 65 PC plus a fresh agent's configured gas allocation; the Uniswap case also uses 0.000002 pETH. No mainnet transaction is part of this group.

Uniswap uses destination WETH/Circle USDC; Aave uses its faucet LINK. Their generated preset calls and pins are retained, but bridge `assets` are set to `[]` because these destination tokens are not a supported SDK PRC20 pair. The owner funds the CEA separately. These tests establish swaps and lending against actual protocols, not the ability to bridge arbitrary assets. Missing liquidity, exhausted reserve caps or an unavailable faucet fail as prerequisites rather than silently skipping. Results are specific to Sepolia and do not certify the other catalog chains.


The additional opt-in group `agw-presets-expanded` covers EigenLayer deposits on Sepolia; Uniswap swaps on Base/Arbitrum Sepolia; PancakeSwap plus Venus on BNB testnet; and Aave plus Moonwell on Base Sepolia. Use the same preflight/run commands with `--group agw-presets-expanded`. Each scenario funds a fresh wallet with at most 100 PC and checks any required destination-native PRC20 before transfer. Native-wrap cases use 10^12 raw native-token units. These are deposit/swap/redemption checks, not borrow/repay or every-market coverage.

AGW token resolution uses the destination chain for ordinary token objects: an explicit Base or Arbitrum ETH token must not select Sepolia's PRC20 merely because its symbol/address is identical. An explicit Push PRC20 reference must name the same source chain as the destination; a mismatch fails before signing.

### Creation UI: apps, tokens and preset availability

A rule requires at least one allowed function, even when tokens and limits are selected. A tokens-only rule returns `INVALID_RULE`, with `details.reason = 'ALLOWED_FUNCTION_REQUIRED'` and actionable `userMessage`. App selection can only be hidden if the application explicitly supplies the intended function permissions; the SDK does not invent transfer recipients or permissions.

`assets: []` remains valid for a universal rule with allowed calls. It grants no token transfers from Push; it never means all tokens. Allowed calls may still interact with destination-held assets under their configured constraints. There is no all-token wildcard. List each permitted token and cap explicitly (at most eight assets).

For presets, check `readiness.ready` before enabling Create. Display the per-chain issues and the affected token address. Empty selections explain that transfers from Push are disabled. `BRIDGE_ASSET_UNAVAILABLE` identifies an unverified SDK route, not proof that no deployment exists anywhere. Do not substitute a routed token solely because its symbol matches: the protocol must support that exact address, and swaps need compatible liquidity. A transfer-only helper is not included. An ERC20 transfer can be authorized explicitly with a `transfer(address,uint256)` allowed call pinned to a recipient and a per-transfer maximum; it also applies to that token already held in the wallet's destination account.

### Exact-preset acceptance and gas evidence

The opt-in `agw-presets-acceptance` group exercises all nine shipped testnet category/network combinations. It passes the returned `rules` unchanged to `create`, reads back every asset/cap/function/pin, and performs first-use and subsequent agent operations. Missing routes, protocols or exact PRC20 balances fail before funding; they do not count as passing acceptance. The opt-in `agw-presets-routed` group runs only the cases whose default assets are all routed (DEXES Sepolia and LENDING Arbitrum Sepolia); preflight checks readiness for the selected cases only. The earlier `agw-presets` and `agw-presets-expanded` protocol fixtures use prefunded destination assets and remain separate coverage.

Read-only compatibility checks are available with `node packages/core/scripts/check-agw-preset-compatibility.js /tmp/compatibility.json` after building core. The check verifies known routed source identities (registry and exact node routes), live Aave reserves, Moonwell/Venus underlyings, the reviewed EigenLayer strategy and pools at the preset routers' factories, including each DEX preset's own default pair. A matching symbol alone is insufficient. RPC and read errors are recorded as unknown checks, never as compatibility or as missing routes. No default assets were changed. `node packages/core/scripts/check-agw-route-registry.js /tmp/registry.json` compares the SDK's routes with the Push node's token registry (uregistry): it fails on a mismatched or SDK-only route and lists enabled node routes the SDK does not resolve.

`maxGasPerCall` is an owner-authorized ceiling on the PC attached to each outbound. The send-time `gasLimit` is a different field: the multiplier for the destination gas price. Omitted or zero uses the network base (500,000 on the EVM testnets, 960 on Solana devnet). Agent EVM sends without an explicit gasLimit instead use 2,000,000 on first use (the destination account is deployed), and 1,000,000 when they export a non-native token or make more than one destination call. A Sepolia Circle USDC export with approve and a Uniswap swap ran out of gas at the 500,000 base. An explicit value below the base is refused before quoting with `INVALID_RULE` and `details.minimum`. When omitted on Solana, the SDK raises the limit to cover finalization rent instead of using an EVM-style million-unit fallback. If a gas-price change leaves that budget short even after one re-quote, the send is refused before signing (`INCONSISTENT_READ`).

The attached budget is at least $1 of PC: 10 PC at the fixed $0.10 rate used for Push-native agents, and less or more for agents signing from another chain, which are priced through that origin's Donut stable pool. It is never less than the current Push pool cost of the destination gas plus 20%. BNB testnet gas is valued at that pool rate, because no BNB/USD feed exists (the BSC gateway feed is ETH/USD). The gateway refunds unused PC in the same transaction. After the destination executes, the node also refunds unused destination gas, `(gasLimit − gasUsed) × gasPrice`, to the wallet as PC in a later Push transaction; this was verified on Donut for EVM and Solana. On October 20 the gas swaps actually consumed 0.0008-2.37 PC per send. 0.1 PC can never cover the minimum budget. The 20 PC preset ceiling covered the Sepolia, Base Sepolia, Arbitrum Sepolia and Solana devnet runs; BNB testnet first sends exceed it while Donut's BNB gas price is high. There is no cumulative gas cap; the wallet's PC balance is the only total limit. `node packages/core/scripts/check-agw-gas-quotes.js /tmp/quotes.json` records current quotes for Push-native and Sepolia-origin agents without signing. Quotes change; they are not fixed fees or a validated default for custom rules.

The separate `agw-svm-agent-spl` group verifies the known devnet test harness's `receive_spl` instruction: wallet ATA pins, an amount ceiling, exact recipient credit and first/subsequent sends with omitted gas. It uses the existing counter program and does not certify a third-party Solana protocol. The gas evidence records Push transaction fees, attached quote budgets and destination fees separately. Run both new groups with the normal `__e2e__/ci/preflight.ts --group ...` and `__e2e__/ci/run.ts --group ...` commands.

The `agw-gas` group measures first-use and subsequent native-token agent sends on Sepolia, Base Sepolia, Arbitrum Sepolia and BNB testnet using the existing counter fixtures. Its route/gas coverage is separate from protocol preset acceptance.
