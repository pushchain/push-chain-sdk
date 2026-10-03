# AGW SDK open product decisions for Harsh

We are preparing the AGW SDK implementation and need the decisions below to finalize its public behavior. Each item gives the issue, our recommendation and the answer needed. Please reply using the item IDs; approve the recommendation or provide the replacement behavior/schema.

**Status:** open review draft. H1–H4 concern standalone AGW. H5 concerns `compileCard` and marketplace integration. Design approval settles the product choice; matching contract artifacts and deployment are separate dependencies.

| Item | Decision needed | Affected SDK behavior |
| --- | --- | --- |
| [H1](#h1) | Agent approval policy | Which universal rules can be granted |
| [H2](#h2) | Native agent transaction arrays | Whether arrays are rejected or supported in v1 |
| [H3](#h3) | Defaults for omitted limits | Authority granted by optional fields |
| [H4](#h4) | Helper context, spend/history reads and SVM rule shape | Public signatures and returned records |
| [H5](#h5) | Canonical card schema and scope | `utils.agentic.compileCard` |

## Source baseline

- **Target:** [SDK spec snapshot](notion/5-sdk-agw.md), exported October 3, 2026 at 13:23 IST; [live Notion page](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9).
- **Contract proposal:** [saved change set](notion/1-agw-contract-changes.md), especially section 4c; [live Notion page](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d).
- **Reviewed source:** [AGW e704d5b](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol). Remote refs were rechecked October 3 and were unchanged. Notion has not been re-exported since the time above; later edits may answer these items.

<a id="h1"></a>

## H1 Agent permission to approve destination spending

**Issue.** The SDK's creation example allows destination `approve(address,uint256)` without restricting the spender. An agent could approve an address it controls, allowing that address to withdraw existing CEA tokens outside the outbound token caps. The universal rule can pin a beneficiary to the CEA, but cannot pin an arbitrary approved spender.

**Recommendation.** Reject known approval-granting selectors, including `approve` and `increaseAllowance`, in universal agent rules. Replace the example with bounded destination approval performed by the owner through the existing owner-mode `universal.sendTransaction`. Selector filtering is only one safeguard; it does not make arbitrary untrusted contracts safe.

**Answer needed:** approve this policy, or specify the alternative permissions/safeguards intended for agent-created destination approvals.

**Evidence:** [SDK creation example, section 1.b](notion/5-sdk-agw.md); [universal beneficiary/value checks](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/policies/UniversalRulesPolicy.sol#L1005).

<a id="h2"></a>

## H2 Native agent transaction arrays

**Issue.** The SDK says transaction arrays work in agentic mode. The current agent door dispatches one Push-native call. An EVM destination multicall is different: it is carried inside one outbound gateway call.

**Recommendation.** Keep the specified single-action `NativeRule`. Reject native **agent** arrays before signing in v1, without a sequential fallback. Continue supporting owner wallet batches and bounded EVM destination multicalls.

**Answer needed:** approve that v1 scope, or confirm that native agent batching must be added to the contracts before this SDK capability ships.

**Evidence:** [SDK agent behavior and NativeRule, sections 2.a and 3.b](notion/5-sdk-agw.md); [agent dispatch restriction](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol#L849).

<a id="h3"></a>

## H3 Defaults when a limit is omitted

**Issue.** Optional fields need explicit defaults because omission changes the authority granted to an agent.

**Recommendation:**

| Omitted input | Proposed encoded value | Permission granted |
| --- | --- | --- |
| Universal `assets[].maxTotal` | `0` in the proposed multi-asset ABI | Unlimited total for that asset |
| Native `maxValuePerCall` | `0` | No native value transfer |
| Native `maxValueTotal` | `0` | No native value transfer |
| Native `amount.maxTotal`, when `amount` is present | `uint256` maximum | Unlimited metered total; required `maxPerCall` still applies |
| Native `maxCalls` | `0` | Unlimited calls until expiry |
| Universal `allowedCalls[].maxValue` | `0` | No native value attached to that destination call |

Explicit zero remains zero. In the current native policy, zero value/amount caps prohibit positive value/amount; only `maxCalls` treats zero as unlimited. The proposed universal asset format adds its own zero-unlimited convention.

**Answer needed:** approve the table or give the replacement default for each changed row. Unlimited permissions will be shown explicitly in documentation/previews.

**Evidence:** [optional SDK fields, section 3.b](notion/5-sdk-agw.md); [proposed multi-asset sentinel, section 4c](notion/1-agw-contract-changes.md); [native terms and limit definitions](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/libraries/Types.sol#L300).

<a id="h4"></a>

## H4 Public helpers and rule reads

Please answer each sub-item separately; they affect different public types.

<a id="h4-1"></a>

### H4.1 Generation context for pure helpers

**Issue.** The specified helpers omit inputs needed to match contract results. Rule IDs depend on the validator address and grant nonce. Wallet prediction depends on the factory and wallet implementation generation.

**Proposed signatures** — subject to approval:

```ts
rulesId(agent, grantNonce, { validator })
deriveWallet(owner, index, { factory, walletImplementation })
```

Chain is not part of the delivered rule-ID hash. Client-bound methods resolve deployment context internally; pure helpers receive it explicitly. Rule records are indexed by wallet plus rule ID.

**Answer needed:** approve these signatures or supply the preferred way to pass deployment context.

**Evidence:** [current helper signatures, section 3.e](notion/5-sdk-agw.md); [grant nonce and ID assignment](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGW.sol#L626); [wallet prediction inputs](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGWFactory.sol#L232).

<a id="h4-2"></a>

### H4.2 Spend returned for a multi-asset rule

**Issue.** Rules now contain `assets[]`, but the proposed `Spent` result still has one scalar `amountSpent`. Different token units cannot be added together.

**Proposed universal result:**

```ts
{
  kind: 'universal',
  assets: [
    { token: destinationTokenAddress, amountSpent: 25000000n }
  ]
}
```

`token` uses the same destination-chain identity/native-marker convention as the public rule. Native spend keeps its existing three counters. Contract-side PRC20 conversion stays inside the SDK.

**Answer needed:** approve this result shape or provide an alternative. Coordinate the underlying read/assertion ABI with [Zaryab Z1.2](questions-zaryab.md#z1-2).

**Evidence:** [Rule and Spent types, section 3.b](notion/5-sdk-agw.md); [per-token accounting proposal, section 4c](notion/1-agw-contract-changes.md).

<a id="h4-3"></a>

### H4.3 Revoked-rule history

**Issue.** `rules.list()` promises “every rule,” while revocation clears agent configuration from the engine. Reliable historical records require additional event metadata or reconstruction of grant calls.

**Answer needed:** does `rules.list()` include revoked rules? Also define `rules.get(revokedId)` behavior. If full history is required, we recommend metadata that can be reconstructed reliably for every supported grant path; [Zaryab Z1.3](questions-zaryab.md#z1-3) covers the contract dependency.

**Evidence:** [SDK reads, sections 1.i–1.j](notion/5-sdk-agw.md); [removed configuration behavior](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/interfaces/ISmartSessionConfigReader.sol#L13).

<a id="h4-4"></a>

### H4.4 Public shape for SVM destinations

**Issue.** The public `AllowedCall` is EVM-shaped. SVM destination rules require program/discriminator and account/data constraints that should not be invented by the SDK implementation.

**Answer needed:** confirm whether SVM destinations are in this release and, if so, provide or approve their public rule representation. Solana-origin signers using a UEA are a separate capability from executing on a Solana destination. Align this answer with [Zaryab's destination capability manifest](questions-zaryab.md#z3).

**Evidence:** [SDK universal rule types, section 3.b](notion/5-sdk-agw.md); [SVM integrator requirements 19–23](contract-integrator-obligations.md).

<a id="h5"></a>

## H5 Card schema for compileCard

**Issue.** `utils.agentic.compileCard(card, userInput, ctx)` is part of the public target, but its canonical schema/version and binding scope need alignment with the marketplace/hook. The reviewed marketplace records one rules ID per job.

**Answer needed:** identify the shared-schema owner and provide or approve:

- The versioned `card` and `userInput` shapes, including required fields.
- Provider Push identity, expiry and `Rule[]` output semantics.
- Whether v1 supports one execution chain or requires multi-chain job binding.

Coordinate encoding and shared vectors with [Zaryab Z5](questions-zaryab.md#z5). This blocks `compileCard` completion, while standalone AGW foundation work can proceed.

**Evidence:** [SDK helpers, section 3.e](notion/5-sdk-agw.md); [marketplace SDK target](notion/6-sdk-universal-marketplace.md); [current job/rule binding](https://github.com/pushchain/push-chain-core-contracts/blob/cb69e0ba101bef1bb4440e54b2c45396be3e92ce/src/agentic-commerce-8183/UniversalMarketplace.sol#L301).

## Supporting documents

[Implementation plan](implementation-plan.md) · [External dependencies](external-blockers.md) · [SDK design](sdk-design-review.md) · [Zaryab's open requests](questions-zaryab.md)
