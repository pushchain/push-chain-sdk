# Agentic wallets on Push Chain

This SDK targets the deployed AGW v6 contracts on Push Donut.

## Connect

Use an application-managed key; examples do not load secrets or execute automatically.

```ts
import {
  PushChain,
  AgenticError,
  AgenticRevertError,
  type AuthoredRule,
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

`TOKEN_ROUTE_UNAVAILABLE` means an asset cannot be resolved for transfers from Push. Choose a token with a supported route on this network, or wait for a verified PRC20 route for that exact token address. Changing a symbol does not create a route. Display `error.userMessage`.

A DEX condition-limit failure reports `details.reason = 'RULE_CONSTRAINT_LIMIT'`, `actual`, `limit` and `callCount`. Conditions here are generated input checks (for example token, recipient and amount checks), rather than the number of visible function names. A stock DEX preset contains eight allowed-call entries and twenty-one conditions. Appending the same call list again makes forty-two conditions. The SDK rejects this; it does not deduplicate, remove conditions or split authority automatically. Preserve per-chain rules and regenerate after edits rather than appending generated calls.

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

Solana reads return `format: 'decoded'` with exact stored discriminators, offsets and constraints. This raw form is accepted by `rules.update`, preserving restrictions without inventing an IDL. Reusing it for another wallet/gateway is rejected. A decoded rule with a data pin counted from the end of the instruction data (`fromEnd: true`) is refused on create/add/update (`INVALID_RULE`, `details.reason = 'FROM_END_PIN_UNSUPPORTED'`): the deployed SvmRulebook does not tie the instruction-data length to the rule, so appended bytes could shift such a pin. Existing rules with these pins still read normally. Send-data encoding still uses the existing `utils.helpers.encodeTxData` IDL helper; rule authoring and transaction encoding are separate operations.

## Spend, checkpoints and execution

`rules.get/list` return `spent`. Universal spend contains one entry per asset in stored order. A single native call has scalar value/amount/call counters. Several native calls return `spent.actions`, with each entry identified by target and selector; unrelated token amounts are not summed.

Native historical terms with lifetime limits or differing per-action expiries that the new public shape cannot preserve return an explicit capability error rather than silently dropping restrictions.

Connect with `PushChain.initialize(signer, { agenticWallet: address })` to send from the wallet. Signer identity determines the owner or agent door. Native agent arrays are atomic and every call passes policy checks. `from` cannot be overridden. Responses identify the wallet as `from` and signer as `origin`, including wait/replay results.

Updates assert existing spend, delete the old rule and grant its replacement atomically. Native updates assert each action separately: a rule with N native actions records N+4 checkpoints on current v6. Agent execution records no owner checkpoint. Direct `setLabel` records none.

## V6 deployment and creation

The runtime uses factory `0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc` and URP `0xBA32e7A1500cb34311a31127bcD40CA52C8CFd36`, from source `ffd567d`. URP still reports 3.1.0; verified deployment wiring and the v6 ABI identify the supported generation.

`create` uses one index-bound `createWalletWithSig` call from the owner's Push identity, with the contract's owner-caller empty-signature path. The wallet and up to eight initial rules are committed atomically. A concurrent slot change returns INDEX_RACE; a receipt-read failure retains the submitted hash for recovery. CREATE_PARTIAL is removed. No sequential creation fallback exists.

For outbound sends on either door, the wallet approves the gateway inside the transaction after policy authorization, executes the outbound, and clears remaining allowance. No separate approval or SDK allowance check is needed; GATEWAY_ALLOWANCE_INSUFFICIENT is removed. Approval/cleanup uses the contract's best-effort token calls. To stop an agent, delete its rules; clearing the gateway allowance does not disable an otherwise valid rule.

The wire encoder uses uint32 maximum for unlimited native calls and 255 for unspecified Solana account count. Neither uses the retired zero sentinel. The envelope remains version 1.

`rules.delete` is the public name; on-chain `revokeRules` names/events remain unchanged. Revert errors retain decoded details and cause. Core transaction response fields used by other SDK routes are not globally removed.

## Preset discovery and templates (section 7)

`PushChain.utils.agentic` contains `presets.list/get`. The categories are `AGENTIC.PRESETS.CATEGORY.DEXES`, `LENDING` and `STAKING`. The catalog contains only presets that ran live on the Donut testnets:

- DEXES: Uniswap V3 on Sepolia, Base Sepolia and Arbitrum Sepolia.
- LENDING: Aave V3 on Sepolia, Base Sepolia and Arbitrum Sepolia.
- STAKING: no entries yet. Hide categories with empty `chains` lists.

Every preset sends only native ETH from Push. The agent wraps it into WETH on the destination chain as the first call of the same transaction, then uses the app. Because native ETH is routed to every listed chain, every listed preset can be created; there is no readiness report to check.

```ts
const { presets } = PushChain.utils.agentic.presets.list({ type: 'CATEGORY' });
const availablePresets = presets.filter(preset => preset.chains.length > 0);
const { rules: reviewTemplates } = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
);
// Each rule sends native ETH from Push with the SDK's limits, a 20 PC gas
// ceiling and a seven-day expiry. Supply the agent to get complete Rule[].
const configuredPreset = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.LENDING,
  { chainNamespace: 'eip155:11155111', agent: '0x0000000000000000000000000000000000001234' },
);
// Pass configuredPreset.rules directly to create.

