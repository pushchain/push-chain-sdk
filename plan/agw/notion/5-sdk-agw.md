# 5. SDK: AGW

<aside>
🧩

**Where we are going.** `client.agentic` in `@pushchain/core`: create a wallet with rules in one call, act as an agent through it with the same `sendTransaction` everyone already uses, and later list cards, start jobs and build criteria from the same client. Examples first, types second, nothing that breaks the existing SDK.

**What this page is.** The SDK surface for the AGW alone: `client.agentic` on the owner side, `PushChain.initialize(agentSigner, { agenticWallet })` on the agent side. One heading per function so the table of contents lists everything that is coming in. Marketplace, job and evaluation SDKs are pages 6, 7, 8.

**Namespaces.** Four top-level, one per piece: `client.agentic`, `client.market`, `client.job`, `client.evaluation`. Nothing is nested under `agentic`.

</aside>

# List of changes

New

- `client.agentic.derive`
- `client.agentic.create`
- `client.agentic.list`
- `client.agentic.wallet`,
    - a management handle with
        - `info`,
        - `owner`,
        - `setLabel` (PROPOSED),
        - `checkpoints`,
        - `rules.list`,
        - `rules.get`,
        - `rules.add`,
        - `rules.update`,
        - `rules.revoke`
- `PushChain.CONSTANTS.AGENTIC`
- `PushChain.utils.agentic`

Updated

- `PushChain.initialize`, new option `agenticWallet`
- `PushChain.CONSTANTS.READ.CHAIN`, outside change confirmed 2026-09-28

Initialize is unchanged on the owner side:

```tsx
const client = await PushChain.initialize(universalSigner, { network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET });
```

| Signer | Door | Rules checked |
| --- | --- | --- |
| The wallet's owner | Owner door (`execute`) | No. Every send is recorded as a checkpoint |
| An address named as `agent` in one of the wallet's rules | Agent door (`executeAsAgent`) | Yes, by URP (UniversalRulesPolicy, the on-chain rule checker) |
| Anyone else | None | Never reached: `initialize` throws `NOT_OWNER_OR_AGENT` |

An agentic wallet involves three parties, and it helps to have them straight before reading the functions.

The **owner** is whoever created the wallet. When the owner sends through the wallet, no rules are checked; this is called the owner door, and the contract records every such action as a checkpoint so that an evaluator can later tell whether the owner touched anything mid-job.

The **agent** is the address the owner allows to act on its behalf. It is always a Push address. If the agent's key is a Push EOA, that EOA is the agent. If the key lives on another chain (an EVM key on Ethereum, a Solana key, anything else), the agent is that key's UEA on Push, which exists deterministically for every external key. The SDK never asks for a curve, a chain or a key type. When the agent sends through the wallet, the rules are checked; this is the agent door.

The **rules** say what an agent may do. Each rule names its agent and its destination chain, and there is one rule per chain per agent, so a wallet can have one agent for Ethereum and a different one for Solana. The `chainNamespace` on a rule decides which rulebook applies: leave it out and the rule governs calls on Push itself; set it to an `eip155` or `solana` chain and the rule governs cross-chain calls to that chain.

Two ways to touch a wallet from the SDK. `PushChain.initialize(signer, { agenticWallet })` returns a client that acts as the wallet, and whether it goes through the owner door or the agent door depends on who the signer is. `client.agentic.wallet(address)` returns a handle for managing the wallet (rules, label, checkpoints) and never sends as it.

# 1. Owner side, by example

The owner side is everything the person who owns the wallet does: create it, fund it, write and revoke the rules, look at what happened. The agent side (section 2) is what the agent does: act through the wallet within those rules.

### 1.a Derive an agentic wallet address - `client.agentic.derive`

Gives you the address a wallet will have before it is deployed. The address depends only on the owner and an index.

```tsx
// Function
const first = await client.agentic.derive({ options? })

// Usage and Params
const next  = await client.agentic.derive();                    // the owner's next wallet
const first = await client.agentic.derive({ index: 0 });        // a specific slot
// options.index   number, optional   which wallet slot to derive; default is the owner's next unused index

// Returns
// <Object> { address, index, deployed }
{
  address: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',
  index: 0,
  deployed: false
}
```

Because the address depends only on the owner and an index, it is the same whether you deploy first or later. That lets you send funds to it first (from any chain) and deploy afterwards, or show the address in a UI before anything is on-chain. Same idea as `deriveExecutorAccount` for a UEA.

### 1.b Create an agentic wallet - `client.agentic.create`

Deploys the wallet and grants the rules. The label is the only wallet-level input; the agent and an optional `ref` are named on each rule, because that is where the contract binds them.

