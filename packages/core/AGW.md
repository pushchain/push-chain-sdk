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

An equality pin fixes an argument; a maximum pin bounds it. For EVM signatures, `arg` is a zero-based static argument position. With a raw four-byte selector, it is a 32-byte ABI head-word position. Reads return a raw selector and these word positions. Unsupported dynamic/compound layouts fail explicitly; no guessed tuple-field indexes are produced.

`PushChain.CONSTANTS.AGENTIC.WALLET` resolves to the AGW on Push, its CEA on an EVM destination, or its CEA/selected token ATA on Solana. Deployment addresses and encoding helpers are internal.

Omitted `maxValue`, `assets[].maxTotal`, and `maxGasPerCall` default to **zero**, which permits no corresponding movement. Specify positive caps for sends that need value, tokens or destination gas. Native value is limited per call; there is no public native lifetime-total cap.

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

`PushChain.utils.agentic` contains only `presets.list/get`. The enumerable categories are `AGENTIC.PRESETS.CATEGORY.DEXES`, `LENDING` and `PREDICTION`. All three currently have empty `chains` lists because the app/address catalog is not approved yet; hide them in a UI. No production DEX/lending addresses ship in this framework.

```ts
const { presets } = PushChain.utils.agentic.presets.list({ type: 'CATEGORY' });
const availablePresets = presets.filter(preset => preset.chains.length > 0);
const { rules: reviewTemplates } = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
);
// Currently [], since there is no approved catalog. Never treat an empty result as an active preset.

function filledPreset(agent: Address) {
  return PushChain.utils.agentic.presets.get(
    PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
    { agent, validUntil: Math.floor(Date.now() / 1000) + 3600 },
  ).rules;
}
```

With catalog entries, `get` groups calls into one rule per chain. With agent and expiry supplied, its return type is `Rule[]`; otherwise it is `PresetRuleTemplate[]`, requiring those fields before `create`. Assets must name their chain unless a single chain filter is supplied. Missing `maxPerCall` or `maxTotal` defaults to zero (user decision, October 12), so missing caps do not grant token movement.

Reviewed EVM catalog spenders generate approvals pinned to that spender and bounded by the asset's per-call cap. Native assets need no approval. Distinct spenders for the same token become separate fully pinned alternatives under v6; unrestricted alternatives are rejected. Presets do not sign, fetch app ABIs or modify wallets.

The remaining catalog work includes selecting verified apps/functions/chains, struct-field indexing and checking approval combinations against the delivered policy. App ABIs remain with the UI.

## Validation

Run `node packages/core/scripts/check-agw-docs.js` to typecheck these examples. Unit tests use the normal core Jest configuration. `jest.agw-local.config.ts` uses pinned real AGW contracts and a stub gateway. Live E2Es are opt-in under `__e2e__/agw`; preflight verifies the deployment and funding limits. Local tests do not prove destination delivery, and historical live results do not count as validation of a changed public API.
