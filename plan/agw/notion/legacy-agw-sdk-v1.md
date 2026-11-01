# PUSH AGW SDK Doc - v1

---

| Commit | [`67929f2`](https://github.com/pushchain/push-agentic-wallets/commit/67929f2) on branch `pushAgenticWallet_v3` |
| --- | --- |
| SDK target | [`@pushchain/core`](https://github.com/pushchain/push-chain-sdk/tree/main/packages/core) `6.0.25` at [`bf1dbff`](https://github.com/pushchain/push-chain-sdk/commit/bf1dbff) · TypeScript · `viem ^2.27` (dependency) · `tweetnacl` (optional peer, Ed25519) · jest + `__e2e__` |
| In scope | wallet creation, funding, owner execution, mandate grant / stop / replace, reads, the agent-card → mandate compiler (O9, forward-looking) |
| Out of scope |   • building, signing and submitting agent requests (**agent doc**) · 
  • ERC-8183 job creation, binding and settlement · 
  • TAP, Read State 
  • mandates to **SVM destinations** (URP’s allow-list is EVM-shaped: 20-byte `expectedCEA`, multicall payload) |

Snippets are TypeScript with `viem`, which is the SDK’s own encoding library. Every encoding is plain ABI.

### 0.1 AGW Addresses Addresses

> note: NO Pre-define addresses deployment is done yet. Once SDK initial checks are passed, I will make those deployments post that.
> 

 [`deployments/address-book-v3/ADDRESSES.md`](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/deployments/address-book-v3/ADDRESSES.md).

**The two you need.** Both are proxies; both addresses are permanent. Never address an implementation.

|  | Address |
| --- | --- |
| **Factory** | `0x2578041963f692f8b51A137A1c7ddc0c84a8226A` |
| **URP** | `0xeAd99E254ACD64219d057400cdC2A2390bC74372` |

**Everything we deploy**

| Key | Address | Verified |
| --- | --- | --- |
| `factoryProxy` | `0x2578041963f692f8b51A137A1c7ddc0c84a8226A` | ✅ |
| `factoryLogic` | `0x517a10C2F2E786CC8271dbD489dFE27dE8F7BE67` | ✅ |
| `walletImplementation` | `0xD7FEF338572f96edBeF89E720f1F0fF1284ec79C` | ✅ |
| `urp` (proxy) | `0xeAd99E254ACD64219d057400cdC2A2390bC74372` | ✅ |
| `urpImplementation` | `0xc95f179D3aDE283E11CF90f3F8E04BFE8534ff4F` | ✅ |
| `urpProxyAdmin` | `0xA634a0cB4F374D89B2cccbdc77300c8Ac3827BF4` | ✅ |
| `sessionValidator` | `0xF77660838Cebb65BD6357FDe71d19f97CC65E829` | ✅ |
| `sessionEngine` | `0x046B2874Fc9F920ad53A317b3cf9d3d1974466f3` | ✅ |

**External dependencies (not deployed by this repo)**

| Key | Address | Note |
| --- | --- | --- |
| `universalGatewayPC` | `0x00000000000000000000000000000000000000C1` | the one target a universal mandate may name |
| `universalCore` | `0x00000000000000000000000000000000000000C0` | outbound fee quotes |
| `ueaFactory` | `0x00000000000000000000000000000000000000eA` | maps external wallets → UEAs on Push. **Not** the CEA factory and not a runtime dependency |
| `universalExecutorModule` | `0x14191Ea54B4c176fCf86f51b0FAc7CB1E71Df7d7` | **no code** (`cast code` → `0x`, re-read on Donut 2026-09-18); gates `creditRevert` only, so the revert-credit path is unreachable and spend counters never decrease |
| `usv` (Ed25519 precompile) | `0xEC00000000000000000000000000000000000001` | codeless by design |
| `USDC.eth` (PRC20, example asset) | `0x7A58048036206bB898008b5bBDA85697DB1e5d66` | `SOURCE_CHAIN_NAMESPACE()` → `"eip155:11155111"` |

#### 0.2 Contracts Details

| Contract | Role, in one line | Source | Address on Push |
| --- | --- | --- | --- |
| `AGWFactory` | Deploys wallet clones at predictable addresses; registry of wallet → owner | [src/AGWFactory.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/AGWFactory.sol) | `0x2578041963f692f8b51A137A1c7ddc0c84a8226A` (proxy) |
| `PushAgentWallet` | Holds funds; owner door `execute`, agent door `executeWithSession`, mandate `grant` / `stop` / `stopAll` | [src/PushAgentWallet.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/PushAgentWallet.sol) | `0xD7FEF338572f96edBeF89E720f1F0fF1284ec79C` (implementation; every wallet is a clone of it) |
| `URP` | The policy: checks every agent request against the mandate’s terms, meters spend, fails closed | [src/policies/URP.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/policies/URP.sol) | `0xeAd99E254ACD64219d057400cdC2A2390bC74372` (proxy) |
| `PushSessionValidator` | Stateless signature check: secp256k1 or Ed25519 via the USV precompile | [src/validators/PushSessionValidator.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/validators/PushSessionValidator.sol) | `0xF77660838Cebb65BD6357FDe71d19f97CC65E829` |
| `SmartSession` | Session engine: stores mandates, runs URP, deletes on revoke; the wallet’s only installed validator module | [lib/smartsessions](https://github.com/pushchain/push-agentic-wallets/tree/pushAgenticWallet_v3/lib/smartsessions) | `0x046B2874Fc9F920ad53A317b3cf9d3d1974466f3` |
| `ProxyAdmin` (URP) | Upgrade authority for URP; the SDK never calls it | OpenZeppelin 5.7.0 | `0xA634a0cB4F374D89B2cccbdc77300c8Ac3827BF4` |

Shared type and error files the SDK mirrors:

- [src/libraries/PushWalletTypes.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/libraries/PushWalletTypes.sol) — gateway struct mirrors, selectors, `OP_HASH_DOMAIN`
- [src/interfaces/IURP.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/interfaces/IURP.sol) — `UniversalTerms`, `NativeTerms`, views, errors
- [src/libraries/PushWalletErrors.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/libraries/PushWalletErrors.sol) — wallet errors
- [src/interfaces/IPushAgentWallet.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/interfaces/IPushAgentWallet.sol) — wallet events
- [src/libraries/ExecutionLib.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/src/libraries/ExecutionLib.sol) — single / batch execution encoding

#### 0.3 Docs

- [docs/](https://github.com/pushchain/push-agentic-wallets/tree/pushAgenticWallet_v3/docs) — narrative docs
    - [v3-architecture.md](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/docs/v3-architecture.md) — the architecture
    - [agentic_wallet_flow.md](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/docs/agentic_wallet_flow.md) — cross-chain (UNIVERSAL) worked example
    - [push_native_agentic_wallet_flow.md](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/docs/push_native_agentic_wallet_flow.md) — Push-side (NATIVE) worked example
- [deployments/address-book-v3/](https://github.com/pushchain/push-agentic-wallets/tree/pushAgenticWallet_v3/deployments/address-book-v3) — addresses, live checks, what changed from v2
- [README.md](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/README.md) · [CLAUDE.md](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/CLAUDE.md) — conventions and invariants
- [test/Base.t.sol](https://github.com/pushchain/push-agentic-wallets/blob/pushAgenticWallet_v3/test/Base.t.sol) — the canonical session / envelope / signature builders; generate SDK test vectors from these
- [push-chain-sdk/plan/read-state-sdk-spec.md](https://github.com/pushchain/push-chain-sdk/blob/main/plan/read-state-sdk-spec.md) — the SDK team’s prior contract→SDK spec; this doc follows its conventions
- [AGW-SDK-v1-agent.md](./AGW-SDK-v1-agent.md) — the agent half
- [05-universal-marketplace-startjob.md](./05-universal-marketplace-startjob.md) · [SDK_HELPER.md](./SDK_HELPER.md) — the marketplace vision and card design O9 compiles from (both work in progress)

---

## 1 · Mental models for AGW

### 1.1 Actors

1. **Wallet_Owner** — any `UniversalSigner` (Sepolia, Solana or Push-native). 
    1. On chain the owner is `client.universal.account`: the user’s UEA for external-origin signers, the EOA itself for Push-native. 
    2. It is `msg.sender` of `deployWallet` and is recorded forever. Deploys, funds, grants, stops, uses the owner door; every write goes through `client.universal.sendTransaction`, so UEA routing and gas abstraction apply unchanged.
2. **Agent** — 
    1. holds a session key (secp256k1 address or Ed25519 pubkey) that signs the op hash, plus a funded Push account that submits `executeWithSession` and pays that tx’s gas. 
    2. The two may be the same key. The door is permissionless, so any funded account can submit an agent-signed request; v1 has the Agent submit its own.

### 1.2 The system

- One wallet = one EIP-1167 clone with 40 bytes of immutable args (`owner`, `factory`). Owner is fixed forever.
- **Owner door**
    - `execute(mode, executionCalldata)`: owner only; no policy is consulted. Single or batch.
- **Agent door**
    - `executeWithSession(...)`: anyone may call; authority is the signature + nonce + op hash, then URP. Single call only.
- **Mandate** = one SmartSession `Session`: an agent key + 1..8 `(target, selector)` actions, each with exactly one policy, URP, whose `initData` carries the terms.
- Mandates are immutable.
    - **For now changing mandate means:**
        - stop old mandate
        - grant new mandate
        - Revocation is immediate and always succeeds.
- The wallet’s balance is the hard ceiling: nothing the agent does can move more than the wallet holds.

### 1.3 The three important ids

```solidity
permissionId = keccak256(abi.encode(sessionValidator, sessionValidatorInitData, salt))
// salt = bytes32(uint256(wallet.grantNonce())) — LEFT-padded, i.e. nonce 3 is
// 0x0000…0003, never 0x0300…0000. The wallet overwrites whatever salt you sent.

actionId     = keccak256(abi.encodePacked(target, selector))

configId     = keccak256(abi.encodePacked(wallet, keccak256(abi.encodePacked(permissionId, actionId))))
```

**`permissionId` — the mandate.**

- One per `grantMandate` call. The id an owner revokes and an agent signs against.
- Derived from the agent key config + the wallet’s grant nonce → identical terms granted twice yield different ids; a revoked id never recurs.
- Used in: agent signature prefix · op hash field 5 · `stopMandate` · `isPermissionEnabled` · `getSessionValidatorAndConfig` · `getEnabledActions` · `MandateGranted` / `MandateRevoked` / `MandateActionAuthorized` · `SessionCreated` / `SessionRemoved`.

**`actionId` — one `(target, selector)` pair.**

- Global, not per-wallet or per-mandate: `(Aave, supply)` is the same actionId for every user.
- Says which function a request hits; carries no terms.
- Used in: input to `configId` · returned by `getEnabledActions` · argument to `getActionPolicies`.

**`configId` — one action’s URP terms, in one mandate, on one wallet.**

- The row URP reads caps and spend counters from. Native mandate with 3 actions → 3 configIds; universal → exactly 1.
- Used in: `urp.getMode` / `getConfig` / `getNativeConfig` / `assertSpent` · `URPPolicySet` / `OutboundMetered` / `NativeCallMetered` events.

⚠️ `abi.encode` (padded) at level 1, `abi.encodePacked` (tight) at levels 2 and 3. Using one throughout derives every `configId` wrong and reads zeros back from URP.

### 1.4 SDK object model

Design rules, mirroring the shipped `universal.*` family:

- One namespace on the client: `client.agentWallet.*`. Every write has a `prepare*` twin that returns `MultiCall[]`, so callers batch it into one `sendTransaction({ data: MultiCall[] })` signature.
- The SDK computes what the dev cannot guess: chain string, `expectedCEA`, ids, offsets, caps. The dev supplies wallet, agent key, terms, principal.
- Pure encoders and id derivations live under `PushChain.utils.agentWallet.*`; addresses, selectors and limits under `PushChain.CONSTANTS.AGENT_WALLET[network]`.
- Errors are typed classes with a `code`, `AgentWalletError` base (the `PC20Error` pattern). On-chain custom errors are decoded from the AGW ABIs and re-thrown as `AgentWalletRevertError { name, args }`.
- Progress family `AGW-TX-1xx`, same grammar as `SEND-TX`.

```tsx
// ── method family ────────────────────────────────────────────────────────
client.agentWallet.predict(index?)                       // → { address, deployed }      (owner = client.universal.account)
client.agentWallet.deploy(label)                         // → { address, index, txHash }
client.agentWallet.list()                                // → Address[]                  walletCount + predictWallet(0..n-1)
client.agentWallet.wallet(address)                       // → Wallet handle

wallet.balances(assets?)                                 // → { pc, tokens }
wallet.execute(calls, { value? })                        // owner door, single or batch
wallet.approveGateway(asset, amount)                     // Push-side allowance for universal mandates (see O2)
wallet.grant(terms)                                      // → { permissionId, txHash }
wallet.stop(permissionId) · wallet.stopAll()
wallet.replace(oldId, expectedSpent, terms)              // assert → stop → grant, one owner-door batch
wallet.mandates() · wallet.mandate(permissionId)         // → Mandate (read model)
wallet.nonce(lane)

wallet.prepareDeploy / prepareApproveGateway / prepareGrant / prepareStop / prepareReplace   // → MultiCall[]

PushChain.utils.agentWallet.compile(card, userInput, chainContext)        // agent card → Session (O9); pure, deterministic

// agent surface — client.agentWallet.request(...), AgentSigner, AgentRequest — see the AGENT DOC

PushChain.utils.agentWallet.{ permissionId, actionId, configId, envelope, encodeSession, encodeNativeTerms, encodeUniversalTerms, encodeSingle, encodeBatch }
PushChain.CONSTANTS.AGENT_WALLET[PUSH_NETWORK.TESTNET_DONUT] = { FACTORY, URP, SESSION_VALIDATOR, SESSION_ENGINE, SEND_OUTBOUND_SELECTOR, OP_HASH_DOMAIN, MAX_NATIVE_ACTIONS, MAX_PINS, MAX_ALLOWED_CALLS, MAX_ACTIONS_PER_REQUEST }
```

#### OWNER SIDE TYPES

```tsx
// ── owner side types ─────────────────────────────────────────────────────
type Call = { target: Address; value: bigint; data: Hex };

type AgentKey = { scheme: 0; address: Address } | { scheme: 1; pubKey: Hex /* 32 bytes */ };

// THE CALLER NEVER STATES A MANDATE KIND. It states a chain; the wallet and URP derive the rest.
// The two shapes are told apart by `chain`: omitted (or this chain) → Push-side; a foreign chain → outbound.
type MandateTerms = NativeMandateTerms | UniversalMandateTerms;

type NativeMandateTerms = {
  chain?: never;                      // omit it; SDK emits `eip155:<chainid>` of the connected Push chain
  agent: AgentKey;
  validUntil: number;                 // unix seconds; 2^48-1 = never
  actions: NativeAction[];            // 1..8, unique (target, selector)
};
type NativeAction = {
  target: Address;
  selector: Hex;                      // 4 bytes; 0xFFFFFFFF = value-only (empty calldata)
  maxValuePerCall: bigint;            // PC
  maxValueTotal: bigint;              // PC; 2^256-1 = unlimited
  maxCalls: number;                   // 0 = unlimited
  pins: { offset: number; expected: Hex }[];                              // ≤ 8
  amount?: { offset: number; maxPerCall: bigint; maxTotal: bigint };      // one metered uint256 arg
};

type UniversalMandateTerms = {
  chain: ForeignChain;                // destination, e.g. CHAIN.ETHEREUM_SEPOLIA. Required, and the ONLY kind signal.
                                      // `ForeignChain` = Exclude<CHAIN, PushChains | SvmChains> — EVM only in v1
  agent: AgentKey;
  validUntil: number;
  asset: Address;                     // PRC20 on Push; SDK asserts asset.SOURCE_CHAIN_NAMESPACE() === chain
  expectedCEA?: Address;              // omit it — SDK derives it. See "expectedCEA, defined once" below.
  maxAmountPerCall: bigint;
  maxAmountTotal: bigint;             // 2^256-1 = unlimited
  maxPCPerCall: bigint;               // PC attached per outbound (protocol fee + gas swap)
  allowedCalls: AllowedCall[];        // 1..32
};
type AllowedCall = { target: Address; selector: Hex; beneficiaryOffset: number; hasBeneficiary: boolean; maxValue: bigint };

// read model, built from views + events. `mode` here is REPORTED, not chosen: it is what
// urp.getMode(configId, wallet) decoded. The only place the two names appear in the SDK.
type Mandate = {
  wallet: Address; permissionId: Hex; enabled: boolean;
  mode: 'NATIVE' | 'UNIVERSAL'; chain: string; chainHash: Hex;
  agent: AgentKey; validUntil: number;
  actions: { configId: Hex; target: Address; selector: Hex; terms: NativeAction | UniversalMandateTerms; spent: Spent }[];
};
type Spent = { spent: bigint } | { valueSpent: bigint; amountSpent: bigint; callsUsed: number };
```

---

## 2 · Operations

The following operations are part of WALLET-OWNER Side of the SDK

1. O1 · Predict and deploy a wallet
2. O2 · Fund
3. O3 · Owner execute
4. O4 · Build a mandate for Push-side actions (derives NATIVE)
5. O5 · Build a mandate for a foreign chain (derives UNIVERSAL)
6. O6 · Pre-flight and grant
7. O7 · Stop
8. O8 · Replace a mandate atomically (assert → stop → grant)
9. *O9 · **Additional:** Compile an agent card into a mandate* 

---

#### SetUP

```tsx
import { encodeAbiParameters, encodePacked, encodeFunctionData, keccak256, concat, pad, toHex } from 'viem';
import { PushChain, CHAIN, getCEAAddress, CEA_FACTORY_ADDRESSES, VAULT_ADDRESSES, UEA_MULTICALL_SELECTOR } from '@pushchain/core';
const { encodeTxData } = PushChain.utils.helpers;
const client = await PushChain.initialize(universalSigner, { network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT });

const FACTORY   = '0x2578041963f692f8b51A137A1c7ddc0c84a8226A';
const URP       = '0xeAd99E254ACD64219d057400cdC2A2390bC74372';
const VALIDATOR = '0xF77660838Cebb65BD6357FDe71d19f97CC65E829';
const ENGINE    = '0x046B2874Fc9F920ad53A317b3cf9d3d1974466f3';
const GATEWAY   = '0x00000000000000000000000000000000000000C1';
const CORE      = '0x00000000000000000000000000000000000000C0';

const MODE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000'; // callType 0x00, execType 0x00
const MODE_BATCH  = '0x0100000000000000000000000000000000000000000000000000000000000000'; // callType 0x01, execType 0x00
const SEND_OUTBOUND_SELECTOR = '0x77b86bec';
const MULTICALL_SELECTOR     = UEA_MULTICALL_SELECTOR;   // '0x2cc2842d' = bytes4(keccak256("UEA_MULTICALL")), already in the SDK
const OP_HASH_DOMAIN = '0xee007baac915cb5cecf254fbc38928446424413e2083e43f2155c71b8bf768fe'; // keccak256("PushAgentWallet.Op.v3")
const VALUE_ONLY = '0xFFFFFFFF';
const UNLIMITED  = 2n ** 256n - 1n;
const NEVER      = 2 ** 48 - 1;
```

### Owner operations

#### O1 · Predict and deploy a wallet

```tsx
const owner = client.universal.account;                                      // UEA or Push EOA
const index = await factory.read.walletCount([owner]);                       // next index
const [predicted, deployed] = await factory.read.predictWallet([owner, index]);

const data = PushChain.utils.helpers.encodeTxData({ abi: factoryAbi, functionName: 'deployWallet', args: ['my first wallet'] });
const res = await client.universal.sendTransaction({ to: FACTORY, data });   // msg.sender = owner
// event WalletDeployed(owner indexed, index indexed, wallet indexed, label)
```

1. Caller of `deployWallet` **is** the owner; there is no owner parameter. For an external-origin user the caller is their UEA, so the UEA owns the wallet. 
    
    read about ownership structure of AGW here if needed → [2. Rule 2 — Ownership is a strict, single-parent chain, rooted in the user's EOA](https://app.notion.com/p/2-Rule-2-Ownership-is-a-strict-single-parent-chain-rooted-in-the-user-s-EOA-3b9188aea7f48012b934e3598ec929a5?pvs=21) 
    
2. Local address mirror (for offline prediction): `salt = keccak256(abi.encode(owner, uint96(index)))`, `args = abi.encodePacked(owner, FACTORY)`, OZ `Clones.predictDeterministicAddressWithImmutableArgs(impl, args, salt, FACTORY)`.
3. Verify the mirror against `predictWallet` before showing a funding address. (`abi.encode` pads `uint96` to a full word, so encoding the index as `uint256` gives the same salt for every reachable index — `IndexOutOfRange` caps it far below 2^96.)
4. Counterfactual funding is supported: fund `predicted` before deploying. `predictWallet` reverts `IndexOutOfRange` for `index > walletCount`; never fund beyond that.
5. `label` is emitted only, never stored.

#### O2 · Fund

```tsx
await owner.sendTransaction({ to: wallet, value: pc });                       // wallet has receive()
await prc20.write.transfer([wallet, amount]);                                // any PRC20 / ERC-20
const pcBal = await client.getBalance({ address: wallet });
const tokBal = await prc20.read.balanceOf([wallet]);
```

- The wallet needs **PC** for: `value` on native actions; `value` on every universal outbound (protocol fee + gas swap, capped by `maxPCPerCall`). The agent’s tx gas is paid by the submitter, never by the wallet.
- **Universal mandates need a Push-side allowance.** `sendUniversalTxOutbound` pulls the PRC20 with `transferFrom(msg.sender = wallet, …)` before burning (`UniversalGatewayPC.sol:134, 288`). Without it every agent request with `amount > 0` reverts inside the gateway. Owner sets it through the owner door, once, sized to the mandate:

```tsx
// wallet.approveGateway(asset, maxAmountTotal)  ≡  owner-door batch:
const calls = [
  { target: asset, value: 0n, data: encodeTxData({ abi: ERC20_EVM, functionName: 'approve', args: [GATEWAY, 0n] }) },      // reset first (USDT-style tokens)
  { target: asset, value: 0n, data: encodeTxData({ abi: ERC20_EVM, functionName: 'approve', args: [GATEWAY, maxAmountTotal] }) },
];
await wallet.execute(calls);            // or prepareApproveGateway() → MultiCall[] batched with the grant
```

- The allowance is not a policy: it is the wallet’s spending ceiling at the gateway, independent of URP’s caps. Reset it to 0 on `stop` if the mandate was the only reason for it.
- Universal quote (the SDK’s outbound path already does this; reuse `sizeOutboundGas` / `quoteMaxPCForGasCapFromNativeValue`):

```tsx
const [gasToken, gasFee, protocolFee, gasPrice, chainNamespace, gasLimitUsed] =
  await core.read.getOutboundTxGasAndFees([asset, gasLimit]);               // gasLimit 0 = chain default
// gateway requires msg.value >= protocolFee; the remainder is swapped to gasToken; unused PC refunds to the wallet
```

#### O3 · Owner execute

```tsx
const single = encodePacked(['address', 'uint256', 'bytes'], [target, value, data]);
await wallet.write.execute([MODE_SINGLE, single], { value });

const batch = encodeAbiParameters(
  [{ type: 'tuple[]', components: [{ type: 'address', name: 'target' }, { type: 'uint256', name: 'value' }, { type: 'bytes', name: 'callData' }] }],
  [calls],
);
await wallet.write.execute([MODE_BATCH, batch]);
// event OwnerExecuted(mode indexed, keccak256(executionCalldata))
```

- SINGLE is `abi.encodePacked` (52-byte header),
- BATCH is `abi.encode(Execution[])`. Not interchangeable.
- Target reverts bubble verbatim. Delegatecall / static / try modes → `UnsupportedExecutionMode`.
- This is the only withdrawal path.
- It also carries self-calls to `grantMandate` / `stopMandate` / `stopAll` (see O8).

#### O4 · Build a mandate for Push-side actions (derives NATIVE)

```tsx
const chain = `eip155:${chainId}`;                                            // "eip155:42101" on Donut
// assert: keccak256(toHex(chain)) === await urp.read.pushChainHash()

const NATIVE_TERMS = { type: 'tuple', components: [
  { type: 'uint48', name: 'validUntil' }, { type: 'address', name: 'target' }, { type: 'bytes4', name: 'selector' },
  { type: 'uint256', name: 'maxValuePerCall' }, { type: 'uint256', name: 'maxValueTotal' },
  { type: 'tuple', name: 'amount', components: [{ type: 'bool', name: 'enabled' }, { type: 'uint16', name: 'offset' }, { type: 'uint256', name: 'maxPerCall' }, { type: 'uint256', name: 'maxTotal' }] },
  { type: 'uint32', name: 'maxCalls' },
  { type: 'tuple[]', name: 'pins', components: [{ type: 'uint16', name: 'offset' }, { type: 'bytes32', name: 'expected' }] },
]};

function nativeAction(a: NativeAction, validUntil: number) {
  const body = encodeAbiParameters([NATIVE_TERMS], [{
    validUntil, target: a.target, selector: a.selector,
    maxValuePerCall: a.maxValuePerCall, maxValueTotal: a.maxValueTotal,
    amount: a.amount ? { enabled: true, ...a.amount } : { enabled: false, offset: 0, maxPerCall: 0n, maxTotal: 0n },
    maxCalls: a.maxCalls, pins: a.pins,
  }]);
  const initData = encodeAbiParameters([{ type: 'string' }, { type: 'bytes' }], [chain, body]);   // the envelope
  return { actionTargetSelector: a.selector, actionTarget: a.target, actionPolicies: [{ policy: URP, initData }] };
}
```

- One `NativeTerms` per action. `terms.target` / `terms.selector` must equal the action’s; URP asserts both at runtime (N4, N5).
- **Offsets** are absolute from byte 0 of the calldata, selector included: static argument `i` sits at `4 + 32*i`. Only static-position arguments can be pinned or metered; a role on a dynamic argument (`bytes`, `string`, arrays) is a compile error in the SDK.
- `pins[].expected` is the full 32-byte word: an address is left-padded (`pad(address, { size: 32 })`).
- Value-only action: `selector = 0xFFFFFFFF`, agent sends empty calldata; pins and amount rule must be absent.
- Limits: 1..8 actions; ≤ 8 pins per action; no duplicate `(target, selector)`.
- Forbidden targets: `0x0`, `0x1`, the wallet, engine, URP, validator, factory → `ForbiddenActionTarget`; the gateway → `MandateTypeMismatch`. Forbidden selectors `0x00000001`, `0x00000002`.
- `maxCalls = 0` unlimited; `maxValueTotal = UNLIMITED`; `amount.maxTotal = UNLIMITED`.

### O5 · Mandates

#### Mandates from Smart Contract POV

```solidity
function grantMandate(Session calldata session) external returns (bytes32 permissionId);
//       selector 0xa3e13323 · onlyOwnerOrSelf

struct Session {
    ISessionValidator sessionValidator;      // fixed: PushSessionValidator
    bytes             sessionValidatorInitData;  // abi.encode(uint8 scheme, bytes key) — the agent key
    bytes32           salt;                  // IGNORED — the wallet overwrites it with its grant nonce
    PolicyData[]      userOpPolicies;        // must be empty
    ERC7739Data       erc7739Policies;       // must be empty (both inner arrays)
    ActionData[]      actions;               // 1..8 Push-side · exactly 1 outbound
    bool              permitERC4337Paymaster;// must be false
}

struct ActionData {
    bytes4       actionTargetSelector;       // ⚠ SELECTOR FIRST — declaration order, not (target, selector)
    address      actionTarget;
    PolicyData[] actionPolicies;             // exactly one entry, and it must be URP
}

struct PolicyData {
    address policy;                          // fixed: URP
    bytes   initData;                         // abi.encode(string chain, bytes body) — "the envelope"
}

```

| Field | What it is | Who sets it |
| --- | --- | --- |
| `sessionValidator` | the one validator this system accepts; anything else → `MalformedSessionShape` | fixed constant |
| `sessionValidatorInitData` | **the agent's key.** `abi.encode(uint8 scheme, bytes key)` — scheme 0 = 20-byte address, scheme 1 = 32-byte Ed25519 pubkey. Part of `permissionId`, so it can never be swapped | SDK, from the agent |
| `salt` | send `bytes32(0)`. The wallet replaces it with `grantNonce`, which is what makes every grant a distinct `permissionId` | wallet |
| `userOpPolicies` · `erc7739Policies` · `permitERC4337Paymaster` | dead surface for this wallet; non-empty / true → `MalformedSessionShape` | empty / empty / false |
| `actions[]` | **what the agent may call.** One entry per `(target, selector)` pair | SDK, from the terms |
| `actions[].actionPolicies` | exactly `[{ policy: URP, initData: envelope }]`. One policy, and it must be URP | SDK |
| `initData` (the envelope) | `abi.encode(string chain, bytes body)`. **`chain` decides the rulebook** — this chain → Push-side, any other → outbound. `body` is the terms | SDK |

The envelope's `body` is one of two wire structs, matching the rulebook the chain derived:

- NATIVE TERMS - only for agentic workflow exec on Push Chain
- Universal Terms - for agentic workflow on external chains

```solidity
struct NativeTerms {                         // Push-side — one per action
    uint48     validUntil;                   // unix seconds; type(uint48).max = never
    address    target;                       // must equal this action's actionTarget
    bytes4     selector;                     // must equal this action's actionTargetSelector
    uint256    maxValuePerCall;              // PC attachable per call
    uint256    maxValueTotal;                // PC lifetime; type(uint256).max = unlimited
    AmountRule amount;                       // optional metering of ONE uint256 argument
    uint32     maxCalls;                     // 0 = unlimited
    ArgPin[]   pins;                         // 0..8 pinned argument words
}

struct AmountRule { bool enabled; uint16 offset; uint256 maxPerCall; uint256 maxTotal; }
struct ArgPin     { uint16 offset; bytes32 expected; }

struct UniversalTerms {                      // outbound — exactly one, for the gateway action
    uint48        validUntil;
    address       expectedCEA;               // the wallet's account on the destination chain
    address       asset;                     // the one permitted PRC20 on Push
    uint256       maxAmountPerCall;          // bridged amount per call
    uint256       maxAmountTotal;            // bridged lifetime; max = unlimited
    uint256       maxPCPerCall;              // PC attached per outbound (protocol fee + gas swap)
    AllowedCall[] allowedCalls;              // 1..32 destination-chain calls the agent may make
}

struct AllowedCall {
    address target;                          // destination-chain contract
    bytes4  selector;                        // destination-chain function
    uint16  beneficiaryOffset;               // where the beneficiary word sits in the INNER calldata
    bool    hasBeneficiary;                  // false for calls with no beneficiary argument
    uint256 maxValue;                        // per-entry native ceiling, DESTINATION-chain units
}

```

**1.  Build each action (derives NATIVE)**

couple of notes here:

1. on chain id

```tsx
const chain = `eip155:${chainId}`;                         
// "eip155:42101" on Donut
// assert: keccak256(toHex(chain)) === await urp.read.pushChainHash()
```

- must Byte-exact or nothing.
- `"EIP155:42101"`, `"eip155:042101"` and a leading space all hash to not-Push, derive the *outbound* rulebook, and are then refused against the targets with `MandateTypeMismatch`.
- The contracts do not parse or normalise — the hash comparison is the whole rule.

```tsx
const NATIVE_TERMS = { type: 'tuple', components: [
  { type: 'uint48', name: 'validUntil' }, { type: 'address', name: 'target' }, { type: 'bytes4', name: 'selector' },
  { type: 'uint256', name: 'maxValuePerCall' }, { type: 'uint256', name: 'maxValueTotal' },
  { type: 'tuple', name: 'amount', components: [{ type: 'bool', name: 'enabled' }, { type: 'uint16', name: 'offset' }, { type: 'uint256', name: 'maxPerCall' }, { type: 'uint256', name: 'maxTotal' }] },
  { type: 'uint32', name: 'maxCalls' },
  { type: 'tuple[]', name: 'pins', components: [{ type: 'uint16', name: 'offset' }, { type: 'bytes32', name: 'expected' }] },
]};

function nativeAction(a: NativeAction, validUntil: number) {
  const body = encodeAbiParameters([NATIVE_TERMS], [{
    validUntil, target: a.target, selector: a.selector,
    maxValuePerCall: a.maxValuePerCall, maxValueTotal: a.maxValueTotal,
    amount: a.amount ? { enabled: true, ...a.amount } : { enabled: false, offset: 0, maxPerCall: 0n, maxTotal: 0n },
    maxCalls: a.maxCalls, pins: a.pins,
  }]);
  const initData = encodeAbiParameters([{ type: 'string' }, { type: 'bytes' }], [chain, body]);   // the envelope
  return { actionTargetSelector: a.selector, actionTarget: a.target, actionPolicies: [{ policy: URP, initData }] };
}

const actions = terms.actions.map(a => nativeAction(a, validUntil));   // 1..8

```

#### **Rules for Native Action**

| Rule | Violation |
| --- | --- |
| 1..8 actions | `TooManyActions(count)` |
| no duplicate `(target, selector)` | `DuplicateAction(target, selector)` |
| every action names the same chain | `InconsistentChain(actionIndex)` |
| `terms.target` / `terms.selector` equal the action's | passes at grant, fails every request at N4 / N5 |

**Targets and selectors**

| Forbidden | Why | Error |
| --- | --- | --- |
| `0x0`, `0x1`, the wallet, engine, URP, validator, factory | an agent reaching these could re-grant itself | `ForbiddenActionTarget(target)` |
| the gateway `0x…C1` | that is an outbound call, not a Push-side one | `MandateTypeMismatch(derived, i, target)` |
| selectors `0x00000001`, `0x00000002` | engine wildcard sentinels | `ForbiddenActionSelector(selector)` |

**Arguments — pins and metering**

- Offsets are **absolute from byte 0 of the calldata, selector included**: static argument `i` sits at `4 + 32*i`.
- Only static-position arguments can be pinned or metered. A role on a dynamic argument (`bytes`, `string`, arrays) is a compile error in the SDK — the offset would point at a length word, not the value.
- `pins[].expected` is the **full 32-byte word**. An address must be left-padded (`pad(address, { size: 32 })`); a dirty high half is a mismatch, deliberately.
- `amount` meters **one** `uint256` argument. A function with two value-moving arguments has one bounded and one free.

**Value-only actions** (a bare PC transfer)

- `selector = 0xFFFFFFFF`, and the agent must send **exactly empty** calldata.
- `pins` and `amount` must be absent — `ValueOnlyWithPins` / `ValueOnlyWithAmountRule` at init.
- A no-argument function like `unstake()` still carries its four bytes and is a normal selector action, not this.

**Defaults**

`maxCalls = 0` unlimited · `maxValueTotal = UNLIMITED` unlimited · `amount.maxTotal = UNLIMITED` unlimited · `validUntil = NEVER` for no expiry (but zero and past are refused with `InvalidExpiry`).

**2.  Build each action (derives Universal)**

**couple of notes**

1. The chain string and the asset
    
    ```tsx
    const chain = terms.chain;                                   // CHAIN.ETHEREUM_SEPOLIA === 'eip155:11155111'
    const assetChain = await prc20.read.SOURCE_CHAIN_NAMESPACE();          // add to the PRC20 ABI
    if (assetChain !== chain) throw new AssetChainMismatchError(chain, assetChain);
    ```
    
    - Read the chain string **from the asset**, never type it. \
    - At grant URP asks the same PRC20 the same question and refuses on a mismatch (`ChainMismatch`) or an asset that cannot answer (`InvalidAsset`).
    - That single check is what makes the declared chain true for the mandate's whole life.

b. on **`*expectedCEA()`**:* 

```tsx
const { cea: expectedCEA } = await getCEAAddress(wallet, chain);   
// CEAFactory.getCEAForPushAccount(wallet)
```

- *the wallet's account on the destination chain. The AGW exists only on Push, so bridged funds land in its mirror account over there, and that account runs the multicall. URP records it and every inner call must name it as the beneficiary, which is what keeps the output of the work coming back to the user.*
- Derived from the **AGW address**, not the owner's UEA — the AGW is `msg.sender` of `sendUniversalTxOutbound`, so the gateway resolves the CEA from the wallet. Returned whether or not it is deployed yet; the Vault deploys it on first delivery.

```solidity
const UNIVERSAL_TERMS = { type: 'tuple', components: [
  { type: 'uint48', name: 'validUntil' }, { type: 'address', name: 'expectedCEA' }, { type: 'address', name: 'asset' },
  { type: 'uint256', name: 'maxAmountPerCall' }, { type: 'uint256', name: 'maxAmountTotal' }, { type: 'uint256', name: 'maxPCPerCall' },
  { type: 'tuple[]', name: 'allowedCalls', components: [
    { type: 'address', name: 'target' }, { type: 'bytes4', name: 'selector' }, { type: 'uint16', name: 'beneficiaryOffset' },
    { type: 'bool', name: 'hasBeneficiary' }, { type: 'uint256', name: 'maxValue' } ] },
]};

const body = encodeAbiParameters([UNIVERSAL_TERMS], [{ validUntil, expectedCEA, asset, maxAmountPerCall, maxAmountTotal, maxPCPerCall, allowedCalls }]);
const initData = encodeAbiParameters([{ type: 'string' }, { type: 'bytes' }], [chain, body]);
const action = { actionTargetSelector: SEND_OUTBOUND_SELECTOR, actionTarget: GATEWAY, actionPolicies: [{ policy: URP, initData }] };
const actions = [action];                                    // exactly one, always

```

#### **Rules**

| Rule | Violation |
| --- | --- |
| exactly one action | `MalformedSessionShape` |
| it must be `(GATEWAY, 0x77b86bec)` | `MandateTypeMismatch(derived, 0, target)` |
| `asset` non-zero, has code, answers `SOURCE_CHAIN_NAMESPACE()` | `InvalidConfigField` / `InvalidAsset` |
| `expectedCEA` non-zero | `InvalidConfigField` |
| `validUntil` non-zero and future | `InvalidExpiry` |

**The allow-list** — what the agent may do on the far side

- 1..32 entries; 0 or more than 32 → `AllowListOutOfRange`.
- `beneficiaryOffset` is absolute from byte 0 of the **inner destination-chain calldata**, selector included (first argument = 4) — not the Push-side calldata.
- `hasBeneficiary: false` for a call with no beneficiary argument; the offset is then ignored.
- `maxValue` is in **destination-chain native units** (ETH on Sepolia), never Push-side PC. Conflating the two is a real bug this design once carried. `0` = non-payable.

**Two budgets, not one**

| Cap | Denominated in | Bounds |
| --- | --- | --- |
| `maxAmountPerCall` / `maxAmountTotal` | the PRC20 asset | how much the agent may bridge |
| `maxPCPerCall` | native PC | protocol fee + gas swap per outbound |
| `allowedCalls[].maxValue` | destination-chain native | value attached to one inner call |

`maxPCPerCall` has **no lifetime counterpart** — it is per-call only, so the wallet's PC balance is the real ceiling on total gas spend. See O2.

**Scope limit**

Destination must be EVM in v1: `expectedCEA` is a 20-byte address and URP's gate 12 requires the EVM multicall payload. Reject `CHAIN.SOLANA_*` client-side.

---

#### **O6 · Grant the mandate**

Once we create mandate, then we wraps them in the `Session` shape the wallet enforces, checks it off-chain, and sends it.

the following are the breakdown of steps post that.

#### **O6.1 · Assemble the Session**

```tsx
const keyConfig = encodeAbiParameters([{ type: 'uint8' }, { type: 'bytes' }],
  agent.scheme === 0 ? [0, agent.address] : [1, agent.pubKey]);   // 20 bytes / 32 bytes

const session = {
  sessionValidator: VALIDATOR,                                     // fixed
  sessionValidatorInitData: keyConfig,
  salt: '0x' + '00'.repeat(32),                                    // ignored; wallet overwrites with grantNonce
  userOpPolicies: [],                                              // must be empty
  erc7739Policies: { allowedERC7739Content: [], erc1271Policies: [] },   // must be empty
  actions,                                                         // from O4 or O5
  permitERC4337Paymaster: false,                                   // must be false
};
```

Four fields are not yours to choose: `sessionValidator` is the one validator this wallet accepts, and the other three are dead surface — anything else is `MalformedSessionShape`. `salt` is overwritten, so send zero.

#### **O6.2 · Pre-flight — three checks, in this order**

```tsx
// 1 · the agent key. THREE-VALUED: true | false | revert. It decodes before it checks,
//     so a blob that is not abi.encode(uint8, bytes) reverts. A revert means invalid.
const keyOk = await validator.read.validateConfig([keyConfig]).catch(() => false);
if (!keyOk) throw new InvalidMandateTermsError('BAD_AGENT_KEY', …);

// 2 · predict the permissionId
const grantNonce = await wallet.read.grantNonce();
const predictedId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }],
  [VALIDATOR, keyConfig, pad(toHex(grantNonce), { size: 32 })]));

// 3 · dry-run the real call; the returned id must equal the predicted one
const { result: permissionId } = await wallet.simulate.grantMandate([session], { account: owner });
if (permissionId !== predictedId) throw new InvalidMandateTermsError('GRANT_NONCE_STALE', …);
```

| Check | Prevents |
| --- | --- |
| `validateConfig` | a 19-byte key that grants fine and makes **every** agent request fail forever |
| predict + compare | a stale `grantNonce`, and any disagreement between your derivation and the engine's |
| `simulate` | every shape and init error in §4.3 and §4.4, before the user signs |

**Why predict the id.** The agent cannot act without it, so you need it before the grant lands: to show the mandate id on the confirmation screen, to store it against the terms, and to reference it downstream in the same batch. `grantNonce` is **0 on a freshly deployed wallet**, so a UEA multicall that deploys and grants in one signature can still compute it up front.

#### **O6.3 · Send**

```tsx
const data = encodeTxData({ abi: walletAbi, functionName: 'grantMandate', args: [session] });

// A · on its own
await client.universal.sendTransaction({ to: wallet, data });

// B · one signature, cross-chain mandate: gateway allowance + grant together
await client.universal.sendTransaction({ to: wallet, data: [
  ...wallet.prepareApproveGateway(asset, maxAmountTotal),          // O2
  { to: wallet, value: 0n, data },
]});
```

`msg.sender` must be the owner. Through `client.universal.sendTransaction` that is `client.universal.account` — the UEA for an external-origin user, the EOA for a Push-native one.

#### **O6.4 · What you get back**

| Event | Emitter | Carries |
| --- | --- | --- |
| `MandateGranted(permissionId indexed, uint8 mandateType, bytes32 chainHash indexed, string chain)` | wallet | the id, and the rulebook the contracts **derived** — read it back rather than assuming |
| `SessionCreated(permissionId, account)` | engine | the mandate is live |
| `URPPolicySet(configId indexed, multiplexer indexed, account indexed, uint8 mode, bytes32 chainHash)` | URP | one per action — the `configId`s you read spend counters from |

Store `(wallet, permissionId, terms, chain)`. The agent needs `permissionId`; you need the terms to render remaining budget later.

---

#### O7 · Replace a mandate atomically (assert → stop → grant)

**Note: As per current structure:**

- **A mandate cannot be modified.**
- There is no `updateMandate`, no setter on URP, and no path that rewrites a live config — `initializeWithMultiplexer` refuses re-initialisation outright (`AlreadyInitialized`).
- This is ACTIVE R&D TASK , see here 👉 [**Problem: why we cannot MODIFY the mandate**](https://app.notion.com/p/Problem-why-we-cannot-MODIFY-the-mandate-3dc188aea7f48058a79aecfa00453ee7?pvs=21)

**so how we change a mandate?**

A change is therefore always **stop the old one, grant a new one**, and the new mandate is a genuinely different object:

- New `permissionId` — the wallet's `grantNonce` moves on every grant, so ids never recur.
- New `configId`s — every downstream key the SDK cached is stale.
- **Spend counters restart at zero.** The old mandate's `spent` / `valueSpent` / `callsUsed` do not carry over. A user who has spent 400 of a 500 cap and "raises the cap to 800" is granting a fresh 800, not adding 300.
- Every banked signed request against the old id dies instantly, because `permissionId` is field 5 of the op hash.
    
    > THIS COULD CHANGE AFTER R&D TASK IS DONE and WE HAVE A SOLUTION/DECISION on how to edit mandates with JOBs.
    > 

```tsx
// 1 · freeze the numbers the new terms were computed from
const assertCall = mandate.mode === 'UNIVERSAL'
  ? { target: URP, value: 0n, callData: encodeFunctionData({ abi: urpAbi, functionName: 'assertSpent',
      args: [configId, wallet, spent] }) }                                     // 0x85859f51
  : { target: URP, value: 0n, callData: encodeFunctionData({ abi: urpAbi, functionName: 'assertSpent',
      args: [configId, wallet, valueSpent, amountSpent, callsUsed] }) };       // 0x42bd3e90 — one per action

const calls = [
  assertCall,
  { target: wallet, value: 0n, callData: encodeFunctionData({ abi: walletAbi, functionName: 'stopMandate',  args: [oldId] }) },
  { target: wallet, value: 0n, callData: encodeFunctionData({ abi: walletAbi, functionName: 'grantMandate', args: [newSession] }) },
];

await wallet.write.execute([MODE_BATCH, encodeBatch(calls)]);
// MandateRevoked(oldId) · MandateGranted(newId, …) · SessionCreated · URPPolicySet per action

```

#### **What the SDK implements**

| Function | Does |
| --- | --- |
| `wallet.replace(oldId, expectedSpent, terms)` | the whole batch above; returns the new `permissionId` |
| `wallet.prepareReplace(oldId, expectedSpent, terms)` | the same as `MultiCall[]`, for callers batching it into a larger signature |
| `wallet.mandate(oldId)` | read the live counters to pass as `expectedSpent`, and the old terms to diff against the new |

Sequence to implement:

1. Read the mandate (`getMode` → `getConfig` / `getNativeConfig` per action) for current terms **and** current counters.
2. Build `newSession` exactly as in O4 / O5 / O6.1 — same agent key if the agent is unchanged, a different key if it is not.
3. Pre-flight the new session (O6.2). A replace that fails at `grantMandate` would have revoked the old mandate for nothing if the batch were not atomic — it is atomic, so it reverts whole, but catching it in `simulate` gives the better error.
4. Submit the batch. On `SpentMismatch`, re-read and re-present the numbers; do not retry silently, because the terms the user approved were derived from the old ones.
5. Read the new id from `MandateGranted`, replace the stored record, and **hand the new id to the agent** — it has no way to discover it.

#### **O8.4 · Revoking without replacing**

For a plain stop, see O8. Revocation never fails: `stopMandate` and `stopAll` carry no guard, no probe and no external call, by design.

---

#### O7 · Stop

```tsx
await wallet.write.stopMandate([permissionId]);   // UnknownPermission if not enabled
await wallet.write.stopAll();                     // one MandateRevoked per id
```

- Immediate. Every banked signed request for that id is dead.
- URP counters for the old `configId`s persist harmlessly; a regrant produces new ids.

---

### Read operations

#### R1 · Wallet views

| Call | Returns |
| --- | --- |
| `owner()` | immutable owner |
| `factory()` | immutable factory |
| `grantNonce()` | salt the next grant will use |
| `getNonce(uint192 lane)` | next `nonceSeq` for that lane |
| `sessionEngine()` `urp()` `sessionValidator()` `universalGateway()` | wiring |
| `accountId()` | `"push.agentwallet.1.0.0"` |
| `isModuleInstalled(1, ENGINE, "")` | `true` on a healthy wallet |

#### R2 · Factory views

| Call | Returns |
| --- | --- |
| `walletCount(owner)` | n; next index |
| `predictWallet(owner, index)` | `(address, deployed)` |
| `isWallet(addr)` / `ownerOf(addr)` / `indexOf(addr)` | registry |
| `walletImplementation()` | for mirror checks |

#### R3 · Mandate views

| Call | On | Returns |
| --- | --- | --- |
| `getPermissionIDs(wallet)` | engine | all live `permissionId`s |
| `isPermissionEnabled(permissionId, wallet)` | engine | bool |
| `getSessionValidatorAndConfig(wallet, permissionId)` | engine | `(validator, keyConfig)` |
| `getEnabledActions(wallet, permissionId)` | engine | `bytes32[] actionIds` |
| `getActionPolicies(wallet, permissionId, actionId)` | engine | `[URP]` |
| `getMode(configId, wallet)` | URP | `{initialized, mode, chainHash}` — **never reverts; call it first** |
| `getConfig(configId, wallet)` | URP | universal terms + `spent`. Reverts only on an *initialised* native config; a zeroed struct otherwise |
| `getNativeConfig(configId, wallet)` | URP | native terms + `valueSpent, amountSpent, callsUsed`. Same asymmetry |
| `pushChainHash()` | URP | `keccak256("eip155:" ‖ chainid)` |

⚠️ Neither getter distinguishes “empty” from “zeroed”. A mistyped `configId` returns a struct full of zeros, not an error — which reads as a live mandate with zero caps and no expiry. `getMode().initialized` is the only guard.

#### R4 · Events

| Event | Emitter | Index on |
| --- | --- | --- |
| `WalletDeployed(address indexed owner, uint256 indexed index, address indexed wallet, string label)` | factory | owner, wallet |
| `AccountInitialized(address indexed owner, address indexed engine)` | wallet | — |
| `OwnerExecuted(bytes32 indexed mode, bytes32 executionCalldataHash)` | wallet | — |
| `MandateGranted(bytes32 indexed permissionId, uint8 mandateType, bytes32 indexed chainHash, string chain)` | wallet | permissionId, chainHash |
| `MandateRevoked(bytes32 indexed permissionId)` | wallet | permissionId |
| `MandateActionAuthorized(bytes32 indexed permissionId, uint192 indexed nonceKey, uint64 nonceSeq, bytes32 opHash)` | wallet | permissionId |
| `URPPolicySet(bytes32 indexed configId, address indexed multiplexer, address indexed account, uint8 mode, bytes32 chainHash)` | URP | account |
| `OutboundMetered(bytes32 indexed configId, address indexed multiplexer, address indexed account, uint256 amount)` | URP | configId |
| `NativeCallMetered(bytes32 indexed configId, address indexed multiplexer, address indexed account, uint256 value, uint256 amount)` | URP | configId |
| `SessionCreated(bytes32 permissionId, address account)` / `SessionRemoved(bytes32 permissionId, address smartAccount)` | engine | — |
- `mandateType`: `0 = UNIVERSAL`, `1 = NATIVE`.
- `multiplexer` in URP events is always the engine.

---

## 3 · Encoding appendix

### 3.1 Structs as ABI tuples

```
Session                     (address sessionValidator, bytes sessionValidatorInitData, bytes32 salt,
                             (address policy, bytes initData)[] userOpPolicies,
                             ((bytes32 appDomainSeparator, string[] contentNames)[] allowedERC7739Content,
                              (address policy, bytes initData)[] erc1271Policies) erc7739Policies,
                             (bytes4 actionTargetSelector, address actionTarget, (address policy, bytes initData)[] actionPolicies)[] actions,
                             bool permitERC4337Paymaster)

sessionValidatorInitData    abi.encode(uint8 scheme, bytes key)            scheme 0 → 20-byte address · scheme 1 → 32-byte Ed25519 pubkey
policy initData (envelope)  abi.encode(string chain, bytes body)           same shape for both kinds
UniversalTerms (body)       (uint48 validUntil, address expectedCEA, address asset, uint256 maxAmountPerCall, uint256 maxAmountTotal,
                             uint256 maxPCPerCall, (address target, bytes4 selector, uint16 beneficiaryOffset, bool hasBeneficiary, uint256 maxValue)[] allowedCalls)
NativeTerms (body)          (uint48 validUntil, address target, bytes4 selector, uint256 maxValuePerCall, uint256 maxValueTotal,
                             (bool enabled, uint16 offset, uint256 maxPerCall, uint256 maxTotal) amount, uint32 maxCalls,
                             (uint16 offset, bytes32 expected)[] pins)

execution SINGLE            abi.encodePacked(address target, uint256 value, bytes callData)      // 20 + 32 + n bytes
execution BATCH             abi.encode((address target, uint256 value, bytes callData)[])
UniversalOutboundTxRequest  (bytes recipient, address token, uint256 amount, uint256 gasLimit, uint256 gasPrice, uint256 maxPCForGas, bytes payload, address revertRecipient)
multicall payload           0x2cc2842d ‖ abi.encode((address to, uint256 value, bytes data)[])
session signature           0x00 ‖ permissionId (32) ‖ sig (65 ECDSA | 64 Ed25519)
op hash pre-image           abi.encode(bytes32 domain, uint256 chainid, address wallet, address engine, bytes32 permissionId,
                                       bytes32 mode, bytes32 keccak256(executionCalldata), uint192 nonceKey, uint64 nonceSeq, uint48 requestExpiry)
```

- `Config` and `NativeConfig` (the storage structs returned by `getConfig` / `getNativeConfig`) are **read** types only. Never encode them.

### 3.2 Mode word (ERC-7579)

```
byte 0      callType     0x00 single · 0x01 batch
byte 1      execType     0x00 default (only value accepted)
bytes 2-5   unused
bytes 6-9   modeSelector 0x00000000
bytes 10-31 payload      zero
```

### 3.3 Constants

| Name | Value |
| --- | --- |
| `SEND_OUTBOUND_SELECTOR` | `0x77b86bec` |
| `MULTICALL_SELECTOR` | `0x2cc2842d` |
| `OP_HASH_DOMAIN` | `0xee007baac915cb5cecf254fbc38928446424413e2083e43f2155c71b8bf768fe` |
| `VALUE_SELECTOR` | `0xFFFFFFFF` |
| `SmartSessionMode.USE` | `0x00` |
| Donut chain string / hash | `"eip155:42101"` / `0x3d6bc1f1d3fb03065860265a8e93840b586e57075d956cd41b4319d040be87f9` |
| Sepolia chain string / hash | `"eip155:11155111"` / `0xafa90c317deacd3d68f330a30f96e4fa7736e35e8d1426b2e1b2c04bce1c2fb7` |
| `MAX_NATIVE_ACTIONS` | 8 |
| `MAX_PINS` | 8 |
| `MAX_ALLOWED_CALLS` | 32 |
| `MAX_ACTIONS_PER_REQUEST` (multicall entries) | 10 |
| `MIN_OUTBOUND_BODY_LEN` | 352 — the **body** minimum; the gate is `data.length < 4 + 352`, selector included |

### 3.4 Function selectors

| Function | Selector |
| --- | --- |
| `deployWallet(string)` | `0x37ba532c` |
| `execute(bytes32,bytes)` | `0xe9ae5c53` |
| `grantMandate(Session)` | `0xa3e13323` |
| `stopMandate(bytes32)` | `0xa0dbb1e9` |
| `stopAll()` | `0xf0881ae6` |
| `executeWithSession(address,bytes32,bytes,bytes,uint192,uint64,uint48)` | `0x3ea758b5` |
| `assertSpent(bytes32,address,uint256)` | `0x85859f51` |
| `assertSpent(bytes32,address,uint256,uint256,uint32)` | `0x42bd3e90` |

### 3.5 Argument offsets

- Absolute, from byte 0 of the calldata being inspected, selector included. Static argument `i` → `4 + 32*i`.
- Native pins and amount rule inspect the **Push-side** calldata. Universal `beneficiaryOffset` inspects the **inner** multicall entry’s `data`.
- Derive offsets from the ABI in tooling; never hand-type them. A wrong offset fails closed (every request reverts), it cannot widen a mandate.

---

## 4 · Error catalogue

### 4.1 Decoding rule

- Wallet, factory and validator errors revert **directly** with full arguments.
- URP **init** errors (`grantMandate` path) bubble with full arguments.
- URP **checkAction** errors (`executeWithSession` path) are truncated by the engine to `PolicyCheckReverted(bytes32)`: the 4-byte selector + the first 28 bytes of the first argument. Decode the selector, treat the rest as diagnostic.
- Target reverts from `execute` and from the agent’s dispatched call bubble verbatim.

### 4.2 Factory

| Error | When |
| --- | --- |
| `ImplementationNotSet()` | factory not initialised |
| `IndexOutOfRange(uint256 index, uint256 next)` | `predictWallet` beyond next index |
| `NotAWallet(address)` | `indexOf` on a foreign address |
| `EnforcedPause()` | factory paused |

### 4.3 Wallet — grant

| Error | When |
| --- | --- |
| `NotOwner()` | caller is not owner or self |
| `MalformedSessionShape()` | any shape rule (see O6) |
| `TooManyActions(uint256 count)` | 0 actions, or > 8 |
| `EmptyChain()` | envelope chain string empty |
| `InconsistentChain(uint256 actionIndex)` | action `i` names a different chain than action 0 |
| `MandateTypeMismatch(uint8 derived, uint256 actionIndex, address target)` | gateway target under this chain’s string, or a non-gateway target under a foreign one. See the note below — `derived` is only informative in one of the two cases |
| `ForbiddenActionTarget(address)` | zero, `0x1`, wallet, engine, URP, validator, factory |
| `ForbiddenActionSelector(bytes4)` | `0x00000001`, `0x00000002` |
| `DuplicateAction(address, bytes4)` | same pair twice |
| `UnknownPermission(bytes32)` | `stopMandate` on a non-live id |
| `MalformedBatchCalldata()` | `execute` in BATCH mode with calldata that is not `abi.encode(Execution[])` — e.g. SINGLE-encoded bytes sent with `MODE_BATCH`. From `ExecutionLib` |
| `EngineStillHoldsPermissions()` | `uninstallModule` on the engine while mandates are live — `stopAll` first |

⚠️ **`MandateTypeMismatch.derived` carries information in only one direction.**

- **Foreign chain, non-gateway target** → `derived = 0 (UNIVERSAL)`, and it is real. The usual cause: you meant a Push-side mandate but the chain string is not byte-exact. `"EIP155:42101"`, `"eip155:042101"` and a leading space all hash to not-Push. The SDK’s §5 pre-check exists to catch this before the user sees it.
- **This chain’s string, gateway target** → `derived = 1 (NATIVE)` is **hardcoded at the revert site** (`PushAgentWallet.sol:519`). It is not wrong — that branch only runs when NATIVE was derived — but it is a constant, so do not read it as a derivation result. The useful fields here are `actionIndex` and `target`.

### 4.4 URP — init, in order (bubbles through grant with full arguments)

Init has no gate numbers: the numbering in §4.6 / §4.7 comes from the contracts’ own comments and test names, and there is no equivalent scheme here. Rows are in execution order, unnumbered.

The first group runs in `initializeWithMultiplexer`, **before the chain is read and before the mode is derived**, so it is shared by both rulebooks — which is why `EmptyChain` appears above a universal table. The second group runs inside the mode’s own initialiser.

⚠️ **`AlreadyInitialized` precedes the envelope decode.** On a config that already exists, *every* malformed shape reports `AlreadyInitialized` instead of its own error. A developer debugging a bad envelope against a reused `configId` will chase the wrong problem. Reuse is not normal — the wallet supplies a fresh salt per grant — so if you see this, the `permissionId` is stale.

**Envelope, both modes**

| Error | When |
| --- | --- |
| `AlreadyInitialized(bytes32 configId)` | config already exists; **runs before everything below** |
| unnamed revert | outer `(string, bytes)` decode fails: a `(uint8, bytes32, bytes)` header, `(uint8 ≥ 2, bytes)`, or under 64 bytes |
| `EmptyChain()` | chain string empty — also what a v2 `(uint8 0, bytes)` envelope and any bare struct decode to |

**Body — universal** (chain ≠ this chain)

| Error | When |
| --- | --- |
| unnamed revert | body is not `UniversalTerms` |
| `AllowListOutOfRange(uint256)` | 0 or > 32 entries — **checked first, before expiry** |
| `InvalidExpiry(uint48)` | `validUntil` zero or not in the future |
| `InvalidConfigField()` | zero `asset` or zero `expectedCEA` |
| `InvalidAsset(address)` | asset has no code (explicit `code.length` guard), or reverted on `SOURCE_CHAIN_NAMESPACE()` |
| `ChainMismatch(bytes32 declared, bytes32 assetChain)` | asset answered with a different chain than the envelope declared |
| unnamed revert | asset answered `SOURCE_CHAIN_NAMESPACE()` with a non-string — decode fails outside the `try/catch` |

**Body — native** (chain == this chain)

| Error | When |
| --- | --- |
| unnamed revert | body is not `NativeTerms` |
| `InvalidExpiry(uint48)` | `validUntil` zero or not in the future — **checked first here** |
| `NativeTargetZero()` | zero target |
| `NativeTargetIsGateway(address)` | target is the gateway |
| `TooManyPins(uint256)` | > 8 pins |
| `ValueOnlyWithPins()` | `selector == 0xFFFFFFFF` with pins |
| `ValueOnlyWithAmountRule()` | `selector == 0xFFFFFFFF` with an amount rule |

### 4.5 Wallet — agent door

The owner never calls this door, but these are what a badly-scoped mandate produces at runtime. Full agent-side context in the [agent doc](./AGW-SDK-v1-agent.md) §4.

| Error | When |
| --- | --- |
| `RequestExpired()` | `requestExpiry ≠ 0` and past |
| `ValidatorNotInstalled(address)` | `validator` arg ≠ engine |
| `InvalidNonce(uint192 key, uint64 expected, uint64 provided)` | wrong `nonceSeq` |
| `InvalidSessionSignature()` | signature < 33 bytes or byte 0 ≠ `0x00` |
| `ValidationFailed(address authorizer)` | signature does not recover / verify (after URP passes) |
| `OutsideTimeWindow(uint48 validAfter, uint48 validUntil)` | engine time window |
| `UnsupportedExecutionMode()` | mode ≠ single/default |
| `ForbiddenDispatchTarget(address)` | target is the wallet or the engine |

### 4.6 URP — universal gates, in order (truncated to 32 bytes)

These fire on the agent’s requests, not on the owner’s calls. Listed here because they are the runtime meaning of the terms the owner granted: every gate is a cap or a pin the owner chose.

The gate numbers come from the contracts’ own comments and test names — use them when reading `URP.sol` or a failing test. They are a **narrative numbering, not a count of checks**: gate 4 is three separate reverts (4a/4b/4c) and gates 14 and 15 are two each, so “sixteen gates” describes the list below, not sixteen discrete `if`s. Don’t go looking for a gate that isn’t a row here.

| # | Error | Rule |
| --- | --- | --- |
| 1 | `NotInitialized(bytes32 id, address)` | config exists |
| 2 | `MandateExpired(uint48)` | `now ≤ validUntil` |
| 3 | `InvalidTarget(address)` | target is the gateway |
| 4a | `CalldataTooShort(uint256)` | ≥ 4 bytes |
| 4b | `InvalidSelector(bytes4)` | `0x77b86bec` |
| 4c | `MalformedOutboundRequest(uint256)` | body ≥ 352 bytes |
| 5 | `AssetMismatch(address expected, address actual)` | `req.token == asset` |
| 6 | `AmountExceedsCap(uint256 amount, uint256 cap)` | per-call |
| 7 | `TotalSpendCapExceeded(uint256 wouldBe, uint256 cap)` | lifetime |
| 8 | `PCValueExceedsCap(uint256 value, uint256 cap)` | Push-side `value ≤ maxPCPerCall` |
| 9 | `UncappedGasSwapRejected()` | `maxPCForGas ≠ 0` |
| 10 | `InvalidRevertRecipient(address expected, address actual)` | `== wallet` |
| 11 | `RecipientMustBeEmpty()` | `recipient.length == 0` |
| 12 | `PayloadNotMulticall()` | payload starts with `0x2cc2842d` |
| 13 | `BatchSizeOutOfRange(uint256)` | 1..10 entries |
| 14 | `ForbiddenInnerTarget(address)` | not wallet / URP / gateway / expectedCEA |
| 14 | `MalformedInnerCalldata()` | entry data ≥ 4 bytes; offset in range |
| 15 | `CallNotAllowed(address, bytes4)` | pair in `allowedCalls` |
| 15 | `BeneficiaryMismatch(address expected, address actual)` | word at offset == expectedCEA |
| 16 | `InnerValueExceedsAllowance(uint256 index, uint256 value, uint256 max)` | destination units |

### 4.7 URP — native gates, in order (truncated to 32 bytes)

| # | Error | Rule |
| --- | --- | --- |
| N1 | `NotInitialized` |  |
| N2 | `MandateExpired(uint48)` |  |
| N3 | `NativeTargetIsGateway(address)` | never the gateway |
| N4 | `TargetMismatch(address actual, address expected)` |  |
| N5 | `SelectorMismatch(bytes4 actual, bytes4 expected)` / `ValueOnlyCalldataNotEmpty(uint256)` |  |
| N6 | `ValueExceedsCap(uint256, uint256)` / `TotalValueExceeded(uint256, uint256)` | PC value |
| N7 | `CalldataTooShortForPin(uint256 len, uint256 i, uint256 needed)` / `ArgPinMismatch(bytes32 actual, uint256 i, bytes32 expected)` | pins |
| N8 | `CalldataTooShortForAmount(uint256, uint256)` / `NativeAmountExceedsCap(uint256, uint256)` / `TotalNativeAmountExceeded(uint256, uint256)` | amount rule |
| N9 | `CallLimitReached(uint32 used, uint32 max)` |  |

### 4.8 Validator

`validateConfig` and `validateSignatureWithData` fail differently, and **neither named validator error can come from `validateConfig`**.

| Surface | Bad scheme | Bad key length | Not `abi.encode(uint8, bytes)` |
| --- | --- | --- | --- |
| `validateConfig` (pre-check) | returns `false` | returns `false` | **reverts**, unnamed, at the decode |
| `validateSignatureWithData` (runtime, inside the engine) | `UnsupportedScheme(uint8)` | `MalformedConfig()` | reverts, unnamed |
- **Treat any revert from `validateConfig` as an invalid config** — the contract’s own instruction. Wrap it; see §O6.
- A config that passes `validateConfig` can still fail at runtime: a valid key with a wrong signature returns `false`, which the wallet surfaces as `ValidationFailed(authorizer)`. Neither named error above reaches the SDK as itself.

### 4.9 Views

| Error | When |
| --- | --- |
| `WrongModeForCall(uint8 actual)` | `getConfig` / `assertSpent` on a config **initialised** under the other rulebook. An **uninitialised** config reverts nothing — both getters return a zeroed struct. Read `getMode().initialized` first. |
| `SpentMismatch(uint256 expected, uint256 actual)` | `assertSpent` — counters moved since you read them |
| `NotInitialized(bytes32 id, address)` | `assertSpent` on a config that was never initialised |

### 4.10 Errors the SDK will not meet

Listed so nobody maps them: `ZeroAddress()` (URP constructor) · `NotExecutorModule(address)`, `AlreadyCredited(bytes32)` (`creditRevert`, callable only by the executor module, which has no code on Donut) · `ImplementationNotSet()` (factory misdeployment).

### 4.11 SDK error classes

All extend `AgentWalletError { code, hint, ...context }` (the `PC20Error` pattern). Client-side checks throw before any signature is requested; on-chain reverts are decoded from the AGW ABIs.

| Class | Thrown by | When |
| --- | --- | --- |
| `InvalidMandateTermsError` | `grant`, `prepareGrant` | any §5 grant pre-check fails; carries `violations[]` naming the on-chain error it would have hit |
| `AssetChainMismatchError` | `grant` | `asset.SOURCE_CHAIN_NAMESPACE() !== terms.chain` |
| `CEAFactoryDriftError` | `grant` | `CEA_FACTORY_ADDRESSES[chain] !== Vault.CEAFactory()` |
| `UnsupportedDestinationError` | `grant` | SVM destination for a cross-chain mandate |
| `MandateNotLiveError` | `stop`, `replace` | `isPermissionEnabled` false |
| `AgentWalletRevertError { name, args }` | any write | decoded custom error from wallet / factory / URP / validator; `PolicyCheckReverted` is unwrapped to the inner URP selector |

---

---

[O9 · Compile an agent card into a mandate](https://app.notion.com/p/O9-Compile-an-agent-card-into-a-mandate-3df188aea7f480c98f5be5018d268659?pvs=21)

---

## Open questions (team)

1. **Namespace name.** `client.agentWallet` proposed; alternatives `client.agent`, `client.aw`. Decide before the first PR since it is public API.
2. **Owner batching on Push-native EOAs.** UEA owners get one-signature deploy + approve + grant via `data: MultiCall[]`. A Push-native EOA cannot; accept two txs, or add a factory `deployAndGrant`? (Contract change, out of the SDK’s hands.)
3. **Gateway allowance policy.** Approve `maxAmountTotal` at grant (simple; one allowance per asset, shared across mandates on the same asset) versus approve per request (impossible from the agent side without a native `approve` mandate). Recommend at-grant, reset on `stop`.
4. **`SOURCE_CHAIN_NAMESPACE` on the PRC20 ABI and `getOutboundTxGasAndFees` on a core ABI** are missing from `@pushchain/core`; confirm which team adds them.
5. open questions regarding AGENT CARD to Mandate Translation → [ **Open Question: Agent Card to mandate translation**](https://app.notion.com/p/Open-Question-Agent-Card-to-mandate-translation-3df188aea7f480c99e36decc46df5da0?pvs=21) 
6. Open question regarding UniversalMarketplace.startJob() → https://pushchain.slack.com/archives/C077XBA6KUH/p1789667453891089

---

# Nomenclature and Standardization of Agentic Wallet, SDK, Universal Marketplace