```tsx
// Function
const created = await client.agentic.create(label, { options })

// Usage and Params
const created = await client.agentic.create('aave-optimiser', {    // wallet with one cross-chain rule
  rules: [{                                                      // one entry per chain per agent
    agent: '0xAgentOnPush',                                      // a Push address: the agent's EOA, or its UEA if the key lives on another chain. Never the owner
    chainNamespace: CHAIN.ETHEREUM_SEPOLIA,                      // foreign chain => universal rulebook
    assets: [
      { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC, maxPerCall: parseUnits('100', 6), maxTotal: parseUnits('1000', 6) },
      { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.WETH, maxPerCall: parseUnits('0.5', 18) },
    ],
    maxGasPerCall: parseUnits('1', 18),   // PC (wei) per outbound for the destination leg
    validUntil: now + 30 * 86400,
    allowedCalls: [
      { target: aavePool,    selector: 'supply(address,uint256,address,uint16)', beneficiary: 2 },   // arg index, not offset: onBehalfOf must be the AGW's CEA
      { target: usdcSepolia, selector: 'approve(address,uint256)' },
    ],
  }],
  progressHook: (p) => console.log(p.id, p.message),             // AGENTIC-TX-1xx
});
const bare = await client.agentic.create('scratch', { rules: [] });   // wallet first, rules later with rules.add
// label                  string, required                     shown in list() and info(); the contract stores it
// options.rules          Rule[], required                     one per chain per agent, may be empty; each rule carries its own agent and optional ref
// options.progressHook   function, optional                   progress events, AGENTIC-TX-1xx; default none
// rules[].agent          Address, required                    the Push address allowed to act under this rule; never the owner
// rules[].ref            Hex, optional                        emitted in RulesGranted, not interpreted; default zero
// rules[].assets         AssetCap[], required on a universal rule   tokens the agent may move, as the other chain's address (MOVEABLE constants); the SDK resolves each to its PRC20 on Push; each cap is { token, maxPerCall, maxTotal? }
// rules[].maxGasPerCall  bigint, required on a universal rule       PC (wei) the wallet may spend per outbound for the destination leg

// Returns
// <Object> { wallet, index, rulesIds, tx }
{
  wallet: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',
  index: 0,
  rulesIds: ['0x9c1e...'],                                       // in the order of the rules you passed; empty for rules: []
  tx: {                                                          // UniversalTxResponse
    hash: '0xb527...',
    origin: 'eip155:11155111:0x31dC...',                         // the owner's key, CAIP-10
    from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',          // the owner's Push account
    blockNumber: 1290n,
    wait                                                         // await tx.wait() for the receipt; status lives on the receipt
  }
}
```

One rule per chain per agent. A wallet may have different agents on different chains. If an agent needs to act on two chains, `rules` has two entries with the same `agent`; two agents on one chain are two entries with the same `chainNamespace`. Nobody states a rule type; the SDK reads it from `chainNamespace`. `rules: []` is allowed: create the wallet first and grant rules later with `rules.add` (1.k).

Before asking for a signature the SDK checks that no rule's agent is the owner (`AGENT_IS_OWNER`), that no two rules share both agent and chain (`DUPLICATE_RULE`), that every `allowedCalls[].target` is on the rule's chain (`TARGET_NOT_ON_RULE_CHAIN`), and that every `assets[].token` resolves to a PRC20 whose `SOURCE_CHAIN_NAMESPACE` matches the rule's chain (`ASSET_CHAIN_MISMATCH`).

Under the hood this is `deployWallet` (or reuse of a derived address) and one `grantRules` per rule. For an external owner they go as one UEA multicall under one signature. Funding is not part of `create`: the wallet is a normal Push account, so send tokens and PC to its address the way you would to any account (1.a shows the address before deployment).

For a Push EOA owner the same thing needs a batching entry on the factory, because core rejects multicall from a Push-native sender: [1. AGW Contract Changes (nomenclature standard + change set)](1-agw-contract-changes.md) item 11, **PROPOSED** (`createWallet(label, rules[])` on the factory). Until it lands the SDK sends deploy and grant as separate transactions and says so through progress events (AGENTIC-TX-102 and 104); `tx` is then the last of them.

A `progressHook` passed to `PushChain.initialize` receives the same events alongside the per-call one, as in core.

Warning for an agent whose key lives on another chain: the same EVM key initialized against two chains yields two UEAs, because a UEA is derived from namespace, chainId and owner. Grant the rule to the UEA of the chain the agent will run against. `PushChain.utils.account.deriveExecutorAccount(PushChain.utils.account.toUniversal(address, { chain }))` gives it.

### 1.c List an owner's wallets - `client.agentic.list`

Lists the wallets owned by the connected signer. It takes no arguments and only reads the connected account.

