# Agentic wallets on Push Chain

This branch implements the SDK-only October 12 feedback against the deployed Donut v5 contracts. Contract-dependent changes remain explicit below.

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

On deployed v5, native rules allow at most **eight** calls, eight equality pins and one maximum pin per call. Public native lifetime budgets, `maxCalls`, `amount`, single-call shorthand and `actions[]` are retired. Native counters still accumulate for reporting and atomic update assertions.

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

The deployed policy supports one `WALLET` equality pin per EVM destination call. General destination equality/maximum pins need the new contract deployment and currently fail with `CAPABILITY_UNAVAILABLE` before signing.

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

## Deployment-dependent behavior

The October 12 contract feedback is not deployed. Until it is verified:

- Outbound sends on both doors require a separately owner-set gateway allowance; the SDK never silently creates or restores one. Insufficient allowance fails before signing.
- Creation uses the existing index-bound deploy/grant flow. If a signer cannot execute it atomically, `CREATE_PARTIAL` preserves committed receipts and recovery details. Do not blindly retry creation.
- General EVM destination pins and the new atomic factory `createWallet` are unavailable.

`rules.delete` is the public name; on-chain `revokeRules` names/events remain unchanged. Unsupported capabilities use `CAPABILITY_UNAVAILABLE`. On-chain errors retain revert details through `AgenticRevertError`/`PushChainExecutionError`.

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

Reviewed EVM catalog spenders generate approvals pinned to that spender and bounded by the asset's per-call cap. Native assets need no approval. Conflicting spenders for the same token are rejected until the policy representation is reviewed; the framework never replaces them with an unrestricted approval. General EVM approval pins still require the pending contract upgrade, and normal `create/add` validation enforces that boundary. Presets do not sign, fetch app ABIs or modify wallets.

The remaining catalog work includes selecting verified apps/functions/chains, struct-field indexing and checking approval combinations against the delivered policy. App ABIs remain with the UI.

## Validation

Run `node packages/core/scripts/check-agw-docs.js` to typecheck these examples. Unit tests use the normal core Jest configuration. `jest.agw-local.config.ts` uses pinned real AGW contracts and a stub gateway. Live E2Es are opt-in under `__e2e__/agw`; preflight verifies the deployment and funding limits. Local tests do not prove destination delivery, and historical live results do not count as validation of a changed public API.
