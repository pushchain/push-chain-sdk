# Product decisions for Harsh: agentic wallet creation

Updated October 21, 2026. Draft; nothing sent.

These questions come from Riyanshu's feedback on the wallet-creation screen. Each one describes how things work today, then the choices. Some choices need extra work from Zaryab (contracts), and that is noted where it applies. The SDK can implement whichever option you pick. Preset questions (preset tokens and routes) are with Aman in [questions-aman.md](questions-aman.md).

Terms used:

- **Rule:** what the owner grants an agent: which apps it may call, which tokens it may move, and limits.
- **Destination account:** the wallet's own account on the other chain (Sepolia, Base, Solana, …). Tokens sent from Push land there first, and the agent's app actions run from there.

---

## 1. Can a rule allow token transfers without picking any app?

**Today.** A rule must include at least one app action, such as "swap on Uniswap". The contract rejects a rule that has tokens but no actions. Riyanshu expected the owner to be able to pick only tokens and leave apps empty.

**What we can build.** We can build a "transfer" action automatically, so a tokens-only rule becomes a rule that allows sending those tokens. The decision is who the agent may send them to:

| Option | What the agent could do | Extra work |
|---|---|---|
| A. Named recipients | Send the selected tokens only to addresses the owner enters, up to a per-transfer amount | SDK only |
| B. Any recipient | Send the selected tokens to any address, up to a per-transfer amount | SDK only |
| C. Owner's own address | Send tokens only back to the owner's address on that chain | SDK only |
| D. Keep apps required | No change; the screen explains that an app must be chosen | UI text only |

**Things to know whichever option you pick:**

- The permission also covers tokens already sitting in the destination account, not only tokens sent from Push.
- The per-transfer limit applies to each transfer. The agent can repeat transfers until the rule expires, so there is no total limit on transfers made on that chain.
- This works for regular tokens (ERC20) on EVM chains.
  - Native coins (ETH/BNB) can't be sent this way. They would arrive as wrapped WETH/WBNB instead.
  - On Solana it is not possible at all without contract changes.

**Decision needed:** A, B, C or D. If A, B or C: is EVM tokens only acceptable for the first version?

---

## 2. What should "no tokens selected" mean?

**Today.** If the owner selects no tokens, the agent cannot move any tokens out of Push. Riyanshu expected no selection to mean "all tokens allowed".

**How the contract works.** A rule can list at most 8 tokens per chain, and each needs its own limit. There is no "any token" setting, and tokens added later are never included automatically.

| Option | What it means | Extra work |
|---|---|---|
| A. Keep as is | No tokens selected means no tokens can be moved | None |
| B. "All supported tokens" button | One click fills in every supported token for that chain (currently 3–7 per chain). The owner still sees the list, and each token gets its own limit | SDK and UI |
| C. True "any token" | Covers every token, including ones added in the future, under one limit | New contract design (Zaryab) |

**Note on option B.** It needs a limit for each token, because amounts differ by token (for example 10 USDC versus 0.001 ETH). Either the owner enters them, or we supply a reviewed default per token.

**Decision needed:** A, B or C. If B: should the owner enter each limit, or should we supply defaults?

---

## 3. What do the spending limits mean, and are they strong enough?

**Today.** These are the limits the contracts actually enforce:

| Limit | What it really controls |
|---|---|
| Per send from Push | The most of a token sent from Push in one transaction |
| Total from Push | The most of a token sent from Push over the rule's life. It also counts sends that later fail on the other chain. It does **not** count funds already on the other chain |
| Per action (swap, lend, etc.) | The most used in one action. The agent can repeat actions until the rule expires |
| Gas per transaction | The most PC attached for gas in one transaction; unused gas is refunded. There is no total gas limit |

**Not limited today:** the price a swap gets (slippage), and total borrowing on lending apps. Borrowing is limited per action only.

**Decisions needed:**

1. Is it acceptable to ship with these limits, with labels that describe them exactly as above?
2. Do you need either of these stronger limits?
   - a. a total limit for activity on the other chain (for example "at most 100 USDC of swaps in total");
   - b. a limit on the combined amount of all actions in one transaction.

   Both need contract work (Zaryab).
3. Rules for apps on Push itself can already enforce totals (a total amount and a maximum number of uses) in the contract. The SDK doesn't offer them yet. Should it? This is SDK work only.

---

## 4. How many app actions can a Push-chain rule have?

**Today.** The SDK spec says a rule can have 1 to 32 app actions on every chain. The deployed contract allows 32 for other chains, but only 8 for rules about apps on Push itself. The contract source says 8 was chosen on purpose, to keep what an owner approves at once readable (not because of gas), and that raising it is a design change. Owners who need more can create more than one rule for the same agent.

| Option | Extra work |
|---|---|
| A. Change the spec to "up to 8 for Push-chain rules" | Spec text only |
| B. Ask for more than 8 | Contract design change and redeployment (Zaryab) |

**Decision needed:** A or B. If B, how many are needed?