```tsx
// Function
const res = await client.agentic.list()

// Usage and Params
const { wallets } = await client.agentic.list();                // the connected signer's wallets
// no params

// Returns
// <Object> { wallets: Array<{ address, index, label, deployed, rulesCount }> }
{
  wallets: [
    { address: '0x2Fd9...', index: 0, label: 'aave-optimiser', deployed: true,  rulesCount: 1 },
    { address: '0x81aB...', index: 1, label: '',               deployed: false, rulesCount: 0 },
  ]
}
```

Client methods act on the connected account; reads about any other account live in `PushChain.utils`. If a read-only view is needed later (a marketplace or explorer page showing the wallets of an address with no signer), it becomes `PushChain.utils.agentic.wallets(owner: Address)` taking a Push address; an external owner passes its UEA. Not in v1.

### 1.d Get a wallet handle - `client.agentic.wallet`

Returns a handle for one wallet: the reads that are specific to an agentic wallet, plus the rule writes only an owner can do. It is not a client and never sends as the wallet.

```tsx
// Function
const w = client.agentic.wallet(address)

// Usage and Params
const w = client.agentic.wallet('0xWallet');                    // handle for one wallet; nothing is sent
// address   Address, required   the AGW to manage, a Push address

// Returns
// <AgenticWallet> { address, info(), owner(), setLabel(), checkpoints(), rules.* }
{
  address: '0xWallet',
  info, owner, setLabel, checkpoints,                           // 1.e to 1.h
  rules: { list, get, add, update, revoke }                     // 1.i to 1.m
}
```

There is one way to send as the wallet: `PushChain.initialize(signer, { agenticWallet })` (section 2). The handle only manages. To send as the wallet, move funds, reach the wallet's CEA on another chain, or read balances, initialize with `agenticWallet` and use the normal account tooling: `sendTransaction`, `universal.read`, or viem and ethers against `client.universal.account`. That gives the owner the full `sendTransaction` with every route the SDK already has, the same receipts, and the wallet's CEA reachable exactly as it is for any other account.

Balance reads are deliberately not on the handle: they are not agentic, and every account is read the same way. There is no `w.execute` for the same reason. The handle stays what its name says: management.

### 1.e Read wallet info - `w.info`

Returns the wallet's summary in one read: the fields `list()` shows for each wallet, plus the owner. It is how you read the label from the handle.

```tsx
// Function
const info = await w.info()

// Usage and Params
const { label, deployed } = await w.info();                     // one wallet's summary
// no params

// Returns
// <Object> { address, label, index, owner, deployed, rulesCount }
{
  address: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',
  label: 'aave-optimiser',
  index: 0,
  owner: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',
  deployed: true,
  rulesCount: 1
}
```

### 1.f Read the owner - `w.owner`

Returns the owner's Push address, as the contract stores it.

```tsx
// Function
const res = await w.owner()

// Usage and Params
const { owner } = await w.owner();                              // the Push address stored as owner
// no params

// Returns
// <Object> { owner }
{
  owner: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9'
}
```

If the owner is a UEA and you need the controlling origin behind it (the chain and the external key), use `resolveControllerAccount` on the returned address.

Page rule: identities going in and out of the agentic namespace are Push addresses (owner, agent, wallet).

### 1.g Set the wallet label - `w.setLabel`

**PROPOSED**, contract change, see [1. AGW Contract Changes (nomenclature standard + change set)](1-agw-contract-changes.md) item 10. Changes the label shown in `list()` and `info()`; owner only.

```tsx
// Function
const tx = await w.setLabel(label, { options? })

// Usage and Params
const tx      = await w.setLabel('aave-optimiser-v2');                                          // rename the wallet
const tracked = await w.setLabel('aave-optimiser-v2', { progressHook: (p) => console.log(p.id) });   // with progress events
// label                  string, required     the new label; stored by the contract and emitted in LabelSet
// options.progressHook   function, optional   progress events, AGENTIC-TX-106; default none

// Returns
// <UniversalTxResponse> { hash, origin, from, to, blockNumber, wait() }
{
  hash: '0x3b8d...',
  origin: 'eip155:11155111:0x31dC...',                          // the owner's key, CAIP-10
  from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',           // the owner's Push account
  to: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',             // the wallet
  blockNumber: 1488n,
  wait                                                          // await tx.wait() for the receipt; status lives on the receipt
}
```

Emits `LabelSet(string label)`. It is not a checkpoint: the label is cosmetic metadata and evaluators ignore it. Today the label can only be set once, at `deployWallet`, and is emitted in `WalletDeployed`.

### 1.h Read checkpoints - `w.checkpoints`

Every owner-side change the wallet has recorded: owner-door sends, rules granted, rules revoked. An evaluator reads these to know whether the owner changed anything after a job started (page 4).

