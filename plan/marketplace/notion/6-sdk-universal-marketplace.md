# 6. SDK: Universal Marketplace

<aside>
🏪

**Where we are going.** A user picks an agent card, sees in words what the agent may do and what "done" means, signs once, and the wallet, the rules and the job exist. Then they deposit. A provider registers a card and never touches the user's signature. `client.market` is the surface over `UniversalMarketplace` ([2. Universal Marketplace](2%20Universal%20Marketplace%203e9188aea7f48118b90ac9b267496295.md)); the job itself continues on [7. SDK: 8183 Job](7%20SDK%208183%20Job%203ea188aea7f481e0a137f5a896723376.md).

**What this page is.** The `client.market` namespace and the authoring helpers a card needs (`PushChain.utils.job` for the `JobSpec`, `PushChain.utils.market` for the rules), one heading per function, examples first, types second. Same conventions as [5. SDK: AGW](5%20SDK%20AGW%203e9188aea7f481cf8e8de324956549b9.md): `fn(x, { options })`, writes return `UniversalTxResponse`, every write takes a `progressHook`, nothing is sent until the function that says it sends.

**Status.** Contract BUILT on `universalMarketplace_v1`, not deployed. The SDK surface below is DECIDED (2026-10-12) against that contract plus the change list on page 2; function names on the contract side are the post-rename names.

</aside>

# List of changes

New

- `client.market`
    - user side
        - `cards`
        - `card`
        - `preview`
        - `openJob`
        - `deposit`
        - `job`
        - `activeJob`
    - provider side, `client.market.agent`
        - `register`
        - `update`
        - `setActive`
        - `card`
- `MarketError`, progress family `MARKET-TX-1xx`
- `PushChain.utils.job` (moved here from page 8, 2026-10-12)
    - `buildJobSpec`
    - `buildJobSpecTemplate`
    - `encodeJobSpec`
    - `decodeJobSpec`
    - `describeJobSpec`
    - `previewJobSpec`
- `PushChain.utils.market`
    - `validateAgentCardRules`
    - `encodeAgentCardRules`
    - `decodeAgentCardRules`
- `PushChain.CONSTANTS.AGENTIC.PRINCIPAL` and `PushChain.CONSTANTS.AGENTIC.JOB.*` (vocabulary), `JobSpecError`
- `client.universal.read.prepare` (core change; the read input to the builders)

Removed from this page on 2026-10-12

- `PushChain.CONSTANTS.MARKET` (addresses stay inside the SDK, page 5 decision); `PushChain.CONSTANTS.JOB_SPEC` limits; the `'PRINCIPAL'` and `'CEA'` string markers (now `AGENTIC.PRINCIPAL` and `AGENTIC.WALLET`); `beneficiary` on allowed calls (now `pins`, page 5 6.a)

Removed from the earlier draft of this page

- `start` funding anything; `prepare.start`; `compile`; `publish`, `mine`, `retire`; `fee.tokens[]`; off-chain signed cards and hash ids

Not in the SDK

- admin calls: `verifyAgentCard`, `disableAgentCard`, `setCEADeployment`, `setHook`, `setEvaluator`, `pause`

Two sides, one namespace. The user side is everything the person starting a job does: browse, preview, sign once, deposit. The provider side (`client.market.agent`) is everything the agent's operator does: register the card, update it, switch it on and off. A card id is an on-chain integer; a card version is on-chain and bumps on every update.

# 1. User side, by example

### 1.a List agent cards - `client.market.cards`

Lists cards. The contract has no list view, so the SDK walks `agentCardCount` and `getAgentCard` and filters locally; an indexer replaces the walk later without changing the call.

```tsx
// Function
const res = await client.market.cards({ options? })

// Usage and Params
const { cards } = await client.market.cards();                                        // every card
const { cards } = await client.market.cards({ chain: CHAIN.ETHEREUM_SEPOLIA });        // cards acting on one chain
const { cards } = await client.market.cards({ provider: '0xAgentOnPush', active: true });
// options.provider   Address, optional   only cards registered by this Push address
// options.chain      CHAIN, optional     only cards whose execution chain is this one
// options.active     boolean, optional   only cards switched on; default all

// Returns
// <Object> { cards: AgentCardSummary[] }
{
  cards: [
    {
      cardId: 7n,
      provider: '0xAgentOnPush',
      jobType: 'LENDING_DEPOSIT',
      chain: 'eip155:11155111',
      providerFee: 5000000n,
      paymentToken: '0xUSDC...',
      principalMin: 100000000n,
      principalMax: 50000000000n,
      version: 2,
      active: true,
      verified: true,
      rating: 0,
    },
  ]
}
```

### 1.b Read one card - `client.market.card`

The card in full, decoded: the listing, the rules the agent needs, the job spec template, version and tags. `getAgentCard` plus `getAgentRating`.

```tsx
// Function
const card = await client.market.card(cardId)

// Usage and Params
const card = await client.market.card(7n);                                             // one card
// cardId   bigint, required   the card's on-chain id

// Returns
// <AgentCard> { cardId, provider, jobType, metadataURI, metadataHash, chain, providerFee, paymentToken, principalMin, principalMax, minDuration, maxDuration, minExecuteWindow, settleWindow, active, version, verified, disabled, rating, rules, jobSpecTemplate }
{
  cardId: 7n,
  provider: '0xAgentOnPush',
  jobType: 'LENDING_DEPOSIT',
  metadataURI: 'ipfs://...',
  metadataHash: '0x...',
  chain: 'eip155:11155111',
  providerFee: 5000000n,
  paymentToken: '0xUSDC...',
  principalMin: 100000000n,
  principalMax: 50000000000n,
  minDuration: 86400,
  maxDuration: 7776000,
  minExecuteWindow: 3600,
  settleWindow: 7200,
  active: true,
  version: 2,
  verified: true,
  disabled: false,
  rating: 0,
  rules: {                                                   // AgentCardRules, decoded
    assets: [
      {
        token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC,
        maxPerCall: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
        maxTotal: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
      },
    ],
    maxGasPerCall: 1000000000000000000n,
    allowedCalls: [
      {
        target: aavePool,
        selector: 'supply(address,uint256,address,uint16)',
        pins: [
          { arg: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET },
        ],
      },
    ],
    principalAsset: 0,
    approvals: [
      {
        token: usdcSepolia,
        spender: aavePool,
        capIsPrincipal: true,
      },
    ],
  },
  jobSpecTemplate: {                                         // JobSpecTemplate, decoded
    reads: [...],
    checks: [...],
    logic: { ... },
    allowedMutability: 'NONE',
    params: [],
  },
}
```

