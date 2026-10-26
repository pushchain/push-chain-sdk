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
- `~~PushChain.utils.agentic~~` (dropped 12 Oct 2026, see 6.h)

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

For a Push EOA owner the same thing needs a batching entry on the factory, because core rejects multicall from a Push-native sender: [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21) item 11, **PROPOSED** (`createWallet(label, rules[])` on the factory). Until it lands the SDK sends deploy and grant as separate transactions and says so through progress events (AGENTIC-TX-102 and 104); `tx` is then the last of them.

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

**PROPOSED**, contract change, see [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21) item 10. Changes the label shown in `list()` and `info()`; owner only.

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

On the agent door the SDK sends; URP on-chain is the only rule checker. Before sending, the SDK only looks up the `rulesId` for the destination chain: the rule that is enabled, whose `agent` equals the signer, and whose `chainNamespace` equals the destination. The lookup is one read on every send, not cached at initialize. If none is found it throws `NO_RULES_FOR_CHAIN` before any signature, so it costs nothing; otherwise it calls `executeAsAgent(rulesId, ...)` on the wallet. That is the agent door from D3 on [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21): there is no session validator, and the wallet only checks that `msg.sender` is the rule's agent. There is one rule per (agent, chain), so a signer and a destination match at most one rule. If the action breaks a rule, it reverts on-chain and the agent pays that gas. `sendTransaction` then throws `AgenticRevertError`, which extends core's `PushChainExecutionError` and carries URP's custom error in `decodedError`, so the agent sees which gate failed (3.f).

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

### ~~3.d Constants, PushChain.CONSTANTS.AGENTIC (new)~~

Dropped on 12 Oct 2026, except `WALLET`. See 6.h.

```tsx
PushChain.CONSTANTS.AGENTIC[PUSH_NETWORK.TESTNET_DONUT] = {
  FACTORY, RULES_POLICY,                                 // RULES_POLICY is URP; no validator address (page 1, D3)
  MAX_PINS: 8, MAX_ALLOWED_CALLS: 32, ENVELOPE_VERSION: 1,
};
```

### ~~3.e Helpers, PushChain.utils.agentic (new)~~

Dropped on 12 Oct 2026. See 6.h.

~~Pure functions with the same output as the on-chain views.~~

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

`NO_RULES_FOR_CHAIN` is thrown before any signature and costs nothing. The rules lookup is one read on every send, not cached at initialize. A URP revert is thrown from `sendTransaction` as `AgenticRevertError` and also lands as `decodedError` on AGENTIC-TX-199-02. A destination-chain revert after URP passed still counts the spend, because the spend is counted when the outbound leaves Push; whether it is credited back depends on [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21) item 6 (`creditRevert`).

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
2. `setLabel` assumes [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21) item 10 lands. Pointer for the team.

# 6. Changes proposed on 12 Oct 2026