```tsx
// Function
const res = await w.checkpoints({ options? })

// Usage and Params
const all    = await w.checkpoints();                           // every checkpoint
const recent = await w.checkpoints({ sinceBlock: 1234n });      // from a block onward
// options.sinceBlock   bigint, optional   only checkpoints at or after this block; default all

// Returns
// <Object> { checkpoints: Array<{ seq, kind, ref, blockNumber, txHash }> }
{
  checkpoints: [
    { seq: 3, kind: 'RULES_GRANTED', ref: '0x9c1e...', blockNumber: 1290n, txHash: '0x...' },
    { seq: 4, kind: 'OWNER_ACTION',  ref: '0x5a7b...', blockNumber: 1402n, txHash: '0x...' },
  ]
}
```

### 1.i List rules - `w.rules.list`

Returns every rule on the wallet as a decoded record, including what each rule has spent so far.

```tsx
// Function
const res = await w.rules.list()

// Usage and Params
const { rules } = await w.rules.list();                         // the wallet's rules
// no params

// Returns
// <Object> { rules: RulesRecord[] }
{
  rules: [
    {
      rulesId: '0x9c1e...',
      enabled: true,
      chainNamespace: 'eip155:11155111',
      agent: '0xAgentOnPush',
      validUntil: 1767225600,
      ref: '0x4a2f...',
      rule: { /* decoded UniversalRule, as passed to create */ },
      spent: { kind: 'universal', amountSpent: 25000000n }      // shape PROPOSED, see 3.b
    }
  ]
}
```

### 1.j Get one rule - `w.rules.get`

Returns one rule by id, decoded, with what it has spent.

```tsx
// Function
const record = await w.rules.get(rulesId)

// Usage and Params
const record = await w.rules.get('0x9c1e...');                  // one rule by id
// rulesId   Hex, required   the id returned by create or rules.add

// Returns
// <Object> RulesRecord
{
  rulesId: '0x9c1e...',
  enabled: true,
  chainNamespace: 'eip155:11155111',
  agent: '0xAgentOnPush',
  validUntil: 1767225600,
  ref: '0x4a2f...',
  rule: { /* decoded UniversalRule */ },
  spent: { kind: 'universal', amountSpent: 25000000n }          // shape PROPOSED, see 3.b
}
```

`spent` is a field on the record, so `get` and `list` both carry it. There is no separate spent call.

### 1.k Add rules - `w.rules.add`

Grants new rules on an existing wallet under one signature. The rules array comes first; `agent` and `ref` live on each rule.

```tsx
// Function
const res = await w.rules.add(rules, { options? })

// Usage and Params
const one     = await w.rules.add([nativeRule]);                // one rule
const many    = await w.rules.add([ruleOnSepolia, ruleOnPush]); // several rules, one signature
const tracked = await w.rules.add([nativeRule], { progressHook: (p) => console.log(p.id, p.message) });   // with progress events
// rules                  Rule[], required     one per chain per agent; each rule carries its own agent and optional ref
// options.progressHook   function, optional   progress events, AGENTIC-TX-104; default none

// Returns
// <Object> { rulesIds, tx }
{
  rulesIds: ['0x7d3a...'],                                      // in the order of the rules you passed
  tx: {                                                         // UniversalTxResponse
    hash: '0x4c19...',
    origin: 'eip155:11155111:0x31dC...',
    from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',
    blockNumber: 1501n,
    wait
  }
}
```

Records a `RULES_GRANTED` checkpoint.

### 1.l Update rules - `w.rules.update`

Replaces rules in a batch: each pair names one old rule and the one new rule that takes its place.

```tsx
// Function
const res = await w.rules.update({ rules, progressHook? })

// Usage and Params
const one     = await w.rules.update({ rules: [{ rulesId: '0x9c1e...', rule: newRule }] });                          // replace one rule
const many    = await w.rules.update({ rules: [{ rulesId: idA, rule: ruleA }, { rulesId: idB, rule: ruleB }] });   // replace several, one signature
const tracked = await w.rules.update({ rules: [{ rulesId: idA, rule: ruleA }], progressHook: (p) => console.log(p.id) });   // with progress events
// rules             Array<{ rulesId, rule }>, required   one old rule to one new rule per pair
// rules[].rulesId   Hex, required                        the rule being replaced
// rules[].rule      Rule, required                       the replacement; one rule per agent per chain still applies
// progressHook      function, optional                   progress events, AGENTIC-TX-105 and 104; default none

// Returns
// <Object> { rules: Array<{ rulesId, replaced }>, tx }
{
  rules: [
    { rulesId: '0x51c0...', replaced: '0x9c1e...' },            // new id, old id
  ],
  tx: {                                                         // UniversalTxResponse
    hash: '0x7a02...',
    origin: 'eip155:11155111:0x31dC...',
    from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',
    blockNumber: 1507n,
    wait
  }
}
```

Rules are immutable on-chain, so an update is a revoke plus a grant: for each pair the SDK asserts the old rule's spend, revokes it and grants the new one, all pairs in one multicall. The result is a new `rulesId` per pair, and the spend counters reset on the new rule: what the old rule had spent does not carry over. This is accepted for v1 (open item 1); an in-place update would be a contract change and there is no demand for it yet.