`rules.assets[].maxPerCall` and `maxTotal` read `PushChain.CONSTANTS.AGENTIC.PRINCIPAL` for the principal asset because the contract binds them to the job's principal at `openJob`; every other cap is a number. `PushChain.CONSTANTS.AGENTIC.WALLET` in a pin means the user's wallet on the card's chain (its CEA), filled the same way.

### 1.c Preview a job before signing - `client.market.preview`

Builds and validates everything the user's one signature will cover, and sends nothing. Bad inputs throw here (principal out of range, stale card version, wallet busy), before any signature. The returned plan is what `openJob` signs, and the readable preview is what the UI shows.

```tsx
// Function
const plan = await client.market.preview(cardId, { options })

// Usage and Params
const plan = await client.market.preview(7n, {
  principal: parseUnits('500', 6),                     // in the card's principal asset
  expiredAt: now + 7 * 86400,                          // inside the card's duration window
  executeBy: now + 3600,                               // at or after now + minExecuteWindow; executeBy + settleWindow <= expiredAt
  params: [],                                          // one per template param, inside its bounds
});
// cardId               bigint, required    the card
// options.principal    bigint, required    the job's size, in the card's principal asset
// options.expiredAt    number, required    job expiry, unix seconds
// options.executeBy    number, required    the provider must have executed by this
// options.params       bigint[], optional  per-job numbers the template declares; default none
// options.walletIndex  number, optional    reuse a derived wallet slot; default the owner's next unused index

// Returns
// <JobPlan> { cardId, cardVersion, wallet, walletDeployed, session, intent, calldata, jobSpec, deposit, preview }
{
  cardId: 7n,
  cardVersion: 2,
  wallet: '0x2Fd9...',                                // predictWallet(owner, index)
  walletDeployed: false,
  session: { ... },                                   // the rules for this job, as the AGW will store them; sessionHash is in the intent
  intent: {                                           // what the owner signs; from previewIntent
    owner: '0xFd6C...',
    wallet: '0x2Fd9...',
    executor: '0xMarketplace',
    index: 0,
    sessionHash: '0x...',
    mode: '0x00...',
    execCalldataHash: '0x...',
    nonceKey: 0n,
    nonceSeq: 0n,
    grantNonce: 0n,
    deadline: 1767225600,
    signerChainId: 11155111n,
  },
  calldata: '0x...',                                  // the exact createJob execution, from buildCreateJobCalldata
  jobSpec: {
    spec: {                                           // JobSpec, built from the card's template
      reads: [...],
      checks: [...],
      logic: { ... },
      allowedMutability: 'NONE',
      origin: '0x...',
      executeBy: 1766630400,
      failFinalAt: 1766637600,
    },
    bytes: '0x...',
  },
  deposit: {                                          // what deposit() will move, for display
    principal: {
      token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC,
      amount: 500000000n,
    },
    providerFee: {
      token: '0xUSDC...',
      amount: 5000000n,
    },
    pc: 1000000000000000000n,
    approvals: [
      {
        token: usdcSepolia,
        spender: aavePool,
        amount: 500000000n,
      },
    ],
  },
  preview: {                                          // in words, for the signing screen
    mayDo: [
      'On Ethereum Sepolia: call Aave Pool supply(...); the receiving account is always your own account there',
    ],
    mayMove: [
      'Up to 500 USDC in total, 500 per call; up to 1 PC per outbound for fees',
    ],
    judgedBy: [
      'aUSDC balance of your account is at least 499.95 USDC',
      'Aave USDC supply rate is at least 4%',
    ],
    until: '2026-10-19 12:00 UTC',
  },
}
```

The SDK derives the user's destination account itself with the account utilities and compares it to the contract's `computeCEA`; a disagreement throws `CEA_MISMATCH` before signing. Approvals are listed because the owner, not the agent, must make them (page 2, section 3).

### 1.d Open the job with one signature - `client.market.openJob`

Signs the `OwnerIntent` and submits `openJob`. Behind the signature: the wallet is deployed if new, the rules are granted, the kernel job is created in Open with the wallet as client. Nothing is funded.

```tsx
// Function
const res = await client.market.openJob(plan, { options? })

// Usage and Params
const res = await client.market.openJob(plan, { progressHook: (p) => console.log(p.id, p.message) });   // MARKET-TX-1xx
// plan                   JobPlan, required    from preview; the SDK re-reads the wallet's nonces and refuses a stale plan
// options.progressHook   function, optional   progress events; default none
// options.relay          boolean, optional    submit through the Push relayer; default true for an external owner, false for a Push EOA, which submits itself

// Returns
// <Object> { jobId, wallet, rulesId, tx }
{
  jobId: 42n,
  wallet: '0x2Fd9...',
  rulesId: '0x9c1e...',
  tx: {                                                 // UniversalTxResponse of the openJob transaction
    hash: '0xb527...',
    origin: 'eip155:11155111:0x31dC...',                // the owner's key, CAIP-10
    from: '0xRelayerOrOwner',
    blockNumber: 1290n,
    wait
  }
}
```

The signature is EIP-712 under the factory's domain with `signerChainId` set to the owner's home chain, so MetaMask signs it on the chain it is connected to. Anyone may submit the signed parameters; a front-runner starts exactly the job the owner signed, and the wallet's nonces make it one-shot. A Push EOA owner signs the same way and the SDK submits from that EOA.

### 1.e Deposit into the wallet - `client.market.deposit`

The funding step, separate from `openJob` by decision: moves the principal, the provider fee and PC into the wallet from the connected signer (any chain, the normal `sendTransaction` with `funds`), then makes the card's approvals from the wallet's account on the destination chain through the owner door. Reports each step, because an external owner may sign more than once.