These come from the review of the first SDK implementation, [push-chain-sdk PR #291](https://github.com/pushchain/push-chain-sdk/pull/291). Sections 1 to 5 above are left exactly as they were. Where an entry here differs from them, the entry here is the current one. Every function whose call or result changes is written out again in full, so the change can be read without scrolling up.

Contract changes are written on [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21) (page 1), section 6, and are referenced from here by item number.

| # | Change | Replaces above | Contract change (page 1) |
| --- | --- | --- | --- |
| 6.a | One rule shape for every chain, pins inside `allowedCalls`, `beneficiary` folded into pins | 3.b `NativeRule`, `UniversalRule` | 6.3 |
| 6.b | `create` is one transaction for every owner; `ref` removed; omitted caps are 0 | 1.b | 6.2, 6.4, 6.5 |
| 6.c, 6.d | `rules.list` and `rules.get`: `spent` per asset, no `ref`, arguments read back as `arg` | 1.i, 1.j | none |
| 6.e | `rules.add` and `rules.update`: call unchanged, new rule shape | 1.k, 1.l | none |
| 6.f | `setLabel` is never a checkpoint | 1.g | none |
| 6.g | Sending as the wallet: no gateway approval step, first-use gas default | 2.a | 6.1 |
| 6.h | Types, as they end up | 3.b, `RulesRecord`, `Spent`, 3.d, 3.e | none |
| 6.i | Solana: same rule shape, pins on arguments and on accounts, no IDL in a rule | new | none |
| 6.l | Response fields and error codes added by the first implementation: accepted, with four codes removed | 3.f | none |
| 6.m | `rules.revoke` is renamed `rules.delete` | 1.m | none |

### 6.a One rule shape for every chain

There is one rule shape. A rule for calls on Push is the same object as a cross-chain rule with `chainNamespace` left out. What the agent may call is always a list of `allowedCalls`, and restrictions on a function's arguments sit inside each allowed call as `pins`.

A pin restricts one argument of the allowed function. It is either `expected` (the argument must equal this constant) or `max` (the argument must not exceed this number). To require that an argument is the wallet itself, the expected value is `PushChain.CONSTANTS.AGENTIC.WALLET`. A minimum on an argument (for example a minimum amount out on a swap) is not part of v1 and is deferred to the next version.

```tsx
// a rule on Push: chainNamespace left out
{
  agent: '0xAgentOnPush',
  validUntil: now + 30 * 86400,
  allowedCalls: [
    { target: vault, selector: 'deposit(address,uint256)',
      pins: [
        { arg: 0, expected: beneficiary },                       // argument 0 must be this address
        { arg: 1, max: parseUnits('10', 18) },                   // argument 1 must not exceed this, per call
      ] },
  ],
}

// a rule on Ethereum Sepolia: same shape, plus the tokens the agent may move
{
  agent: '0xAgentOnPush',
  chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
  assets: [
    { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC, maxPerCall: parseUnits('100', 6), maxTotal: parseUnits('1000', 6) },
  ],
  maxGasPerCall: parseUnits('1', 18),
  validUntil: now + 30 * 86400,
  allowedCalls: [
    { target: aavePool, selector: 'supply(address,uint256,address,uint16)',
      pins: [
        { arg: 0, expected: usdcSepolia },                         // asset must be USDC
        { arg: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET },  // onBehalfOf must be this wallet
      ] },
    { target: usdcSepolia, selector: 'approve(address,uint256)' },
  ],
}
```

What is gone from the shape: the separate `NativeRule` type with `target`, `selector`, `pins` and `amount` at the top of the rule, and the fields `amount.maxTotal`, `maxValueTotal` and `maxCalls`. A `max` pin limits each call only. The SDK has no per-argument lifetime total and no call counter. On a cross-chain rule the lifetime limit on a token is the asset's `maxTotal`. On a Push call the lifetime limit is what the owner funds the wallet with, plus `validUntil`.

`beneficiary` is now a pin. On page sections above, `beneficiary: 2` meant that argument 2 must be the wallet's own account. That is a pin whose expected value is the wallet, so it is written as `{ arg: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET }` and the separate field is removed. `WALLET` stands for the wallet's own account on the rule's chain: the AGW address for a call on Push, and the wallet's CEA for a call on another chain. The SDK fills in the real address when the rule is granted, so nobody has to look up a CEA. It is a marker and not an address (its value is the string `'agentic:wallet'`), because an agent card lists its rules before any wallet exists. On read, a pin whose stored value is the wallet's own account comes back as `WALLET`.

Where each part is checked. Every check runs on Push, in the rules policy, before the wallet is allowed to make the call or hand it to the gateway.

| On an allowed call | Call on Push | Call on an EVM destination |
| --- | --- | --- |
| `target`, `selector`, `maxValue` | Checked | Checked |
| A pin with `expected: WALLET` | Checked | Checked. One per call until page 1, 6.3 lands |
| Any other pin | Checked. Up to 8 `expected` pins and one `max` pin per call | Needs page 1, 6.3. Until it lands the SDK rejects it before signing |

### 6.b Create an agentic wallet - `client.agentic.create` (changed)

Deploys the wallet and grants the rules in one transaction, for every kind of owner. Either the wallet exists with every rule that was passed, or nothing happened.

```tsx
// Function
const created = await client.agentic.create(label, { options })

// Usage and Params
const created = await client.agentic.create('aave-optimiser', {    // wallet with one cross-chain rule
  rules: [{                                                      // one entry per chain per agent
    agent: '0xAgentOnPush',                                      // a Push address: the agent's EOA, or its UEA if the key lives on another chain. Never the owner
    chainNamespace: CHAIN.ETHEREUM_SEPOLIA,                      // left out = a rule for calls on Push
    assets: [
      { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC, maxPerCall: parseUnits('100', 6), maxTotal: parseUnits('1000', 6) },
      { token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.WETH, maxPerCall: parseUnits('0.5', 18), maxTotal: parseUnits('2', 18) },
    ],
    maxGasPerCall: parseUnits('1', 18),                          // PC (wei) per outbound for the destination leg
    validUntil: now + 30 * 86400,
    allowedCalls: [
      { target: aavePool,    selector: 'supply(address,uint256,address,uint16)',
        pins: [{ arg: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET }] },   // onBehalfOf must be this wallet (its CEA on Sepolia)
      { target: usdcSepolia, selector: 'approve(address,uint256)' },
    ],
  }],
  progressHook: (p) => console.log(p.id, p.message),             // AGENTIC-TX-1xx
});
const bare = await client.agentic.create('scratch', { rules: [] });   // wallet first, rules later with rules.add
// label                          string, required                     shown in list() and info(); the contract stores it
// options.rules                  Rule[], required                     one per chain per agent, may be empty; shape in 6.a
// options.progressHook           function, optional                   progress events, AGENTIC-TX-1xx; default none
// rules[].agent                  Address, required                    the Push address allowed to act under this rule; never the owner
// rules[].chainNamespace         string, optional                     the chain the rule governs; left out = Push
// rules[].assets                 AssetCap[], cross-chain rules        tokens the agent may move; each cap is { token, maxPerCall, maxTotal }
// rules[].assets[].maxTotal      bigint, optional                     lifetime cap for that token; left out = 0, and 0 means the agent cannot move it
// rules[].maxGasPerCall          bigint, cross-chain rules            PC (wei) the wallet may spend per outbound for the destination leg
// rules[].allowedCalls           AllowedCall[], required              what the agent may call; each is { target, selector, pins?, maxValue? }
// rules[].allowedCalls[].maxValue   bigint, optional                  native coin per call; left out = 0
// rules[].allowedCalls[].pins    Pin[], optional                      { arg, expected } or { arg, max }; expected may be PushChain.CONSTANTS.AGENTIC.WALLET; see 6.a

// Returns
// <Object> { wallet, index, rulesIds, tx }
{
  wallet: '0x2Fd904d6f2C0b34d58426C8Ae9c5267E845CE98f',
  index: 0,
  rulesIds: ['0x9c1e...'],                                       // in the order of the rules you passed; empty for rules: []
  tx: {                                                          // UniversalTxResponse, always a single transaction
    hash: '0xb527...',
    origin: 'eip155:11155111:0x31dC...',                         // the owner's key, CAIP-10
    from: '0xFd6C2fE69bE13d8bE379CCB6c9306e74193EC1A9',          // the owner's Push account
    blockNumber: 1290n,
    wait                                                         // await tx.wait() for the receipt; status lives on the receipt
  }
}
```

What changed from 1.b:

- **One transaction for every owner.** 1.b said a Push EOA owner gets separate deploy and grant transactions until a factory entry lands. That fallback is removed. The factory entry is page 1, 6.2. There is no partial result to reconcile.
- **`ref` is removed** from every rule. The `rulesId` the grant returns is what a job, a card or an indexer latches on to. Page 1, 6.4.
- **A cap that is left out is 0, never unlimited.** That covers `assets[].maxTotal` and `allowedCalls[].maxValue`. A forgotten cap means the agent cannot move that asset, which shows up on the first send. Page 1, 6.5. Note that the WETH line in 1.b had no `maxTotal`; under this rule it would move nothing, so the example here sets one.
- **Rules use the single shape from 6.a.**
- **The beneficiary field is a pin.** `beneficiary: 2` is written as a pin on argument 2 whose expected value is `PushChain.CONSTANTS.AGENTIC.WALLET` (6.a).

### 6.c List rules - `w.rules.list` (changed)

Returns every enabled rule on the wallet as a decoded record, including what each rule has spent so far.

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
      rule: { /* the rule in the 6.a shape, accepted as is by rules.update */ },
      spent: {                                                  // one entry per asset, same order as rule.assets
        kind: 'universal',
        assets: [
          { token: '0x1c7D...7238', spent: 25000000n },         // USDC
          { token: '0xfFf9...6B14', spent: 0n },                // WETH
        ]
      }
    }
  ]
}
```

### 6.d Get one rule - `w.rules.get` (changed)

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
  rulesId: '0x51c0...',
  enabled: true,
  chainNamespace: 'eip155:42101',                               // a rule on Push
  agent: '0xAgentOnPush',
  validUntil: 1767225600,
  rule: {
    agent: '0xAgentOnPush',
    validUntil: 1767225600,
    allowedCalls: [
      { target: '0xVault', selector: 'deposit(address,uint256)',
        pins: [
          { arg: 0, expected: '0x00000000000000000000000000000000000000000000000000000000000b0b0b' },
          { arg: 1, max: 10000000000000000000n },
        ] },
    ],
  },
  spent: { kind: 'native', valueSpent: 0n, amountSpent: 5000000000000000000n, callsUsed: 1 }
}
```

