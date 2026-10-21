# Product decisions for Harsh: agentic wallet creation

Updated October 21, 2026. Final; ready to send. Preset questions (preset tokens and routes) are with Aman in [questions-aman.md](questions-aman.md).

Four product decisions on agentic wallet creation, from Riyanshu's testing of the create screen. Questions 1 and 2 block that screen today; 3 and 4 decide what we promise users. Each one says how it works today and lists the options. Options that need contract work from Zaryab are marked. If you're considering one of them, tell us and we'll get Zaryab's estimate before you decide. "SDK only" means no contract change or redeploy.

Terms:

- **Rule:** what the owner lets an agent do: which apps it can call, which tokens it can move, and the limits. Each rule has an expiry date set when it's created (presets default to 7 days).
- **App action:** one function on one app contract, for example "swap exact input on Uniswap" or "supply on Aave".
- **Push-chain rule / other-chain rule:** a rule is either for apps deployed on Push Chain itself, or for apps on another chain (Sepolia, Base, Arbitrum, BNB, Solana).
- **Destination account:** the wallet's own account on another chain. Tokens sent from Push land there first, and the agent's app actions run from there.
- **PC:** Push Chain's native coin. Gas for every agent transaction is paid in PC.

These choices apply to rules created afterwards. Existing rules keep their settings until the owner updates them.

---

## 1. Can a rule allow token transfers without picking an app?

**Today.** An other-chain rule needs at least one app action, and the contract rejects tokens-only rules. Riyanshu expected apps to be optional. Developers can already write a transfer permission by hand with the SDK. The question is what the create screen should build automatically when the owner picks tokens but no app.

The choice is who the agent may send tokens to:

- **A. Named recipients:** only addresses the owner enters, up to a per-transfer amount (SDK only)
- **B. Any recipient,** up to a per-transfer amount (SDK only)
- **C. Only back to the owner's own address** on that chain (SDK only)
- **D. Keep apps required;** the screen explains that an app must be picked (UI text only)

A and C can be combined: the owner's address is just one more named recipient.

**How much is at risk with A–C.** The limit is per transfer, and the agent can repeat transfers until the rule expires. So the agent can move the selected tokens' entire balance in the destination account, a few transfers at a time, including tokens that were already there. The "total from Push" limit doesn't stop this, because it only counts tokens sent from Push. For example:

- with B, a rule that allows 100 USDC per transfer lets the agent send the whole USDC balance to anyone;
- with A, the balance can go only to the named addresses;
- with C, it can only go back to the owner.

**Other limits:**

- It works for EVM tokens (ERC20) only.
- Native ETH/BNB can't be included, because a rule can only allow contract function calls, not plain coin transfers.
- Solana isn't possible without contract changes (Zaryab).

**Decision needed:** A, B, C or D? If A–C, is EVM tokens only OK for the first version?

## 2. What should "no tokens selected" mean?

**Today.** No tokens selected means the agent can't move any tokens out of Push. It can still use the selected apps with funds already in the destination account. Riyanshu expected no selection to mean "all tokens allowed".

A rule can list at most 8 tokens per chain, each with its own limit. There's no "any token" setting, and tokens added later are never included automatically.

- **A. Keep as is** (no work)
- **B. An "All supported tokens" button** that fills in every token Push can send to that chain (3–7 today). Each token still gets its own limit (SDK + UI)
- **C. True "any token",** including future tokens, under one limit. One limit across different tokens would need a common unit, such as USD prices. This is a new contract design (Zaryab)

**Decision needed:** A, B or C? If B, does the owner enter each token's limit, or do we supply a default per token? Limits differ by token (for example 10 USDC versus 0.001 ETH).

## 3. Are the spending limits clear and strong enough?

What the contracts enforce today, with the label text we'd show:

| Label | What it really controls |
|---|---|
| Max per send from Push | The most of a token sent from Push in one transaction |
| Max total sent from Push (includes failed sends) | The most of a token sent from Push over the rule's life. If a send fails on the other chain, the tokens come back to the wallet on Push, but the amount still counts toward this total. It doesn't count funds already on the other chain |
| Max per action | The most used in one app action. The agent can repeat actions until the rule expires |
| Max gas per transaction (PC) | The most PC attached for gas in one transaction. Unused gas is refunded to the wallet. There's no total gas limit |

**Not limited today:**

- **Swap price (slippage).** The agent can accept any price on a swap. A careless or malicious agent could swap 100 USDC for far less than it's worth and stay within every limit above.
- **Total borrowing on lending apps.** Only each action is limited.

**Decisions needed:**

1. Is it OK to ship with these limits and labels?
2. Do you need either of these stronger limits? Both need contract work (Zaryab):
   - a. **A total limit on activity on the other chain**, for example "at most 100 USDC of swaps in total". This closes the gap that repeated actions have no total.
   - b. **A limit on the combined amount of all actions in one transaction.** Today one transaction can include up to 10 actions, each at the per-action maximum.
3. Push-chain rules can already enforce a total amount and a maximum number of uses, but the SDK doesn't offer them yet. Should it? (SDK only. Other-chain rules would still lack these totals unless 2a is built.)

## 4. How many app actions can a Push-chain rule have?

The SDK spec says 1–32 app actions per rule. The deployed contract allows 32 for other-chain rules, but only 8 for Push-chain rules. The contract chose 8 on purpose, to keep what an owner approves at once readable, not because of gas. Owners who need more can create several rules for the same agent; several rules can be created together in one approval.

- **A. Change the spec** to "up to 8 for Push-chain rules" (spec text only)
- **B. Ask for more than 8** (contract change and redeploy, Zaryab)

**Decision needed:** A or B? If B, how many?