```tsx
// Function
const res = await client.market.deposit(jobId, { options? })

// Usage and Params
const res = await client.market.deposit(42n, { progressHook: (p) => console.log(p.id, p.message) });
const res = await client.market.deposit(42n, { skipApprovals: true });                 // funds only; approvals made elsewhere
// jobId                  bigint, required     the job opened on this card
// options.progressHook   function, optional   progress events, MARKET-TX-11x; default none
// options.skipApprovals  boolean, optional    move funds and PC only; default false

// Returns
// <Object> { txs }
{
  txs: [
    {
      step: 'PRINCIPAL',
      tx: { hash: '0x...', wait },                     // UniversalTxResponse
    },
    {
      step: 'PROVIDER_FEE',
      tx: { hash: '0x...', wait },
    },
    {
      step: 'PC',
      tx: { hash: '0x...', wait },
    },
    {
      step: 'APPROVAL',                                // owner door, cross-chain
      token: usdcSepolia,
      spender: aavePool,
      tx: { hash: '0x...', wait },
    },
  ]
}
```

Funding can come from any account, not only the owner's: anyone can send tokens and PC to the wallet address. `deposit` is the convenience that knows the card's amounts and makes the approvals, which only the owner can do. After the provider prices the job, funding the kernel escrow is `client.job.fund(jobId)` on [7. SDK: 8183 Job](7%20SDK%208183%20Job%203ea188aea7f481e0a137f5a896723376.md).

### 1.f Read what the marketplace recorded for a job - `client.market.job`

```tsx
// Function
const res = await client.market.job(jobId)

// Usage and Params
const { cardId, wallet, rulesId } = await client.market.job(42n);
// jobId   bigint, required   a job opened through the marketplace

// Returns
// <Object> { cardId, cardVersion, wallet, rulesId }
{
  cardId: 7n,
  cardVersion: 2,
  wallet: '0x2Fd9...',
  rulesId: '0x9c1e...',
}
```

Zero values for a job not opened here. The job's own state (status, budget, provider) is `client.job.status(jobId)`.

### 1.g Read a wallet's live job - `client.market.activeJob`

```tsx
// Function
const res = await client.market.activeJob(wallet)

// Usage and Params
const { jobId } = await client.market.activeJob('0x2Fd9...');                            // 0n when the wallet is free
// wallet   Address, required   an AGW

// Returns
// <Object> { jobId }
{
  jobId: 42n
}
```

A wallet is busy while its last marketplace job is Funded, Submitted, or Open and not yet expired. `preview` and `openJob` throw `WALLET_HAS_ACTIVE_JOB` for a busy wallet.

# 2. Provider side, by example

The provider is the agent's operator. The connected signer's Push address becomes the card's `provider`, the 8183 provider, and the agent every rule names. One card per provider is enforced on-chain (open item 1).

### 2.a Register a card - `client.market.agent.register`

Encodes the rules (tokens resolved to PRC20s, selector strings to `bytes4`, pins to the argument offsets the contract checks) and the job spec template, then calls `registerAgentCard`. `rules` is the AGW's `Rule` ([5. SDK: AGW](5%20SDK%20AGW%203e9188aea7f481cf8e8de324956549b9.md), 6.a and 6.h) with the per-job fields left out: `agent` is the card's provider, `chainNamespace` is the card's `chain`, `validUntil` is the job's `expiredAt`; the marketplace fills those at `openJob`. Argument restrictions are `pins` on each allowed call, exactly as on the wallet, with `PushChain.CONSTANTS.AGENTIC.WALLET` standing for the user's wallet. Two fields are the marketplace's own: `principalAsset` says which asset is the principal, and `approvals` are the owner's token approvals on the execution chain, not rules on the wallet.

```tsx
// Function
const res = await client.market.agent.register(card, { options })

// Usage and Params
const res = await client.market.agent.register({
  jobType: 'LENDING_DEPOSIT',
  metadataURI: 'ipfs://...',
  metadataHash: '0x...',
  chain: CHAIN.ETHEREUM_SEPOLIA,                       // the chain the agent acts on
  providerFee: parseUnits('5', 6),
  paymentToken: USDC_PUSH,
  principalMin: parseUnits('100', 6),
  principalMax: parseUnits('50000', 6),
  minDuration: 86400,
  maxDuration: 90 * 86400,
  minExecuteWindow: 3600,
  settleWindow: 7200,
}, {
  rules: {
    assets: [
      {
        token: MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.USDC,
        maxPerCall: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,   // bound to the job's principal at openJob
        maxTotal: PushChain.CONSTANTS.AGENTIC.PRINCIPAL,
      },
    ],
    maxGasPerCall: parseUnits('1', 18),                // PC (wei) per outbound, as on the AGW rule
    allowedCalls: [
      {
        target: aavePool,
        selector: 'supply(address,uint256,address,uint16)',
        pins: [
          { arg: 2, expected: PushChain.CONSTANTS.AGENTIC.WALLET },   // onBehalfOf must be the user's wallet (its CEA on Sepolia)
        ],
      },
    ],
    principalAsset: 0,                                 // marketplace field: which asset is the principal
    approvals: [                                       // marketplace field: the owner's approvals on the execution chain
      {
        token: usdcSepolia,
        spender: aavePool,
        capIsPrincipal: true,
      },
    ],
  },
  jobSpecTemplate,                                     // JobSpecTemplate; built with PushChain.utils.job.buildJobSpecTemplate (3.b)
  progressHook: (p) => console.log(p.id, p.message),
});
// card                    AgentCardInput, required   the listing; provider and active are set by the contract
// options.rules           AgentCardRules, required   what the agent needs the owner to grant
// options.jobSpecTemplate  JobSpecTemplate, required the evaluator's JobSpec with holes
// options.progressHook    function, optional         progress events, MARKET-TX-12x; default none

// Returns
// <Object> { cardId, version, tx }
{
  cardId: 7n,
  version: 1,
  tx: {                                                // UniversalTxResponse
    hash: '0x...',
    origin: 'eip155:11155111:0x31dC...',
    from: '0xAgentOnPush',
    blockNumber: 1300n,
    wait
  }
}
```