What changed from 1.i and 1.j:

- **`spent` is on every record**, as 1.i and 1.j already said. The first implementation dropped it; it goes back. For a cross-chain rule it is now a list with one entry per asset, because each asset has its own budget. 1.i showed a single `amountSpent`, which predates per-asset budgets.
- **`ref` is removed** from the record, following 6.b.
- **Arguments read back as `arg`, never as a byte offset.** The contract stores a pin and a beneficiary as a byte position in the calldata (argument 0 is byte 4, argument 1 is byte 36). The SDK converts that back, so a developer who wrote `arg: 0` reads `arg: 0`. A pin on the wallet itself reads back as `WALLET`.
- **The record is accepted by `rules.update` without edits.** The test is: read a rule, change `validUntil`, pass it back. An `expected` value reads back as 32-byte hex, because the contract keeps the function selector and not the argument types; it is accepted as input in that form.

### 6.e Add and update rules - `w.rules.add`, `w.rules.update` (call unchanged)

The calls and results in 1.k and 1.l stay as they are. Two things change through the rule itself: rules are in the 6.a shape, and they carry no `ref`.

### 6.f Set the wallet label - `w.setLabel` (changed)

Changes the label shown in `list()` and `info()`. Owner only.

```tsx
// Function
const tx = await w.setLabel(label, { options? })

// Usage and Params
const tx      = await w.setLabel('aave-optimiser-v2');                                          // rename the wallet
const reset   = await w.setLabel('');                                                           // back to the default label
const tracked = await w.setLabel('aave-optimiser-v2', { progressHook: (p) => console.log(p.id) });   // with progress events
// label                  string, required     the new label, at most 64 bytes of UTF-8; an empty string resets it to the default "AGW <index + 1>"
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

What changed from 1.g: the function is live in the contract, so it is no longer proposed. The rule that a rename is not a checkpoint now binds the SDK too. The first implementation sent the rename through the owner door, and every owner door call records an `OWNER_ACTION` checkpoint. With the checkpoint rule for 8183 jobs, a user who renamed a wallet during a job would hand the fee to the agent over a label. The SDK must call the wallet's `setLabel` directly, for a Push EOA owner and for a UEA owner, so that the checkpoint count is the same before and after a rename.

### 6.g Send as the wallet - `sendTransaction` with `agenticWallet` (changed)

The call is the one in 2.a. Two things around it change.

```tsx
// Function
const tx = await client.universal.sendTransaction({ options })

