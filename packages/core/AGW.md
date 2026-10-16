# Agentic wallets on Push Chain

This branch implements the SDK-only October 12 feedback against the deployed Donut v6 contracts. The runtime targets v6 only; existing v5 wallets are not silently adapted.

## Connect

Use an application-managed key; examples do not load secrets or execute automatically.

```ts
import {
  PushChain,
  AgenticError,
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

Omitted `maxValue`, `assets[].maxTotal`, and `maxGasPerCall` default to **zero**. Asset totals meter tokens sent from Push; they do not meter trading or lending using capital already in the destination CEA. Specify positive caps for sends that need value, tokens or destination gas. Native value is limited per call; there is no public native lifetime-total cap.

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
- STAKING: EigenLayer deposits on Ethereum mainnet and Sepolia; Lido stake and wrap/unwrap on Ethereum mainnet. Withdrawal requests with dynamic amounts, claims with position-derived amounts and EigenLayer withdrawals are excluded from these bounded presets. A selected native asset supplies the Lido `submit` value cap; omitted caps remain zero.
- PREDICTION: no entries yet. Hide categories with empty `chains` lists.

```ts
const { presets } = PushChain.utils.agentic.presets.list({ type: 'CATEGORY' });
const availablePresets = presets.filter(preset => preset.chains.length > 0);
const { rules: reviewTemplates } = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
);
// Choose tokens in the review UI, then call get again as below.

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

The example caps are illustrative raw units; choose caps for the actual token decimals and gas requirements. `get` groups calls into one rule per chain. The result is `{ rules, readiness }`. With agent and expiry supplied, `rules` is typed as `Rule[]`; otherwise it is `PresetRuleTemplate[]`. This type distinction alone does not establish readiness. Assets must name their chain unless a single chain filter is supplied. Omitted asset caps and `maxGasPerCall` default to zero.

DEX discovery works without options, with an empty asset list, or with assets for only some chains. A chain with fewer than two tokens returns full-signature review calls with wallet-recipient pins and an explicit zero input-amount maximum. A single supplied token is also pinned as the input. These calls cannot spend swap input tokens, even if asset budgets are filled later. Call `get` again after selecting both tokens to replace the review calls with the complete token-pinned rules; merely assigning `rule.assets` is insufficient.

With two ERC20 tokens, `get` expands ordered pairs into exact-input and exact-output calls with token, wallet-recipient and input-amount pins. Native markers and expansions exceeding the policy's 32-pin limit are rejected. Two tokens fit the shipped router template; three do not. Static tuple fields use paths such as `[0, 3]`.

Reviewed EVM spenders generate approvals pinned to that spender and bounded by the asset's per-call cap. Money-market approvals are restricted to the market's underlying token. Distinct spenders become separate pinned alternatives under v6. These destination approvals are ordinary ERC20 allowances; the wallet's automatic Push-side gateway approval is separate.

Templates describe permissions, not available liquidity or guaranteed execution. Verify destination token balances, supported reserves and source PRC20 routes before use: protocol testnet mock tokens may differ from MOVEABLE tokens. Presets do not sign, fetch app ABIs or modify wallets. Dynamic-path swaps, Solana protocol templates and unconfirmed deployments are excluded. Mainnet addresses were checked read-only; no mainnet transactions were executed. Other mainnet protocols in the proposal remain excluded until their deployment and permission constraints are verified. Local policy tests do not execute the destination protocols.

### Configure, inspect and regenerate

`readiness.ready` means the returned chains have locally complete inputs and at least one enabled asset operation. It does not check PRC20 availability, deployments, balances, live reserve flags or liquidity. `readiness.chains` gives per-chain `issues`, `disabledCalls`, `excludedCalls`, catalog `knownTokens` and `zeroBridgeLimits`. These are additive result fields; `rules` remains accepted by the existing create/update methods.

The UI should collect chain, agent, token selections, raw-unit limits, gas budget and expiry. Show zero-cap calls as disabled. Present excluded calls explicitly. There is no SDK-selected 0.1 PC gas budget or 30-day expiry. A zero bridge limit can be intentional when assets are already at the destination; it is reported separately from operation readiness.

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