### 1.m Revoke rules - `w.rules.revoke`

Revokes some rules by id, or all of them in one atomic call.

```tsx
// Function
const tx = await w.rules.revoke(rulesIds, { options? })
const tx = await w.rules.revoke({ all, progressHook? })

// Usage and Params
const some    = await w.rules.revoke(['0x9c1e...', '0x7d3a...']);                                // revoke these rules
const all     = await w.rules.revoke({ all: true });                                             // revoke every rule, on-chain revokeAllRules
const tracked = await w.rules.revoke(['0x9c1e...'], { progressHook: (p) => console.log(p.id) }); // with progress events
// rulesIds               Hex[], required unless all is set     the rules to revoke
// options.progressHook   function, optional                    progress events, AGENTIC-TX-105; default none
// all                    true, required unless rulesIds given  revoke every rule on the wallet in one atomic call
// progressHook           function, optional                    same events, in the { all: true } form; default none

// Returns
// <UniversalTxResponse> { hash, origin, from, to, blockNumber, wait() }
{
  hash: '0x8e01...',
  origin: 'eip155:11155111:0x31dC...',                          // the owner's key, CAIP-10
  from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',           // the owner's Push account
  to: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',             // the wallet
  blockNumber: 1512n,
  wait                                                          // await tx.wait() for the receipt; status lives on the receipt
}
```

A bare `revoke()` is not allowed and throws `REVOKE_NEEDS_TARGET`: a call with no argument that wipes every rule is too easy to make by mistake. Records `RULES_REVOKED` checkpoints.

# 2. Agent side, by example

There is no new method on the agent side. The agent uses its own signer and tells `initialize` which wallet to act through. It does not name a rule: which rule applies is decided per transaction, from the destination chain.

### 2.a Act as the wallet - `PushChain.initialize` with `agenticWallet` (updated)

Returns a client whose account is the wallet. Whether its sends go through the owner door or the agent door depends on who the signer is.

```tsx
// Function
const client = await PushChain.initialize(signer, { options })

// Usage and Params
const agentClient = await PushChain.initialize(agentSigner, {   // agent door: the signer is named as agent in a rule
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
  agenticWallet: '0xWallet',
});
const ownerClient = await PushChain.initialize(ownerSigner, {   // owner door: the signer owns the wallet
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
  agenticWallet: '0xWallet',
});
```

`agentSigner` is any signer `initialize` accepts today. If the key lives on another chain, the SDK derives its UEA and everything goes through that, as it does for every external user.

Which door the client uses depends on who the signer is. If the signer is the wallet's owner, sends go through the owner door: no rules, and every send is recorded as a checkpoint. If the signer is an address named as agent in one of the wallet's rules, sends go through the agent door and the rules apply. If it is neither, `initialize` throws `NOT_OWNER_OR_AGENT`. If the address has no wallet deployed yet it throws `WALLET_NOT_DEPLOYED`, and if the address is not an agentic wallet it throws `NOT_AGENTIC_WALLET`. This is also how an owner acts as the wallet with the full client: `PushChain.initialize(ownerSigner, { agenticWallet })`. There is one way to send as a wallet and the signer decides the door.

On the agent door the SDK sends; URP on-chain is the only rule checker. Before sending, the SDK only looks up the `rulesId` for the destination chain: the rule that is enabled, whose `agent` equals the signer, and whose `chainNamespace` equals the destination. The lookup is one read on every send, not cached at initialize. If none is found it throws `NO_RULES_FOR_CHAIN` before any signature, so it costs nothing; otherwise it calls `executeAsAgent(rulesId, ...)` on the wallet. That is the agent door from D3 on [1. AGW Contract Changes (nomenclature standard + change set)](1-agw-contract-changes.md): there is no session validator, and the wallet only checks that `msg.sender` is the rule's agent. There is one rule per (agent, chain), so a signer and a destination match at most one rule. If the action breaks a rule, it reverts on-chain and the agent pays that gas. `sendTransaction` then throws `AgenticRevertError`, which extends core's `PushChainExecutionError` and carries URP's custom error in `decodedError`, so the agent sees which gate failed (3.f).

From an external key, the call arrives through the agent's UEA. If the agent's UEA is not yet deployed, the first action takes the origin-chain fee lock once (minimum $1), which deploys the UEA and funds it with PC. Every later action requires PC in the UEA and is a direct Push transaction paid from that balance, with no origin transaction and no cross-chain wait.

Two things for whoever runs the agent. The agent's UEA is a second balance to keep funded: the AGW's PC covers the wallet's outbound fees, not the agent's gas. And in `agenticWallet` mode the SDK turns `enforceGasCheck` on for every action except that one first action while the agent's UEA is not yet deployed, so an empty UEA fails loudly instead of silently falling back to a $1 origin lock and a confirmation wait on every action.