// Usage and Params
const agentClient = await PushChain.initialize(agentSigner, {   // agent door: the signer is named as agent in a rule
  network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET,
  agenticWallet: '0xWallet',
});
const tx = await agentClient.universal.sendTransaction({        // rule picked by the destination chain
  to: { address: aavePool, chain: CHAIN.ETHEREUM_SEPOLIA },
  data: [
    { to: usdcSepolia, value: 0n, data: approveData },
    { to: aavePool,    value: 0n, data: supplyData },
  ],
  funds: { amount: parseUnits('100', 6), token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC },
});
// to         { address, chain }, required   the destination call and its chain
// data       Hex or call array, optional    the destination call data
// funds      { amount, token }, optional    the token the wallet moves with this send
// gasLimit   bigint, optional               destination gas; left out = the SDK default, which covers first use on a chain (see below)

// Returns
// <UniversalTxResponse> { hash, origin, from, blockNumber, wait() }
{
  hash: '0x6f2a...',
  origin: 'eip155:11155111:0x7Be1...',                          // the agent's key, CAIP-10
  from: '0xWallet',                                             // the AGW, not the signer
  blockNumber: 1530n,
  wait
}
```

What changed from 2.a:

- **No gateway approval step.** When the wallet sends a token to another chain, the gateway on Push takes the token out of the wallet, which needs an ERC20 approval from the wallet. The first implementation left that to the owner as a separate transaction through the owner door before the agent's first send. That step is removed: the wallet approves the exact amount inside its own outbound call (page 1, 6.1). Funding a wallet is two plain transfers to its address, PC and the token. The SDK has no allowance check and no allowance error.
- **The default destination gas covers first use on a chain.** The first time a wallet sends to a chain, its account there (the CEA) is deployed as part of the call, which took about 1.3 million gas on Sepolia against a core default of 500,000. When the CEA is not deployed yet and the caller gave no `gasLimit`, the SDK uses a first-use default large enough for the deployment. When the CEA exists, the normal default applies. A `gasLimit` from the caller always wins, and `maxGasPerCall` on the rule still bounds what the agent can spend.

### 6.h Types, as they end up

These replace `NativeRule`, `UniversalRule`, `AllowedCall`, `RulesRecord` and `Spent` in 3.b. Everything else in section 3 stands.

```tsx
interface Rule {
  agent: Address;                                                 // Push address: EOA, or the UEA of an external key
  chainNamespace?: ChainNamespace;                                // left out = the connected Push chain
  validUntil: number;
  assets?: AssetCap[];                                            // cross-chain rules: tokens the agent may move on chainNamespace
  maxGasPerCall?: bigint;                                         // cross-chain rules: PC (wei) per outbound for the destination leg
  allowedCalls: AllowedCall[];                                    // 1..32
}