function filledPreset(agent: Address, maxPerCall: bigint, maxTotal: bigint) {
  return PushChain.utils.agentic.presets.get(
    PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
    {
      chainNamespace: 'eip155:84532',
      agent,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      assets: [
        { token: PushChain.CONSTANTS.MOVEABLE.TOKEN.BASE_SEPOLIA.ETH, maxPerCall, maxTotal },
      ],
    },
  );
}
```

`get` returns `{ rules }`, one rule per chain, in the shape `create` takes. With an agent supplied, `rules` is typed as `Rule[]`; otherwise it is `PresetRuleTemplate[]` with a generated expiry and missing agent. An omitted gas budget uses the preset policy; an explicit zero remains zero.

### What each preset allows

Caps marked "ETH cap" equal the ETH asset's `maxPerCall`, in wei.

| Preset | Allowed calls |
| --- | --- |
| DEXES | `WETH.deposit()` with `maxValue` = ETH cap; `WETH.approve(router, ≤ ETH cap)`; `exactInputSingle`/`exactOutputSingle` WETH → USDC with WETH and USDC pinned, recipient = wallet and input ≤ ETH cap; `USDC.approve(router, ≤ 10 USDC)`; the same two swaps USDC → WETH with input ≤ 10 USDC; `WETH.withdraw(≤ ETH cap)` to unwrap |
| LENDING | `WETH.deposit()` with `maxValue` = ETH cap; `WETH.approve(pool, ≤ ETH cap)`; Aave `supply`, `withdraw`, `borrow`, `repay` with the asset pinned to the reserve WETH, the beneficiary pinned to the wallet and the amount ≤ ETH cap; `WETH.withdraw(≤ ETH cap)` |

| Network | Uniswap router | DEX WETH / USDC | Aave pool | Aave WETH reserve |
| --- | --- | --- | --- | --- |
| Sepolia | `0x3bFA…Ae48E` | canonical WETH `0xfff9…6B14` / Circle USDC `0x1c7D…7238` | `0x6Ae4…8951` | Aave WETH `0xC558…9c3c` |
| Base Sepolia | `0x94cC…2bc4` | WETH `0x4200…0006` / Circle USDC `0x036C…CF7e` | `0x8bAB…aE27` | WETH `0x4200…0006` |
| Arbitrum Sepolia | `0x101F…663E` | WETH `0x980B…7c73` / Circle USDC `0x75fa…AA4d` | `0xBfC9…2Eff` | Aave WETH `0x1dF4…053D` |

Each router's `WETH9()` is the DEX WETH it pins. Circle USDC is the only token with WETH liquidity on these Uniswap deployments; it is used only on the destination chain and is never sent from Push. The fee tier is not pinned: testnet pools are thin and often mispriced (on Arbitrum Sepolia the 0.05% pool returns nothing for small swaps), so an agent should pick the tier from a QuoterV2 quote. Testnet tokens with similar names can have different addresses; the returned addresses are authoritative. Templates describe permissions, not available liquidity or guaranteed execution. Presets do not sign, fetch app ABIs or modify wallets.

### Limits and overrides

| Setting | Default |
| --- | --- |
| ETH per Push outbound and per allowed call | 0.001 ETH |
| ETH sent from Push in total | 0.01 ETH |
| USDC per swap on the destination chain | 10 USDC (fixed in the returned rule) |
| Gas ceiling | 20 PC per outbound |
| Expiry | seven days from the get call |

Pass `assets` to set the ETH limits. Each selected chain needs exactly one native ETH asset, written as the zero address or the chain's `MOVEABLE.TOKEN.<CHAIN>.ETH`, with positive `maxPerCall` and `maxTotal`. A non-ETH token, a missing or zero limit, an empty array or a selected chain without an asset throws `INVALID_RULE`. Assets must name their chain unless a single chain filter is supplied. Call `get` again after changing a limit: the wrap value, approvals and operation pins all follow `maxPerCall`. To change the 10 USDC swap limit, edit the returned rule before `create`.

The 20 PC gas ceiling is not a flat fee or a reservation. Actual sends obtain a fresh quote and remain subject to the rule cap; unused destination gas is refunded.

### Configure and regenerate

```ts
async function createConfiguredDex(
  client: PushChain, agent: Address, maxPerCall: bigint, maxTotal: bigint,
) {
  const configured = filledPreset(agent, maxPerCall, maxTotal);
  return client.agentic.create('My DEX agent', { rules: configured.rules });
}