Routing. In `agenticWallet` mode every send is wrapped as `executeAsAgent` (agent door) or `execute` (owner door), and for cross-chain legs the AGW itself calls the gateway. So the AGW's CEA executes on the destination and the AGW's PC pays as `msg.value`. The SDK never uses the signer's own Route 2, which would run through the agent's CEA instead of the wallet's. Any `from` (Routes 3 and 4) is rejected in `agenticWallet` mode with `FROM_NOT_ALLOWED`: it makes `msg.sender` a CEA, and the agent door check fails.

What changes on the client in this mode:

- `universal.account` is the wallet address string, so receipts show the AGW as `from`. `universal.origin` stays the signer's origin account.
- `getAccountStatus()` reports the signer's own UEA, not the wallet.
- The signer is whatever was passed to `initialize`. To top up the agent's UEA, find it with `PushChain.utils.account.deriveExecutorAccount(signer.account)` and send PC to it from a client initialized without `agenticWallet`.
- A Solana-keyed agent can act on Push and `eip155` destinations now, and on `solana:` destinations once the SVM rulebook ships.
- Agents read their own rules through `client.agentic.wallet(addr).rules.list()`.
- `tx.data` arrays and `tx.funds` (moving the AGW's PRC20) work as they do for any account.
- `payGasWith`, `migrateCEA`, `rescueFunds`, `prepareTransaction` and `executeTransactions` throw `NOT_ALLOWED_IN_AGENTIC_MODE`.

```tsx
const tx = await agentClient.universal.sendTransaction({        // agent door, rule picked by the destination chain
  to: { address: aavePool, chain: CHAIN.ETHEREUM_SEPOLIA },
  data: supplyData,
});

// tx: UniversalTxResponse
{
  hash: '0x6f2a...',
  origin: 'eip155:11155111:0x7Be1...',                          // the agent's key, CAIP-10
  from: '0xWallet',                                             // the AGW, not the signer
  blockNumber: 1530n,
  wait
}

const receipt = await tx.wait();
// receipt: UniversalTxReceipt
{
  status: 1,
  hash: '0x6f2a...',
  from: '0xWallet',
  blockNumber: 1530n,
  externalTxHash: '0x91c4...'                                   // the leg executed by the AGW's CEA on Sepolia
}
```

The same EVM key initialized against two chains yields two UEAs (derived from namespace, chainId and owner), so the rule must name the UEA of the chain this client initializes against (see 1.b).

# 3. Types

### 3.a Client, options and namespace

```tsx
type Address = `0x${string}`;
type Hex     = `0x${string}`;
type ForeignChainNamespace = `eip155:${string}` | `solana:${string}`;
type ProgressHook = (p: ProgressEvent) => void;                   // ProgressEvent is core's shape: { id, title, message, level, response, timestamp }

interface PushChainClient {
  universal:  UniversalNamespace;    // in agenticWallet mode: account is the wallet
  agentic:    AgenticNamespace;      // this page
  market:     MarketNamespace;       // page 6
  job:        JobNamespace;          // page 7
  evaluation: EvaluationNamespace;   // page 8
}

interface InitializeOptions {
  network?: PUSH_NETWORK;
  rpcUrls?: Partial<Record<CHAIN, string[]>>;
  agenticWallet?: Address;                                        // NEW: act as the wallet; door chosen by the signer's Push address
  // enforceGasCheck is on when agenticWallet is set, except for the first action while the agent's UEA is not yet deployed (2.a)
}

interface AgenticNamespace {
  derive(opts?: { index?: number }): Promise<{ address: Address; index: number; deployed: boolean }>;
  create(label: string, options: CreateOptions): Promise<CreateResult>;
  list(): Promise<{ wallets: WalletSummary[] }>;                  // connected signer only
  wallet(address: Address): AgenticWallet;
}

interface CreateOptions {
  rules: Rule[];                                                  // one entry per chain per agent, may be empty; each rule names its agent and optional ref
  progressHook?: ProgressHook;                                    // AGENTIC-TX-1xx
}

// No AgentKey type, no curve, no chain. The agent is a Push address. A native key is its own EOA; any external key
// (EVM, Solana, anything) is its UEA, deterministic from (chain, owner), deployed lazily on first use. The AGW's agent
// door checks msg.sender == rules.agent; cross-VM signature verification already happened inside the UEA (page 1, D3).

interface CreateResult  { wallet: Address; index: number; rulesIds: Hex[]; tx: UniversalTxResponse }
interface WalletSummary { address: Address; index: number; label: string; deployed: boolean; rulesCount: number }
```

### 3.b Rules

```tsx
type Rule = NativeRule | UniversalRule;                           // chainNamespace decides the rulebook: omitted = native, foreign = universal

interface NativeRule {
  agent: Address;                                                 // Push address: EOA, or the UEA of an external key (PushChain.utils.account.deriveExecutorAccount)
  ref?: Hex;                                                      // emitted in RulesGranted, not interpreted
  chainNamespace?: never;                                         // omitted = the connected Push chain
  target: Address;
  selector: Selector | 'value-only';
  validUntil: number;
  maxValuePerCall?: bigint;  maxValueTotal?: bigint;  maxCalls?: number;
  pins?:   { arg: number; expected: Hex | Address | bigint }[];
  amount?: { arg: number; maxPerCall: bigint; maxTotal?: bigint };
}

interface UniversalRule {
  agent: Address;                                                 // same as NativeRule.agent
  ref?: Hex;                                                      // same as NativeRule.ref
  chainNamespace: ForeignChainNamespace;                          // "eip155:..." now; "solana:..." once the SVM rulebook ships
  assets: AssetCap[];                                             // tokens the agent may move on chainNamespace; SDK resolves each to its PRC20 and asserts SOURCE_CHAIN_NAMESPACE
  maxGasPerCall: bigint;                                          // PC (wei) per outbound for the destination leg
  validUntil: number;
  allowedCalls: AllowedCall[];                                    // 1..32, all on chainNamespace
}

interface AssetCap {
  token: MoveableToken | Address;                                 // the other chain's token address (MOVEABLE.TOKEN.<CHAIN>.<SYMBOL>) or the native marker; the contract stores the PRC20
  maxPerCall: bigint;
  maxTotal?: bigint;
}

type Selector = Hex | `${string}(${string})`;                     // '0x617ba037' or 'supply(address,uint256,address,uint16)'

interface AllowedCall { target: Address; selector: Selector; beneficiary?: number; maxValue?: bigint }   // beneficiary = arg index

interface RulesRecord {
  rulesId: Hex;
  enabled: boolean;
  chainNamespace: string;
  agent: Address;                                                 // the Push address granted
  validUntil: number;
  ref: Hex;
  rule: Rule;                                                     // decoded terms; NativeRule or UniversalRule
  spent: Spent;                                                   // carried by rules.get and rules.list; no separate call
}

type Spent = { kind: 'universal'; amountSpent: bigint } | { kind: 'native'; valueSpent: bigint; amountSpent: bigint; callsUsed: number };   // PROPOSED: one self-describing object, readable without knowing the rulebook
```

### 3.c Wallet handle and checkpoints

```tsx
interface AgenticWallet {
  address: Address;
  info(): Promise<WalletInfo>;
  owner(): Promise<{ owner: Address }>;                           // Push address as stored
  setLabel(label: string, opts?: { progressHook?: ProgressHook }): Promise<UniversalTxResponse>;   // PROPOSED, page 1 item 10
  checkpoints(opts?: { sinceBlock?: bigint }): Promise<{ checkpoints: Checkpoint[] }>;
  rules: {
    list(): Promise<{ rules: RulesRecord[] }>;
    get(rulesId: Hex): Promise<RulesRecord>;
    add(rules: Rule[], opts?: { progressHook?: ProgressHook }): Promise<{ rulesIds: Hex[]; tx: UniversalTxResponse }>;
    update(params: { rules: { rulesId: Hex; rule: Rule }[]; progressHook?: ProgressHook }): Promise<{ rules: { rulesId: Hex; replaced: Hex }[]; tx: UniversalTxResponse }>;   // revoke plus grant; spend counters reset
    revoke(rulesIds: Hex[], opts?: { progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
    revoke(params: { all: true; progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
  };
}

interface WalletInfo { address: Address; label: string; index: number; owner: Address; deployed: boolean; rulesCount: number }

interface Checkpoint { seq: number; kind: 'OWNER_ACTION' | 'RULES_GRANTED' | 'RULES_REVOKED'; ref: Hex; blockNumber: bigint; txHash: Hex }
```

### 3.d Constants, PushChain.CONSTANTS.AGENTIC (new)

```tsx
PushChain.CONSTANTS.AGENTIC[PUSH_NETWORK.TESTNET_DONUT] = {
  FACTORY, RULES_POLICY,                                 // RULES_POLICY is URP; no validator address (page 1, D3)
  MAX_PINS: 8, MAX_ALLOWED_CALLS: 32, ENVELOPE_VERSION: 1,
};
```

### 3.e Helpers, PushChain.utils.agentic (new)

Pure functions with the same output as the on-chain views.

```tsx
PushChain.utils.agentic = {
  rulesId(agent, chainNamespace, grantNonce),            // the id a grant produces, same as the contract assigns
  actionId(target, selector),                            // id of one allowed call: hash of its target and selector
  configId(wallet, rulesId, actionId),                   // key of one allowed call's stored config, under one rule on one wallet
  encodeRules(rules, ctx),                               // ctx = wallet and chain context needed to resolve beneficiary offsets
  decodeRules(bytes),
  deriveWallet(owner, index),                            // any-owner variant of client.agentic.derive
  compileCard(card, userInput, ctx),                     // used by page 6; lives here because it produces Rule[]
};
```

### 3.f Errors and progress

```tsx
class AgenticError       extends Error                   { code: string; hint?: string }
class AgenticRevertError extends PushChainExecutionError {}
// decoded custom error from the AGW, URP or the factory; uses core's fields:
//   code           string
//   decodedError   { name, hint, selector, decoded }

// codes
//   create:                     AGENT_IS_OWNER, DUPLICATE_RULE, TARGET_NOT_ON_RULE_CHAIN, ASSET_CHAIN_MISMATCH
//   initialize (agenticWallet): NOT_OWNER_OR_AGENT, WALLET_NOT_DEPLOYED, NOT_AGENTIC_WALLET
//   rules.revoke:               REVOKE_NEEDS_TARGET (bare revoke)
//   sendTransaction:            NO_RULES_FOR_CHAIN, FROM_NOT_ALLOWED (any from, Routes 3 and 4)
//   agentic mode:               NOT_ALLOWED_IN_AGENTIC_MODE (prepareTransaction, executeTransactions, payGasWith, migrateCEA, rescueFunds)

// progress events, AGENTIC-TX (PROPOSED)
//   AGENTIC-TX-101      wallet derived               { address, index, deployed }
//   AGENTIC-TX-102      deploy step added
//   AGENTIC-TX-104      rules granted                { rulesIds }
//   AGENTIC-TX-105      rules revoked                { rulesIds | all }
//   AGENTIC-TX-106      label set
//   AGENTIC-TX-107      rule resolved for a send     { rulesId, chainNamespace, door }
//   AGENTIC-TX-199-01   done
//   AGENTIC-TX-199-02   failed                       { code, decodedError }
// The Push leg of any agentic send also emits core's SEND-TX-1xx events.
// A cross-chain leg sent by the AGW emits 209-xx and 299-xx, never 201 to 204 (the signer's own Route 2 is never used).
```

**PROPOSED:** the AGENTIC-TX event list. Every write (`create`, `setLabel`, `rules.add`, `rules.update`, `rules.revoke`) takes a per-call `progressHook`; a `progressHook` passed to `PushChain.initialize` runs alongside it, as in core.

`NO_RULES_FOR_CHAIN` is thrown before any signature and costs nothing. The rules lookup is one read on every send, not cached at initialize. A URP revert is thrown from `sendTransaction` as `AgenticRevertError` and also lands as `decodedError` on AGENTIC-TX-199-02. A destination-chain revert after URP passed still counts the spend, because the spend is counted when the outbound leaves Push; whether it is credited back depends on [1. AGW Contract Changes (nomenclature standard + change set)](1-agw-contract-changes.md) item 6 (`creditRevert`).

# 4. Outside change: [PushChain.CONSTANTS.READ](http://PushChain.CONSTANTS.READ).CHAIN (confirmed 2026-09-28)

Problem: `read()` takes `chain: PushChain.CONSTANTS.CHAIN.X`, but `CHAIN` is the set of blockchains the SDK signs for and routes to. Web2 is not one, so `CHAIN.WEB2` exists as a hidden (non-enumerable) member: it works if you know it is there and never appears in any listing. Reads have a wider domain than transactions: anything validators can observe.

Change: a read-specific constant that is a superset of `CHAIN`. The field name stays `chain`, so nothing breaks, and `CHAIN` values remain valid because the strings are identical.

```tsx
PushChain.CONSTANTS.READ.CHAIN = {
  ...PushChain.CONSTANTS.CHAIN,          // every real chain, same string values
  WEB2: 'web2',                          // non-chain source, first-class here, enumerable
};
type ReadChain = CHAIN | 'web2';         // ReadParams.chain: ReadChain

read({ chain: PushChain.CONSTANTS.READ.CHAIN.WEB2, ... })
read({ chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA, ... })   // still compiles
```

- `CHAIN.WEB2` becomes a deprecated alias of `READ.CHAIN.WEB2` for one release (the docs listed it on 2026-09-22), then goes.
- Anything that iterates `CHAIN` stops seeing a fake chain; anything that iterates `READ.CHAIN` sees every read source.
- The evaluator's `Read.chain` (page 8) takes the same values, so `READ.CHAIN` is the one constant the read SDK and the criteria compiler share.

# 5. Open for review

1. `rules.update` resets spend counters because it is revoke plus grant. Accepted for v1 and stated in 1.l; an in-place update is a contract change with no demand yet.
2. `setLabel` assumes [1. AGW Contract Changes (nomenclature standard + change set)](1-agw-contract-changes.md) item 10 lands. Pointer for the team.