interface AssetCap {
  token: MoveableToken | Address;                                 // the other chain's token address, or the native marker
  maxPerCall: bigint;
  maxTotal?: bigint;                                              // left out = 0; 0 means the agent cannot move this token
}

interface AllowedCall {
  target: Address | string;                                       // a contract; on Solana, the program address
  selector: Selector | 'value-only';                              // on Solana, the instruction name with its argument types
  pins?: Pin[];
  maxValue?: bigint;                                              // native coin per call; left out = 0
}

type Pin =
  | { arg: number; expected: Hex | Address | bigint | WalletMarker }   // the argument must equal this constant, or be the wallet itself
  | { arg: number; max: bigint }                                  // the argument must not exceed this
  | { account: number; expected: string | WalletMarker; token?: MoveableToken | string };   // Solana only: the account at this position must be this address, or the wallet itself; with token, the wallet's token account for that token

type WalletMarker = typeof PushChain.CONSTANTS.AGENTIC.WALLET;    // 'agentic:wallet': the wallet's own account on the rule's chain

interface RulesRecord {
  rulesId: Hex;
  enabled: boolean;
  chainNamespace: string;
  agent: Address;
  validUntil: number;
  rule: Rule;                                                     // accepted as is by rules.update
  spent: Spent;
}

type Spent =
  | { kind: 'native';    valueSpent: bigint; amountSpent: bigint; callsUsed: number }
  | { kind: 'universal'; assets: { token: Address; spent: bigint }[] };   // one entry per asset, same order as rule.assets