Registration checks run on-chain (job type, metadata, chain configured, principal and duration ranges, allow-list size and shape, no `approve` in the allow-list, approvals well formed, assets on the card's chain). The template is stored as given and not judged.

### 2.b Update a card - `client.market.agent.update`

Replaces every field except `provider`, `chain` and `active`, and both blobs. Version bumps, the verified tag clears, jobs already opened keep the version they were signed against.

```tsx
// Function
const res = await client.market.agent.update(cardId, card, { options })

// Usage and Params
const res = await client.market.agent.update(7n, card, { rules, jobSpecTemplate, progressHook });
// cardId                   bigint, required            the provider's card
// card, options            as in register

// Returns
// <Object> { cardId, version, tx }
```

### 2.c Switch a card on or off - `client.market.agent.setActive`

Off stops new jobs on the card; on resumes. Live jobs are untouched. Reversible, unlike the admin's `disableAgentCard`.

```tsx
// Function
const tx = await client.market.agent.setActive(cardId, active, { options? })

// Usage and Params
const tx = await client.market.agent.setActive(7n, false);                              // pause the card
// cardId                 bigint, required     the provider's card
// active                 boolean, required    on or off
// options.progressHook   function, optional   default none

// Returns
// <UniversalTxResponse> { hash, origin, from, to, blockNumber, wait() }
```

### 2.d Read the provider's card - `client.market.agent.card`

```tsx
// Function
const card = await client.market.agent.card()

// Usage and Params
const card = await client.market.agent.card();                                           // the connected signer's card, or undefined
// no params

// Returns
// <AgentCard | undefined>   same shape as 1.b
```

# 3. Authoring helpers, by example

Pure functions, no network except `previewJobSpec`. A provider uses them to write a card; a client creating a plain 8183 job uses the same helpers to write a `JobSpec` with no placeholders and passes the bytes to `client.job.create` ([7. SDK: 8183 Job](7%20SDK%208183%20Job%203ea188aea7f481e0a137f5a896723376.md)). The format they produce is the `JobSpec` on [4. Universal Evaluation](4%20Universal%20Evaluation%203e9188aea7f4817bb03ef4c78c883f8b.md), section 0. Two authors, one format: a card carries a `JobSpecTemplate`, a `JobSpec` with placeholders for the user's wallet, the user's params and the principal and no timing, filled on-chain at `openJob`; a plain job carries a `JobSpec` directly. Both go on-chain as `abi.encode(...)`.

Reads are universal reads that have not been sent yet. `client.universal.read.prepare` takes exactly the options `client.universal.read` takes, sends nothing, and returns the read as data; `client.universal.read(read)` accepts the same object, so what the author previews and what the validators fetch at verification is one description. The two things only the evaluator needs, `field` (which value to take out of the return) and `minConfirmations`, are given beside the prepared read in the builder, not to `prepare`. The evaluator never fetches anything itself; it compares attested answers, so any source universal read serves (EVM, Solana, web2) works the day the `Read` struct can describe it. Vocabulary comes from `PushChain.CONSTANTS.AGENTIC` (4.d); strings are accepted too. All PROPOSED (2026-10-12).

### 3.a Build a spec for a plain job - `PushChain.utils.job.buildJobSpec`

A complete `JobSpec` with no placeholders, for a client creating a job directly on the kernel. Validates the logic tree, the evaluator's limits (16 reads, 16 checks, 32 logic nodes) and that `failFinalAt` sits inside the expiry you pass.

```tsx
// Function
const spec = PushChain.utils.job.buildJobSpec({ options })

// Usage and Params
const { JOB, WALLET } = PushChain.CONSTANTS.AGENTIC;
const deposited = client.universal.read.prepare({                 // exactly what client.universal.read takes; nothing is sent
  chain: CHAIN.ETHEREUM_SEPOLIA,
  target: aUSDC,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [userWallet],
});
const rate = client.universal.read.prepare({
  chain: CHAIN.ETHEREUM_SEPOLIA,
  target: aavePool,
  abi: aavePoolAbi,
  functionName: 'getReserveData',
  args: [USDC],
});

const spec = PushChain.utils.job.buildJobSpec({
  reads: [
    {
      read: deposited,
      minConfirmations: 12,
    },
    {
      read: rate,
      field: [0, 2],                                      // currentLiquidityRate inside the returned struct; default [0]
    },
  ],
  checks: [
    {
      read: 0,
      evaluation: JOB.EVALUATION.COMPARE,
      operation: JOB.OPERATION.GREATER_OR_EQUAL,
      target: 499950000n,                               // deposited at least 499.95 USDC
    },
    {
      read: 1,
      evaluation: JOB.EVALUATION.COMPARE,
      operation: JOB.OPERATION.GREATER_OR_EQUAL,
      target: 4n * 10n ** 25n,                          // rate at least 4%, in ray
    },
  ],
  logic: JOB.LOGIC.ALL,                                   // shorthand: all checks; or a tree, see 3.b
  allowedMutability: JOB.ALLOWED_MUTABILITY.NONE,
  executeBy: now + 3600,
  failFinalAt: now + 3 * 3600,
  expiredAt: now + 7 * 86400,                             // for the failFinalAt check only; not stored
});
// options.reads               (PreparedRead | ReadInput)[], required   1..16; a bare prepared read, or { read, field?, minConfirmations? }; no placeholders
// options.checks              Check[], required                    1..16; { read, evaluation, operation, target }
// options.logic               LOGIC.ALL | LOGIC.ANY | LogicTree, required
// options.allowedMutability   ALLOWED_MUTABILITY.*, required       who may propose a replacement spec at setBudget
// options.executeBy           number, required                     unix seconds
// options.failFinalAt         number, required                     unix seconds; after this a FAIL is final
// options.expiredAt           number, optional                     warns FAIL_WINDOW_THIN if failFinalAt is close to it

// Returns
// <JobSpec> { reads, checks, logic, allowedMutability, origin, executeBy, failFinalAt }
{
  reads: [
    {
      chainNamespace: 'eip155',
      chainId: '11155111',
      minConfirmations: 12,
      target: '0xaUSDC...',
      selector: '0x70a08231',
      args: '0x000...userWallet',
      outputs: '0x0801...',                               // type codes derived from the ABI
      field: [0],
    },
    { ... },
  ],
  checks: [
    {
      read: 0,
      evaluation: 'COMPARE',
      operation: 'GREATER_OR_EQUAL',
      target: 499950000n,
    },
    {
      read: 1,
      evaluation: 'COMPARE',
      operation: 'GREATER_OR_EQUAL',
      target: 40000000000000000000000000n,
    },
  ],
  logic: {
    kind: 'ALL',
    of: [0, 1],
  },
  allowedMutability: 'NONE',
  origin: '0x00...00',                                    // zero for a plain job
  executeBy: 1766630400,
  failFinalAt: 1766637600,
}
```

### 3.b Build a card template - `PushChain.utils.job.buildJobSpecTemplate`

The same, with placeholders and no timing (the job supplies `executeBy` and `failFinalAt`). A read argument may be `WALLET` (the user's wallet on that chain, its CEA off Push) or `{ param: i }` (a user-chosen number); a check target may be `PRINCIPAL`, `{ principalBps: n }` or `{ param: i }`; each param declares bounds. Placeholders travel through `prepare` as ordinary argument values and the builder records where they sit, so `prepare` stays a plain universal read. This is what `client.market.agent.register` (2.a) takes as `jobSpecTemplate`. The marketplace stores it as given and fills the placeholders on-chain at `openJob`.

```tsx
// Function
const template = PushChain.utils.job.buildJobSpecTemplate({ options })

// Usage and Params
const { JOB, WALLET, PRINCIPAL } = PushChain.CONSTANTS.AGENTIC;
const deposited = client.universal.read.prepare({
  chain: CHAIN.ETHEREUM_SEPOLIA,
  target: aUSDC,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [WALLET],                                       // placeholder: the user's wallet on Sepolia, filled at openJob
});
const rate = client.universal.read.prepare({
  chain: CHAIN.ETHEREUM_SEPOLIA,
  target: aavePool,
  abi: aavePoolAbi,
  functionName: 'getReserveData',
  args: [USDC],
});

const template = PushChain.utils.job.buildJobSpecTemplate({
  reads: [
    {
      read: deposited,
      minConfirmations: 12,
    },
    {
      read: rate,
      field: [0, 2],
    },
  ],
  checks: [
    {
      read: 0,
      evaluation: JOB.EVALUATION.COMPARE,
      operation: JOB.OPERATION.GREATER_OR_EQUAL,
      target: { principalBps: 9999n },                  // deposited at least 99.99% of the principal
    },
    {
      read: 1,
      evaluation: JOB.EVALUATION.COMPARE,
      operation: JOB.OPERATION.GREATER_OR_EQUAL,
      target: 4n * 10n ** 25n,
    },
  ],
  logic: {                                                // a tree: entries are check indices or sub-trees
    kind: JOB.LOGIC.ANY,
    of: [
      {
        kind: JOB.LOGIC.ALL,
        of: [0, 1],
      },
      {
        kind: JOB.LOGIC.AT_LEAST,
        k: 1,
        of: [0],
      },
    ],
  },
  allowedMutability: JOB.ALLOWED_MUTABILITY.NONE,
  params: [],                                             // e.g. [{ min: 1n, max: 10n ** 30n }] for a user-chosen minOut
});
// options.reads               (PreparedRead | ReadInput)[], required   args may carry WALLET or { param: i }; the builder records where
// options.checks              CheckTemplate[], required           target: bigint | PRINCIPAL | { principalBps } | { param }
// options.logic               LOGIC.ALL | LOGIC.ANY | LogicTree, required
// options.allowedMutability   ALLOWED_MUTABILITY.*, required
// options.params              { min, max }[], optional            one per user-supplied number, at most 8; default none

// Returns
// <JobSpecTemplate> { reads, checks, logic, allowedMutability, params }
{
  reads: [
    {
      chainNamespace: 'eip155',
      chainId: '11155111',
      minConfirmations: 12,
      target: '0xaUSDC...',
      selector: '0x70a08231',
      args: '0x00...00',                                  // 32 zero bytes where the wallet goes
      outputs: '0x0801...',
      field: [0],
      fills: [
        {
          word: 0,
          source: 'WALLET',                               // the placeholder, filled on-chain
        },
      ],
    },
    { ... },
  ],
  checks: [
    {
      read: 0,
      evaluation: 'COMPARE',
      operation: 'GREATER_OR_EQUAL',
      target: { principalBps: 9999n },
    },
    {
      read: 1,
      evaluation: 'COMPARE',
      operation: 'GREATER_OR_EQUAL',
      target: 40000000000000000000000000n,
    },
  ],
  logic: {
    kind: 'ANY',
    of: [
      {
        kind: 'ALL',
        of: [0, 1],
      },
      {
        kind: 'AT_LEAST',
        k: 1,
        of: [0],
      },
    ],
  },
  allowedMutability: 'NONE',
  params: [],
}
```

### 3.c Encode a spec - `PushChain.utils.job.encodeJobSpec`

The bytes `client.job.create` takes as `jobSpec`, and the bytes `registerAgentCard` stores as the template. The logic tree is flattened to the contract's node list here and re-nested by the decoder, so the SDK never shows a leaf node.

```tsx
// Function
const bytes = PushChain.utils.job.encodeJobSpec(spec)

// Usage and Params
const jobSpec  = PushChain.utils.job.encodeJobSpec(spec);         // pass as client.job.create's jobSpec
const template = PushChain.utils.job.encodeJobSpec(templateSpec); // what register sends as jobSpecTemplate
// spec   JobSpec | JobSpecTemplate, required   abi.encode of either

// Returns
// <Hex>
```

### 3.d Decode a spec - `PushChain.utils.job.decodeJobSpec`

From a job's `description` or a card's stored template back to a typed object; the decoder tells `JobSpec` from `JobSpecTemplate` by shape.

```tsx
// Function
const spec = PushChain.utils.job.decodeJobSpec(bytes)

// Usage and Params
const spec     = PushChain.utils.job.decodeJobSpec(job.description);
const template = PushChain.utils.job.decodeJobSpec(card.jobSpecTemplateBytes);
// bytes   Hex, required   abi.encode of a JobSpec or a JobSpecTemplate

// Returns
// <JobSpec | JobSpecTemplate>
```

### 3.e Say the spec in words - `PushChain.utils.job.describeJobSpec`

What `client.market.preview` shows on the signing screen, and what a card page renders. Pure; uses the ABI names captured by `prepare` when present, falls back to selector and address when describing a spec read from chain.

```tsx
// Function
const lines = PushChain.utils.job.describeJobSpec(spec, { options? })

// Usage and Params
const lines = PushChain.utils.job.describeJobSpec(spec, { principal: 500000000n, decimals: { [aUSDC]: 6 } });
// spec                JobSpec | JobSpecTemplate, required
// options.principal   bigint, optional                    resolves PRINCIPAL and principalBps targets into amounts
// options.decimals    Record<Address, number>, optional   formats token amounts

// Returns
// <Object> { checks: string[], logic: string, timing: string }
{
  checks: [
    'aUSDC balance of your wallet on Ethereum Sepolia is at least 499.95 USDC',
    'Aave USDC supply rate is at least 4%',
  ],
  logic: 'All of the above',
  timing: 'Executed by 2026-10-13 13:00 UTC; a fail is final after 15:00 UTC',   // empty on a template
}
```

### 3.f Dry-run the reads - `PushChain.utils.job.previewJobSpec`

Sends each read through `client.universal.read` now and runs the tree, so an author sees what the evaluator would see today. Not a verdict and not attested: a sanity check before registering a card or creating a job.

```tsx
// Function
const result = await PushChain.utils.job.previewJobSpec(spec, { options })

// Usage and Params
const result = await PushChain.utils.job.previewJobSpec(spec, { client, wallet: userWallet, principal: 500000000n });
// spec               JobSpec | JobSpecTemplate, required
// options.client     PushChainClient, required            the reads go through client.universal.read (open item 5)
// options.wallet     Address, required for a template     fills WALLET
// options.principal  bigint, required for a template      resolves PRINCIPAL and principalBps
// options.params     bigint[], optional                   fills { param: i }

// Returns
// <Object> { reads, checks, pass }
{
  reads: [
    {
      value: '0x...',
      decoded: 499960000n,
    },
    {
      value: '0x...',
      decoded: 41200000000000000000000000n,
    },
  ],
  checks: [
    {
      pass: true,
      value: 499960000n,
    },
    {
      pass: true,
      value: 41200000000000000000000000n,
    },
  ],
  pass: true,
}
```

### 3.g Check card rules - `PushChain.utils.market.validateAgentCardRules`

`AgentCardRules` is plain data, so there is no builder: the provider writes the object and this applies the contract's checks locally (1..8 assets, `principalAsset` in range, no duplicate token, 1..32 allowed calls, no `approve` or `increaseAllowance`, transfer-like calls pin their recipient, at most 8 approvals). `register` and `update` call it before signing; exported for card pages.

```tsx
// Function
PushChain.utils.market.validateAgentCardRules(rules)

// Usage and Params
PushChain.utils.market.validateAgentCardRules(rules);             // throws MarketError on the first failing check
// rules   AgentCardRules, required   as in 2.a

// Returns
// <void>
```

### 3.h Encode card rules - `PushChain.utils.market.encodeAgentCardRules`

The bytes `registerAgentCard` stores. Tokens resolve to PRC20s, selector strings to `bytes4`, pins to the argument offsets the contract checks, `PRINCIPAL` caps to the marker the contract binds at `openJob`. Same encoding the AGW uses for a rule, so a card's rules and the rule the wallet stores never disagree.

```tsx
// Function
const bytes = PushChain.utils.market.encodeAgentCardRules(rules, { options })

// Usage and Params
const bytes = PushChain.utils.market.encodeAgentCardRules(rules, { chain: CHAIN.ETHEREUM_SEPOLIA });
// rules           AgentCardRules, required   as in 2.a
// options.chain   CHAIN, required            the card's execution chain; needed to resolve tokens and offsets

// Returns
// <Hex>
```

### 3.i Decode card rules - `PushChain.utils.market.decodeAgentCardRules`

Back from the stored bytes to the object `register` took, tokens as the other chain's addresses again. What `card` uses to fill `rules`.

```tsx
// Function
const rules = PushChain.utils.market.decodeAgentCardRules(bytes, { options })

// Usage and Params
const rules = PushChain.utils.market.decodeAgentCardRules(card.rulesBytes, { chain: card.chain });
// bytes           Hex, required     as stored by registerAgentCard
// options.chain   CHAIN, required   the card's execution chain

// Returns
// <AgentCardRules>
```

# 4. Types

### 4.a Namespace

```tsx
interface MarketNamespace {
  cards(opts?: { provider?: Address; chain?: CHAIN; active?: boolean }): Promise<{ cards: AgentCardSummary[] }>;
  card(cardId: bigint): Promise<AgentCard>;
  preview(cardId: bigint, opts: PreviewOptions): Promise<JobPlan>;
  openJob(plan: JobPlan, opts?: { progressHook?: ProgressHook; relay?: boolean }): Promise<{ jobId: bigint; wallet: Address; rulesId: Hex; tx: UniversalTxResponse }>;
  deposit(jobId: bigint, opts?: { progressHook?: ProgressHook; skipApprovals?: boolean }): Promise<{ txs: DepositStep[] }>;
  job(jobId: bigint): Promise<{ cardId: bigint; cardVersion: number; wallet: Address; rulesId: Hex }>;
  activeJob(wallet: Address): Promise<{ jobId: bigint }>;
  agent: {
    register(card: AgentCardInput, opts: { rules: AgentCardRules; jobSpecTemplate: JobSpecTemplate; progressHook?: ProgressHook }): Promise<{ cardId: bigint; version: number; tx: UniversalTxResponse }>;
    update(cardId: bigint, card: AgentCardInput, opts: { rules: AgentCardRules; jobSpecTemplate: JobSpecTemplate; progressHook?: ProgressHook }): Promise<{ cardId: bigint; version: number; tx: UniversalTxResponse }>;
    setActive(cardId: bigint, active: boolean, opts?: { progressHook?: ProgressHook }): Promise<UniversalTxResponse>;
    card(): Promise<AgentCard | undefined>;
  };
}
```

### 4.b Cards and rules

```tsx
interface AgentCardInput {
  jobType: string;                       // stored as bytes32 (keccak of the string)
  metadataURI: string;
  metadataHash: Hex;
  chain: CHAIN;                          // the execution chain; stored as the full CAIP-2 string; immutable after registration
  providerFee: bigint;
  paymentToken: Address;                 // lands with K-12 on the kernel
  principalMin: bigint;
  principalMax: bigint;
  minDuration: number;
  maxDuration: number;
  minExecuteWindow: number;
  settleWindow: number;
}

interface AgentCard extends AgentCardInput {
  cardId: bigint;
  provider: Address;
  active: boolean;
  version: number;
  verified: boolean;
  disabled: boolean;
  rating: number;
  rules: AgentCardRules;
  jobSpecTemplate: JobSpecTemplate;
}

interface AgentCardSummary {
  cardId: bigint;
  provider: Address;
  jobType: string;
  chain: string;
  providerFee: bigint;
  paymentToken: Address;
  principalMin: bigint;
  principalMax: bigint;
  version: number;
  active: boolean;
  verified: boolean;
  rating: number;
}

interface AgentCardRules {               // the AGW Rule (page 5, 6.h) minus agent, chainNamespace, validUntil; plus two marketplace fields
  assets: AssetCapInput[];               // 1..8; PRINCIPAL only on assets[principalAsset]
  maxGasPerCall: bigint;                 // PC (wei) per outbound
  allowedCalls: AllowedCall[];           // 1..32, with pins, imported from page 5; no approve or increaseAllowance
  principalAsset: number;                // marketplace: index into assets
  approvals: ApprovalInput[];            // marketplace: the owner's, on the execution chain
}

interface AssetCapInput {
  token: MoveableToken | Address;        // the other chain's token address or the native marker; the SDK resolves to the PRC20
  maxPerCall: bigint | PrincipalMarker;  // PushChain.CONSTANTS.AGENTIC.PRINCIPAL
  maxTotal?: bigint | PrincipalMarker;
}

interface ApprovalInput {
  token: Address;                        // on the execution chain
  spender: Address;
  capIsPrincipal: boolean;
  cap?: bigint;                          // required when capIsPrincipal is false
}
```

### 4.c Plan and deposit

```tsx
interface PreviewOptions {
  principal: bigint;
  expiredAt: number;
  executeBy: number;
  params?: bigint[];
  walletIndex?: number;
}

interface JobPlan {
  cardId: bigint;
  cardVersion: number;
  wallet: Address;
  walletDeployed: boolean;
  session: Session;                      // the rules for this job, as the AGW stores them
  intent: OwnerIntent;                   // what the owner signs; from previewIntent
  calldata: Hex;                         // the createJob execution; from buildCreateJobCalldata
  jobSpec: {
    spec: JobSpec;
    bytes: Hex;
  };
  deposit: {
    principal: Funds;
    providerFee: Funds;
    pc: bigint;
    approvals: { token: Address; spender: Address; amount: bigint }[];
  };
  preview: {
    mayDo: string[];
    mayMove: string[];
    judgedBy: string[];
    until: string;
  };
}

interface DepositStep {
  step: 'PRINCIPAL' | 'PROVIDER_FEE' | 'PC' | 'APPROVAL';
  token?: Address;
  spender?: Address;
  tx: UniversalTxResponse;
}
```

`JobSpecTemplate` and `JobSpec` are the evaluator's wire format ([3. 8183 (job kernel and hook)](3%208183%20(job%20kernel%20and%20hook)%203e9188aea7f48188a838c3a740d8c858.md)); helpers to build and read them are in section 3 (`buildJobSpecTemplate`, `encodeJobSpec`, `decodeJobSpec`).

### 4.d Constants - `PushChain.CONSTANTS.AGENTIC` additions

Vocabulary for the spec and the two placeholders. `WALLET` already exists on page 5 (6.a); `PRINCIPAL` is new; the `JOB` members are new. No contract addresses here (page 5 decided addresses stay inside the SDK; the per-chain `JOB.ADDRESS` table is on page 7 because phase 2 needs the gateway address per chain). No limits here; the SDK enforces them and names the limit in the error.

```tsx
PushChain.CONSTANTS.AGENTIC.WALLET                                   // the user's wallet on the rule's or read's chain; pins, read args, check targets
PushChain.CONSTANTS.AGENTIC.PRINCIPAL                                // the job's principal; asset caps and check targets at 100%
PushChain.CONSTANTS.AGENTIC.JOB.EVALUATION.BOOLEAN | COMPARE | NUMBER | PERCENTAGE
PushChain.CONSTANTS.AGENTIC.JOB.OPERATION.EQUAL | NOT_EQUAL | GREATER_THAN | GREATER_OR_EQUAL | LESS_THAN | LESS_OR_EQUAL
PushChain.CONSTANTS.AGENTIC.JOB.LOGIC.ALL | ANY | AT_LEAST
PushChain.CONSTANTS.AGENTIC.JOB.ALLOWED_MUTABILITY.NONE | CLIENT | PROVIDER | BOTH
// enumerable, like PRESETS; the string each resolves to is the TypeScript literal type
```

### 4.e Errors and progress

```tsx
class MarketError extends AgenticError {}            // decoded from UniversalMarketplaceErrors, plus SDK-side checks

// codes (contract)   AGENT_CARD_INACTIVE, AGENT_CARD_VERSION_MISMATCH, PRINCIPAL_OUT_OF_RANGE, EXPIRY_OUT_OF_RANGE, EXECUTE_BY_OUT_OF_RANGE,
//                    PROVIDER_IS_EVALUATOR, PARAM_COUNT_MISMATCH, PARAM_OUT_OF_RANGE, WALLET_HAS_ACTIVE_JOB,
//                    AGENT_MISMATCH, ASSET_MISMATCH, GAS_CAP_MISMATCH, ACTIONS_MISMATCH, PRINCIPAL_CAP_MISMATCH, EXPIRY_MISMATCH, EXPECTED_CEA_MISMATCH
// codes (SDK)        CEA_MISMATCH (SDK derivation disagrees with computeCEA), STALE_PLAN (nonces moved since preview), NOT_CARD_PROVIDER

// progress events, MARKET-TX (PROPOSED)
//   MARKET-TX-101   plan built                 { cardId, wallet }
//   MARKET-TX-102   intent signed
//   MARKET-TX-103   openJob submitted           { relayed }
//   MARKET-TX-104   job opened                  { jobId, wallet, rulesId }
//   MARKET-TX-111   deposit step sent           { step, token? }
//   MARKET-TX-121   card registered or updated  { cardId, version }
//   MARKET-TX-199-01 done
//   MARKET-TX-199-02 failed                     { code, decodedError }
```

### 4.f Authoring helper types - `PushChain.utils.job`, `PushChain.utils.market`

```tsx
namespace PushChain.utils.market {
  validateAgentCardRules(rules: AgentCardRules): void;
  encodeAgentCardRules(rules: AgentCardRules, opts: { chain: CHAIN }): Hex;
  decodeAgentCardRules(bytes: Hex, opts: { chain: CHAIN }): AgentCardRules;
}

namespace PushChain.utils.job {
  buildJobSpec(opts: BuildJobSpecOptions): JobSpec;
  buildJobSpecTemplate(opts: BuildJobSpecTemplateOptions): JobSpecTemplate;
  encodeJobSpec(spec: JobSpec | JobSpecTemplate): Hex;
  decodeJobSpec(bytes: Hex): JobSpec | JobSpecTemplate;
  describeJobSpec(spec: JobSpec | JobSpecTemplate, opts?: { principal?: bigint; decimals?: Record<Address, number> }): { checks: string[]; logic: string; timing: string };
  previewJobSpec(spec: JobSpec | JobSpecTemplate, opts: { client: PushChainClient; wallet?: Address; principal?: bigint; params?: bigint[] }): Promise<PreviewResult>;
}

// client.universal.read.prepare: exactly the options of client.universal.read (chain, target, abi | idl, functionName, args), returns a PreparedRead without sending (core change, universal read change list item 6)
interface PreparedRead { chainNamespace: string; chainId: string; target: Address; selector: Hex; args: Hex; outputs: Hex }   // what read() would send, as data
interface ReadInput {            // what the builders take; a bare PreparedRead means field [0] and the chain's default confirmations
  read: PreparedRead;
  field?: number[];              // path to the value in the return; default [0]
  minConfirmations?: number;     // default per chain
}

// vocabulary; the string forms are what the constants resolve to
type Evaluation        = 'BOOLEAN' | 'COMPARE' | 'NUMBER' | 'PERCENTAGE';
type Operation         = 'EQUAL' | 'NOT_EQUAL' | 'GREATER_THAN' | 'GREATER_OR_EQUAL' | 'LESS_THAN' | 'LESS_OR_EQUAL';
type LogicKind         = 'ALL' | 'ANY' | 'AT_LEAST';
type AllowedMutability = 'NONE' | 'CLIENT' | 'PROVIDER' | 'BOTH';
type WalletMarker      = typeof PushChain.CONSTANTS.AGENTIC.WALLET;      // the user's wallet on the read's chain (page 5, 6.a)
type PrincipalMarker   = typeof PushChain.CONSTANTS.AGENTIC.PRINCIPAL;   // the job's principal

// mirrors JobSpecTypes.sol (page 4, section 0); field order is ABI
interface Read {
  chainNamespace: string;        // 'eip155' (namespace only; chainId beside it)
  chainId: string;
  minConfirmations: number;
  target: Address;
  selector: Hex;
  args: Hex;
  outputs: Hex;                  // type codes
  field: number[];
  fills?: Fill[];                // template reads only
}
interface Fill { word: number; source: 'WALLET' | 'PARAM'; param?: number }
interface Check         { read: number; evaluation: Evaluation; operation: Operation; target: bigint }
interface CheckTemplate { read: number; evaluation: Evaluation; operation: Operation; target: bigint | PrincipalMarker | { principalBps: bigint } | { param: number } }
interface LogicTree     { kind: LogicKind; of: (number | LogicTree)[]; k?: number }   // k only with AT_LEAST; a bare index is a check

interface JobSpec {
  reads: Read[];
  checks: Check[];
  logic: LogicTree;
  allowedMutability: AllowedMutability;
  origin: Hex;
  executeBy: number;
  failFinalAt: number;
}
interface JobSpecTemplate {           // the first four fields of JobSpec, plus params
  reads: Read[];
  checks: CheckTemplate[];
  logic: LogicTree;
  allowedMutability: AllowedMutability;
  params: { min: bigint; max: bigint }[];
}

interface PreviewResult {
  reads: { value: Hex; decoded: unknown }[];
  checks: { pass: boolean; value: unknown }[];
  pass: boolean;
}

class JobSpecError extends AgenticError { index?: number }
// codes   TOO_MANY_READS, TOO_MANY_CHECKS, TOO_MANY_LOGIC, TOO_MANY_PARAMS (the limit is in the message), BAD_TREE (dangling index, empty of, k out of range),
//         UNFILLED_PLACEHOLDER (a template passed where a JobSpec is needed), FAIL_WINDOW_THIN
```

# 5. Open for review

1. One card per provider. Decided 2026-10-12: enforced on-chain (`registerAgentCard` reverts `AgentCardAlreadyRegistered`), so `agent.card()` reads the one card and `agent.register` surfaces that revert as `MarketError` `CARD_EXISTS`.
2. Relayer for `openJob`. Decided 2026-10-12: the client submits in the default path; a relayed path can be added later without changing the signed intent. Not a v1 question.
3. Authoring helpers. Decided 2026-10-12: all of them live on this page (section 3), `PushChain.utils.job` for the spec and `PushChain.utils.market` for the rules, so the card author builds both halves of a card in one place. `client.evaluation` (page 8) is not kept as a namespace; its reads fold into `client.job`.
4. `cards` walks ids until an indexer exists; fine for a demo, not for a thousand cards. Definitions of what the contract exposes versus what needs an indexer requested (tagged 2026-10-12).
5. `previewJobSpec` through `client.universal.read` costs read fees and is faithful to what validators will see; a free `eth_call` fallback (`{ via: 'rpc' }`) is approximate and needs per-chain RPCs. Proposed: universal by default, rpc opt-in.
6. Non-EVM and web2 reads: `prepare` accepts whatever `client.universal.read` accepts (`idl` for Solana, the web2 destination), and the evaluator compares attested answers from any source. The gap is the on-chain `Read` struct, which is EVM-shaped today; tracked on page 4 (section 0, open item 3).
7. Whether `buildJobSpecTemplate` should derive a first draft of the `AgentCardRules` from the same reads (chains, contracts and selectors are all in there), or the author writes them separately (3.g to 3.i).
8. `client.universal.read.prepare` is a core change (universal read change list, item 6): same options as `read`, returns the read as data. Until it ships the builders cannot take reads.