async function replaceConfiguredDex(
  client: PushChain, wallet: Address, rulesId: Hex,
  agent: Address, maxPerCall: bigint, maxTotal: bigint,
) {
  // Re-run get after editing limits so every cap in allowedCalls follows them.
  const configured = filledPreset(agent, maxPerCall, maxTotal);
  return client.agentic.wallet(wallet).rules.update({
    rules: [{ rulesId, rule: configured.rules[0] }],
  });
}
```

Save the preset category and editable inputs in the UI if subsequent edits should regenerate the preset. On-chain rules do not retain preset provenance or display metadata. A regenerated result is a replacement: do not append it to the old allowedCalls. An update creates a new rulesId and resets counters, as documented above.

### Enforcement scope

**A per-call limit applies to each allowed contract call, not the sum of several calls in one transaction. `maxTotal` is the cumulative Push-outbound amount, including outbounds whose destination execution later fails; it is not lifetime turnover on the destination.** These statements also hold for tokens already in the wallet's destination account, such as USDC from an earlier swap. Destination lifetime or batch-total accounting requires contract support.

The contract allows at most 32 pins across a universal rule. A DEX preset uses 8 calls and 21 pins, and a LENDING preset 7 calls and 15 pins. Expansion fails explicitly if an edited rule exceeds the ceiling; no restrictions are silently dropped. Custom rules remain possible through the normal rule API.

## Validation

Run `node packages/core/scripts/check-agw-docs.js` to typecheck these examples. Unit tests use the normal core Jest configuration. `jest.agw-local.config.ts` uses pinned real AGW contracts and a stub gateway. Live E2Es are opt-in under `__e2e__/agw`; preflight verifies the deployment and funding limits. Local tests do not prove destination delivery, and historical live results do not count as validation of a changed public API.


### Live preset acceptance

The opt-in `agw-presets-acceptance` group runs all six shipped presets on Donut. From `packages/core`, run `npm run e2e:preflight -- --group agw-presets-acceptance --dry-run`, then `npm run e2e:ci -- --group agw-presets-acceptance`. Each case passes the returned `rules` unchanged to `create`, reads back every asset, cap, function and pin, then has the agent send ETH twice (first use and subsequent) with `[deposit, approve, swap or supply]`. It checks destination success, the resulting USDC or aToken balance and the recorded ETH spend. The owner needs the chain's gas PRC20 (pETH, pETH_BASE or pETH_ARB) for two bounded sends; each case funds a fresh wallet with 50 PC. No mainnet transaction is part of this group.

AGW token resolution uses the destination chain for ordinary token objects: an explicit Base or Arbitrum ETH token must not select Sepolia's PRC20 merely because its symbol/address is identical. An explicit Push PRC20 reference must name the same source chain as the destination; a mismatch fails before signing.

### Creation UI: apps, tokens and preset availability

**Tokens without an app.** On an EVM network, a rule with ERC20 assets and no `allowedCalls` (omitted or `[]`) lets the agent transfer each token only back to the owner. The SDK adds one `transfer(address,uint256)` call per token, pinned to the owner's own EVM address and capped at that asset's `maxPerCall`. The owner's address is the Push EOA, or the EVM address the owner's account comes from. `transferTo` names more recipients, one more call per token each; the owner stays included.

```ts
const tokensOnly: AuthoredRule = {
  agent: '0x0000000000000000000000000000000000001234',
  chainNamespace: 'eip155:11155111',
  validUntil: Math.floor(Date.now() / 1000) + 7 * 86400,
  assets: [
    {
      token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC,
      maxPerCall: BigInt(10_000_000),
      maxTotal: BigInt(100_000_000),
    },
  ],
  // Optional: also allow transfers to this address.
  transferTo: ['0x0000000000000000000000000000000000005678'],
};
```

The per-transfer limit can be repeated until the rule expires, so the agent can move the token's whole balance in the destination account, including tokens already there, but only to these recipients. Refused with `INVALID_RULE` and a `details.reason`:

- `TOKENS_ONLY_NATIVE`: native ETH or BNB in such a rule (a rule cannot allow a plain coin transfer).
- `TOKENS_ONLY_UNSUPPORTED`: a Solana rule without an app, or `transferTo` outside EVM.
- `TRANSFER_RECIPIENT_REQUIRED`: an owner whose account comes from Solana and no `transferTo`.
- `TRANSFER_TO_WITH_CALLS`: `transferTo` together with allowed functions; add the transfer as an allowed function instead.

A Push-chain rule, or an EVM rule with neither assets nor functions, still returns `ALLOWED_FUNCTION_REQUIRED`. A Push-chain rule allows at most eight functions; other networks allow 32.

**All supported tokens.** `assets: [{ token: PushChain.CONSTANTS.MOVEABLE.TOKEN.<CHAIN>.ALL }]` expands, when the rule is prepared, to every token Push can send to that chain, each with its default limit (10 per send and 100 in total for USDC, USDT and DAI; 0.001 and 0.01 for ETH, WETH and stETH; 0.01 and 0.1 for BNB and SOL). The Circle USDC route and the routed mock USDC are separate tokens and are both listed. Tokens added to Push later are not included in an existing rule. `ALL` takes no limits (`ALL_WITH_LIMITS`); a token listed next to it replaces its default entry. Without an app, `ALL` leaves native ETH/BNB out, so the rule transfers every routable ERC20 back to the owner. Use `PushChain.utils.agentic.assets.all(chainNamespace)` to show the expanded list and its limits before signing.

`assets: []` still grants no transfers from Push; it never means all tokens. Allowed calls may still interact with destination-held assets under their configured constraints. A rule holds at most eight assets.

Every listed preset can be created; there is no readiness check. Do not substitute a routed token solely because its symbol matches: the protocol must support that exact address, and swaps need compatible liquidity.

### Exact-preset acceptance and gas evidence

Read-only compatibility checks are available with `node packages/core/scripts/check-agw-preset-compatibility.js /tmp/compatibility.json` after building core. For every preset chain it simulates `deposit()` on the wrap target with native value, checks that the router wraps into that WETH and that Uniswap's QuoterV2 returns USDC for a dust swap at some fee tier, and that the Aave pool lists the WETH reserve. RPC and read errors are recorded and fail the check; they are never reported as compatibility. `node packages/core/scripts/check-agw-route-registry.js /tmp/registry.json` compares the SDK's routes with the Push node's token registry (uregistry): it fails on a mismatched or SDK-only route and lists enabled node routes the SDK does not resolve.

`maxGasPerCall` is an owner-authorized ceiling on the PC attached to each outbound. The send-time `gasLimit` is a different field: the multiplier for the destination gas price. Omitted or zero uses the network base (500,000 on the EVM testnets, 960 on Solana devnet). Agent EVM sends without an explicit gasLimit instead use 2,000,000 on first use (the destination account is deployed), and 1,000,000 when they export a non-native token or make more than one destination call. A Sepolia Circle USDC export with approve and a Uniswap swap ran out of gas at the 500,000 base. An explicit value below the base is refused before quoting with `INVALID_RULE` and `details.minimum`. When omitted on Solana, the SDK raises the limit to cover finalization rent instead of using an EVM-style million-unit fallback. If a gas-price change leaves that budget short even after one re-quote, the send is refused before signing (`INCONSISTENT_READ`).

The attached budget is at least $1 of PC: 10 PC at the fixed $0.10 rate used for Push-native agents, and less or more for agents signing from another chain, which are priced through that origin's Donut stable pool. It is never less than the current Push pool cost of the destination gas plus 20%. BNB testnet gas is valued at that pool rate, because no BNB/USD feed exists (the BSC gateway feed is ETH/USD). The gateway refunds unused PC in the same transaction. After the destination executes, the node also refunds unused destination gas, `(gasLimit − gasUsed) × gasPrice`, to the wallet as PC in a later Push transaction; this was verified on Donut for EVM and Solana. On October 20 the gas swaps actually consumed 0.0008-2.37 PC per send. 0.1 PC can never cover the minimum budget. The 20 PC preset ceiling covered the Sepolia, Base Sepolia, Arbitrum Sepolia and Solana devnet runs; BNB testnet first sends exceed it while Donut's BNB gas price is high. There is no cumulative gas cap; the wallet's PC balance is the only total limit. `node packages/core/scripts/check-agw-gas-quotes.js /tmp/quotes.json` records current quotes for Push-native and Sepolia-origin agents without signing. Quotes change; they are not fixed fees or a validated default for custom rules.

The separate `agw-svm-agent-spl` group verifies the known devnet test harness's `receive_spl` instruction: wallet ATA pins, an amount ceiling, exact recipient credit and first/subsequent sends with omitted gas. It uses the existing counter program and does not certify a third-party Solana protocol. The gas evidence records Push transaction fees, attached quote budgets and destination fees separately. Run both new groups with the normal `__e2e__/ci/preflight.ts --group ...` and `__e2e__/ci/run.ts --group ...` commands.

The `agw-gas` group measures first-use and subsequent native-token agent sends on Sepolia, Base Sepolia, Arbitrum Sepolia and BNB testnet using the existing counter fixtures. Its route/gas coverage is separate from protocol preset acceptance.