```

`Checkpoint` in 3.c keeps its `ref` field. That one is the checkpoint's own reference (a rules id or a call hash) and has nothing to do with the rule `ref` removed in 6.b.

`PushChain.CONSTANTS.AGENTIC` has one member, `WALLET` (6.a). The rest of 3.d (`FACTORY`, `RULES_POLICY`, `MAX_PINS`, `MAX_ALLOWED_CALLS`, `ENVELOPE_VERSION`) is dropped. Contract addresses and limits stay inside the SDK and are not exposed. The first implementation exposes all five on `PushChain.CONSTANTS.AGENTIC`; they are removed.

`PushChain.utils.agentic` (3.e) is dropped. The ids and the encoders stay inside the SDK, `client.agentic.derive` covers deriving a wallet address, and `compileCard` is left to the marketplace page (page 6). The first implementation exposes `actionId`, `configId` and `decodeRules` on `PushChain.utils.agentic`; they are removed.

### 6.i Solana, decided for v1

A Solana rule uses the same `allowedCalls` and `pins` shape as every other chain (6.a). The separate `allowedInstructions` shape of the first implementation, with an IDL and named accounts and fields, is replaced.

```tsx
// a rule on Solana devnet
{
  agent: '0xAgentOnPush',
  chainNamespace: CHAIN.SOLANA_DEVNET,
  assets: [
    { token: '0x0000000000000000000000000000000000000000', maxPerCall: 10_000n, maxTotal: 20_000n },   // native SOL, in lamports
  ],
  maxGasPerCall: parseUnits('1', 18),
  validUntil: now + 30 * 86400,
  allowedCalls: [
    { target: program,                                                  // the program address
      selector: 'receive_sol(u64)',                                     // instruction name and argument types
      pins: [
        { arg: 0, max: 10_000n },                                       // the amount
        { account: 1, expected: recipient },                            // account 1 must be this address
        { account: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET },   // account 2 must be this wallet (its CEA on Solana)
      ] },
  ],
}
```

The selector is the instruction's name with its argument types, the same idea as an EVM function signature. It is enough to identify the instruction and to locate each argument, so a rule carries no IDL. A program that does not follow the Anchor naming is written with a raw hex selector, as on EVM.

A Solana instruction carries two separate lists: its arguments (the values in the instruction data) and its accounts (the addresses it touches, passed beside the data). A pin says which list it means: `arg` is a position in the arguments and `account` is a position in the accounts list, both counted from 0. EVM rules only use `arg`, because an EVM call carries its addresses as arguments.

Tokens on Solana are not held at the wallet's own address. For each token it holds, the wallet has a separate token account, whose address is derived from the wallet and the token. To require that an account is the wallet's token account for a given token, the pin names the token as well:

```tsx
{ account: 1, expected: PushChain.CONSTANTS.AGENTIC.WALLET, token: MOVEABLE.TOKEN.SOLANA_DEVNET.USDT }   // account 1 must be this wallet's USDT token account
```

Without `token`, `WALLET` on an account means the wallet's CEA itself, which is where native SOL sits.

The IDL is still used where it is used today: when the call data for a send is built with `PushChain.utils.helpers.encodeTxData`, where it is passed in place of an ABI.

Accepted for v1:

- **A Solana rule reads back in the form it was written.** Positions go in and positions come out, so the read, change, pass back test of 6.d holds for Solana too.
- **An agent sends one Solana instruction per transaction.** Arrays of instructions are not supported on the agent door.
- **Only instructions with fixed-size arguments can be put under a rule.** Numbers up to u64, public keys, booleans and fixed-length arrays work, with top-level, non-optional accounts. Lists, strings, optional values and nested structs are rejected before signing. A deposit of an amount works; a routed swap that takes a list of hops does not.

### 6.j Contract changes these depend on

All on [1. AGW Contract Changes (nomenclature standard + change set)](https://app.notion.com/p/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d?pvs=21), section 6.

| Page 1 item | Contract change | Needed by |
| --- | --- | --- |
| 6.1 | The wallet approves the gateway for the exact amount inside each outbound | 6.g |
| 6.2 | One factory call that deploys the wallet and grants its rules | 6.b |
| 6.3 | Pins on EVM destination calls in the rules policy | 6.a |
| 6.4 | `ref` removed from `grantRules` | 6.b, 6.c, 6.d |
| 6.5 | A cap of 0 means nothing moves | 6.b |

### 6.k Still open

1. Whether the rules policy can enforce the wallet token account pin of 6.i in every case. To confirm with the contracts owner.

### 6.l Response fields and error codes added by the first implementation

The first implementation adds response fields and error codes that are not in 3.f. They are accepted as listed here. Four codes are removed, each for the reason given below.

**The `agentic` object on a response.** Every send made as the wallet carries an `agentic` object on its response, so the caller can see which wallet, which door and which rule the send used. Only the fields that apply to that send are present.

```tsx
// tx.agentic, on the UniversalTxResponse of a send made as the wallet
{
  wallet: '0xWallet',                                      // the AGW
  door: 'agent',                                           // 'owner' or 'agent'
  rulesId: '0x9c1e...',                                    // the rule used; agent door only
  chainNamespace: 'eip155:11155111',                       // destination chain of a cross-chain send
  destinationAccount: '0xCEA...',                          // the wallet's CEA on that chain
  destinationCalls: [{ to, data, value }],                 // the ordered calls run on an EVM destination
  destinationInstruction: { program, data, accounts },     // the instruction run on Solana
  destinationTransfer: { recipient, token, amount },       // a plain transfer of SOL or a token on Solana
  nativeCalls: [{ to, data, value }],                      // the ordered calls of a batch on Push
  rawTo: '0xWallet',                                       // what the signer's transaction actually called
  rawData: '0x...'                                         // the calldata it actually carried
}
```

**Error codes that stay.** All are thrown before anything is signed, unless the row says otherwise.

| Code | Thrown when |
| --- | --- |
| `INDEX_RACE` | Another `create` took the wallet slot first. Nothing was committed; call `create` again |
| `NOT_WALLET_OWNER` | The signer tries to change a wallet it does not own |
| `READ_ONLY` | A client with no signer tries to write |
| `RULE_NOT_FOUND` | The rule id is not an enabled rule on the wallet |
| `INVALID_RULE` | A rule or a label is malformed, for example a label over 64 bytes |
| `AMBIGUOUS_RULE` | More than one enabled rule matches the agent and the destination chain. The SDK does not pick one |
| `RULE_READ_FAILED` | The rules could not be read from the chain, so the SDK does not send |
| `INCONSISTENT_READ` | Two reads from the chain disagree with each other, so the SDK does not act on them |
| `AGENT_GAS_INSUFFICIENT` | The agent's own Push account has no PC for gas. The wallet's PC pays for the outbound, not for the agent's gas |
| `WALLET_BALANCE_INSUFFICIENT` | The wallet does not hold enough PC or enough of the token for the send |
| `CAPABILITY_UNAVAILABLE` | The network cannot do what was asked, for example a batch as the agent where no atomic batch is available |
| `RECEIPT_UNAVAILABLE` | After sending: the transaction was submitted but its receipt could not be read. It may still land |
| `RECEIPT_MISMATCH` | After sending: the receipt does not match what was sent, for example rule ids in a different order |

**Error codes that are removed.**

| Code | Why it goes |
| --- | --- |
| `CREATE_PARTIAL` | `create` is one transaction (6.b), so it cannot end half done |
| `GATEWAY_ALLOWANCE_INSUFFICIENT` | The wallet approves the gateway itself (6.g, page 1 item 6.1) |
| `GENERATION_UNSUPPORTED` | There are no earlier wallet versions to support |
| `RULE_LIMIT_EXCEEDED` | Only raised by a local preview of a Solana send. The on-chain rules policy is the only rule checker (2.a), so this is not a public code |

**`DUPLICATE_RULE` is restored.** 3.f lists `DUPLICATE_RULE`: two rules for the same agent and chain are rejected before signing. The first implementation does not have it and only notices the overlap later, when the agent sends (`AMBIGUOUS_RULE`). The check goes back into `create` and `rules.add`. `AMBIGUOUS_RULE` stays for a wallet that already has overlapping rules.

**Fields on the error classes.** `AgenticError` also carries `details` and `cause`, and both stay. `AgenticRevertError` carries `transactionHashes` and `pendingTransactionHash`, and a returned `tx` carries an `atomic` flag. These three report a write that was split across several transactions. They are removed once every write is a single transaction (6.b).

The progress events of the first implementation are the ones in 3.f, with nothing added.

### 6.m Delete rules - `w.rules.delete` (renamed from `w.rules.revoke`)

Removes some rules by id, or all of them in one atomic call. This is 1.m under a new name. The call shape and the result are unchanged.

```tsx
// Function
const tx = await w.rules.delete(rulesIds, { options? })
const tx = await w.rules.delete({ all, progressHook? })

// Usage and Params
const some    = await w.rules.delete(['0x9c1e...', '0x7d3a...']);                                // delete these rules
const all     = await w.rules.delete({ all: true });                                             // delete every rule on the wallet
const tracked = await w.rules.delete(['0x9c1e...'], { progressHook: (p) => console.log(p.id) }); // with progress events
// rulesIds               Hex[], required unless all is set     the rules to delete
// options.progressHook   function, optional                    progress events, AGENTIC-TX-105; default none
// all                    true, required unless rulesIds given  delete every rule on the wallet in one atomic call
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

What changed from 1.m:

- **The method is delete, not revoke.** The handle now reads `rules.add`, `rules.update`, `rules.delete`. Delete is also what happens on-chain: the wallet removes the rule from the session engine for good. A deleted rule cannot be switched back on, and granting the same rule again produces a new `rulesId`.
- **The bare-call error is renamed.** A bare `delete()` still throws. The code is `DELETE_NEEDS_TARGET` (was `REVOKE_NEEDS_TARGET`).
- **Contract names do not change.** The wallet functions stay `revokeRules` and `revokeAllRules`, the event stays `RulesRevoked`, and the checkpoint kind stays `RULES_REVOKED`. `w.checkpoints()` returns that kind as the contract records it.

# 7. Changes proposed on 12 Oct 2026: Presets

A preset is a ready-made set of rules for a common use case, such as trading on popular DEXes. The wallet UI and developers both read presets from the SDK, so there is one source for them. A preset only produces rules. The rules are then passed to `client.agentic.create` in the normal way, and can be edited before that. App ABIs are not part of presets and stay in the wallet UI, because the UI can update them without an SDK release.

List of changes:

- New constants: `PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY` with `DEXES`, `LENDING` and `PREDICTION`. An app level (`PushChain.CONSTANTS.AGENTIC.PRESETS.APP`) can be added later without changing the functions.
- New function: `PushChain.utils.agentic.presets.list`, which lists every preset the SDK ships.
- New function: `PushChain.utils.agentic.presets.get`, which returns the rules for one preset.
- This brings back `PushChain.CONSTANTS.AGENTIC` members beyond `WALLET` and the `PushChain.utils.agentic` namespace, for presets only. Both were dropped earlier on this page (6.h).

### 7.a Preset constants - `PushChain.CONSTANTS.AGENTIC.PRESETS`

```tsx
PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES
PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.LENDING
PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.PREDICTION
// later: PushChain.CONSTANTS.AGENTIC.PRESETS.APP.<APP_NAME>
```

The constants object must be enumerable so that tools which iterate constants can list it.

### 7.b List available presets - `PushChain.utils.agentic.presets.list`

Returns every preset the SDK ships, so a UI can show them as cards and a developer can discover them.

```tsx
// Function
const res = PushChain.utils.agentic.presets.list({ options? })

// Usage and Params
const { presets } = PushChain.utils.agentic.presets.list();     // every preset the SDK ships
// options.type   string, optional   'CATEGORY' today, 'APP' later; omit to list everything

// Returns
// <Object> { presets: Preset[] }
{
  presets: [
    {
      type: 'CATEGORY',                                           // later 'APP'
      constant: PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,
      name: 'Popular DEXes',
      chains: ['eip155:11155111', 'eip155:84532']                 // chains this preset has rules for (Ethereum Sepolia, Base Sepolia)
    }
  ]
}
```

A preset with an empty `chains` list has nothing behind it yet (`PREDICTION` today, since its main apps are on a chain Push does not support yet), and the wallet UI should hide it.

### 7.c Get the rules of a preset - `PushChain.utils.agentic.presets.get`

Returns one rule per chain for the chosen preset. Each rule already contains the allowed contracts, the allowed calls with their full signatures, and the pins that keep funds going back to the wallet. The agent, assets and expiry are optional: pass them to get rules that are ready for `create`, or leave them out to pre-fill a review screen and add them later.

```tsx
// Function
const res = PushChain.utils.agentic.presets.get(preset, { options? })

// Usage and Params
const { rules } = PushChain.utils.agentic.presets.get(
  PushChain.CONSTANTS.AGENTIC.PRESETS.CATEGORY.DEXES,             // a category constant now, an app constant later
  {
    chainNamespace: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,   // optional, omit to get every chain of the preset
    agent: '0xAgentOnPush',                                       // optional, the agent's Push address, applied to every rule
    assets: [{ chainNamespace, token, maxPerCall, maxTotal }],    // optional, each asset is placed on the rule of its chain
    validUntil: now + 30 * 86400,                                 // optional, applied to every rule; omit to set it later
  }
);

await client.agentic.create('My DEX agent', { rules });

// Returns
// <Object> { rules: Rule[] }, one rule per chain, in the same shape client.agentic.create takes
{
  rules: [
    {
      agent: '0xAgentOnPush',
      chainNamespace: 'eip155:11155111',
      assets: [{ token: '0x1c7D...7238', maxPerCall: 100000000n, maxTotal: 1000000000n }],   // from options.assets, without its chainNamespace
      validUntil: 1767225600,
      allowedCalls: [
        {
          target: '0x...',
          selector: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
          pins: [{ arg: 3, expected: PushChain.CONSTANTS.AGENTIC.WALLET }],
          app: 'Uniswap V3',                                      // display only, ignored by create
          label: 'Swap exact input'                               // display only, ignored by create
        }
        // plus one approve(address,uint256) per asset, spender pinned to the app's contract (see Behaviour)
      ]
    }
  ]
}
```

**Behaviour**

| Case | What happens |
| --- | --- |
| `chainNamespace` omitted | One rule is returned for every chain the preset covers. |
| `agent`, `assets` or `validUntil` omitted | The rule is returned without that field. The caller adds it before `create`, and `create` rejects a rule with no agent as it already does. |
| `assets` passed | Each asset is placed on the rule of its chain. If `chainNamespace` is set in the options, the `chainNamespace` on each asset can be left out. For each asset, an approve call is added to that rule, with the spender pinned to the app's contract on that chain, because a swap or deposit fails without it. |
| Asset passed without a cap | Proposed: `get` throws. An omitted cap means 0 in the rules policy, so the rule would allow nothing, and a preset should never silently produce a rule that cannot act. |
| Selectors | Always the full signature, never the bare name, because apps overload function names (for example two different execute functions on the same router). |
| Grouping | One rule per chain per category, not one rule per app. Each category stays at two or three apps per chain so the rule stays inside the 32 allowed calls limit of a universal rule. |
| Display fields | `app` and `label` on each allowed call are for showing names in a UI. `create` ignores them. |

### 7.d Notes for the wallet UI

- Call `get` with only the preset to pre-fill the review screen, then let the user add the agent, tokens, limits and expiry.
- A blank limit shown as infinity in the UI must be sent as an explicit maximum value. Leaving the cap out means 0, not unlimited.
- The preset data (contract addresses, calls and pins) ships inside the SDK. An app upgrade becomes a new app entry, and the old one keeps working because the older contract still exists.

### 7.e Open questions

- Can a pin's arg index reach a field inside a struct argument? The Uniswap `exactInputSingle` example depends on it, because the recipient sits inside a struct. (Rules policy contract owner)
- Routers that hide the recipient inside encoded bytes, such as Uniswap Universal Router `execute`, cannot be pinned, so they should not be preset targets. Confirm the list of apps and functions per chain with this in mind. (SDK owner with the rules policy contract owner)
- Is the agent one Push address for every chain, including Solana rules? If not, `agent` becomes a per-chain map. (SDK owner)
- Should `get` throw when an asset has no cap, as proposed above? (Page owner)
- First preset list for testnet: which apps on which chains for `DEXES` and `LENDING`. (SDK owner with the rules policy contract owner)