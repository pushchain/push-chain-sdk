# 2. Universal Marketplace

<aside>
🏪

**Where we are going.** A registry of signed agent cards, an on-chain compiler that turns a card plus the user's numbers into rules and criteria, and a one-signature start job that deploys the wallet, funds it, grants the rules and opens the 8183 job. Phase 2 adds bidding; nothing here blocks it.

**What this page is.** The marketplace's four responsibilities, the agent card, the start-job decision (SDK-orchestrated vs marketplace-orchestrated), and how a provider accepts a job when the fee is fixed.

**Status.** DESIGN. No contract, no repo, no owner. One decision (section 3) has blocked the team since 2026-09-17.

</aside>

Status: DESIGN. No contract, no repo, no owner assigned. Blocking Zaryab since 2026-09-17 on one decision (section 3).

# What it is

The discovery layer. Agents list what they do and what access they need. Users pick a card and start a job in one signature. It is also the place a human-verified badge lives, so unverified cards are shown with a caution.

Phase 2 (not now): users post a job and agents bid. Every design choice below must not block it, but nothing is built for it.

# What it does, in four responsibilities

| Responsibility | What it means | On-chain or off-chain |
| --- | --- | --- |
| Registry | Stores agent cards, signed by the agent's execution key. Versioned. Carries the verified badge. | On-chain hash plus signature; card content on-chain or off-chain (open) |
| Compiler | `compile(card, userInput)` turns a card plus the user's principal, duration and choices into: the rules for the AGW, the evaluation criteria for the job, and a `criteriaHash`. Pure and deterministic. | On-chain pure view, so the SDK, the preview and the 8183 hook all get the same answer |
| Start job | Deploy or reuse the AGW, fund it, grant the compiled rules, create the 8183 job with the criteria in the description. One signature. | See section 3 |
| Preview | Shows the user, in words, exactly what the agent may do (every contract, function, pinned argument, cap, expiry) and what the evaluator will check. | Off-chain, from the compiler's output |

# The agent card

What the agent publishes. Field names follow the O9 draft; the criteria block is new (2026-09-28).

```json
{
  "cardVersion": 1,
  "provider": { "account": "0xProviderUEA", "executionKey": { "scheme": 0, "key": "0xAgentKey" }, "signature": "0x..." },
  "offer": {
    "title": "Aave v3 yield optimiser",
    "fee": { "asset": "0xPaymentToken", "amount": "5000000" },
    "principal": { "min": "100000000", "max": "50000000000" },
    "durationDays": { "min": 7, "max": 90, "default": 30 }
  },
  "rulesTemplate": {
    "chainNamespace": "eip155:11155111",
    "asset": "0xUsdcOnPush",
    "actions": [ { "contract": "0xAavePool", "function": "supply(address,uint256,address,uint16)",
                   "args": { "asset": { "role": "fixed", "value": "0xUSDC" }, "amount": { "role": "amount" },
                             "onBehalfOf": { "role": "beneficiary" }, "referralCode": { "role": "fixed", "value": 0 } } } ],
    "gas": { "pcPerAction": "4000000000000000000", "expectedActions": 12 }
  },
  "criteriaTemplate": {
    "minDuration": 2592000,
    "conditions": [ { "read": { "chainNamespace": "eip155:11155111", "target": "0xaUSDC", "call": "balanceOf(ACCOUNT)" },
                      "sample": "START_AND_END", "compare": { "op": "GTE", "basis": "PCT", "value": 400 } } ]
  }
}
```

Roles on arguments: `beneficiary` (the user's account, filled by the compiler), `amount` (metered against the user's principal), `fixed` (a constant the provider requires), `userChoice` (picked by the user from a list), `free` (the agent decides at run time). Placeholders `ACCOUNT` and `PRINCIPAL` in the criteria are filled by the compiler.

The user supplies only: principal, duration, any `userChoice` values, and which AGW (new or existing).

# The decision that unblocks everything: where startJob runs

The facts (from the code): `deployWallet` makes the caller the owner; `grantRules` is owner-only; `execute` drops return data so a jobId cannot feed a later call in the same batch; `fund` needs `setBudget` from the provider first.

|  | A. SDK-orchestrated | B. Marketplace-orchestrated |
| --- | --- | --- |
| How | The user's UEA signs one multicall: deployWallet, fund, grantRules, execute(createJob). The marketplace is registry, compiler and preview only. | `UniversalMarketplace.startJob(auth, cardId, userInput)` verifies one EIP-712 authorization from the owner and calls the WithSig variants on factory and wallet. |
| Contract changes | None on the AGW | Needs `deployWalletWithSig`, `grantRulesWithSig`, `executeWithSig` (page 1, section 4b) |
| Push-native users | Several transactions (no UEA to batch) | One signature |
| External-origin users | One signature | One signature; the WithSig variants must accept ERC-1271 because the UEA is a contract |
| Audit surface | Smaller now | One canonical path, one place for the one-live-job-per-AGW check |

Recommendation: B is the end state and Harsh's stated requirement. A is the faster first ship if the demo user is external-origin. If the demo user is Push-native, go straight to B.

# Provider acceptance

With a fixed fee there is no moment where the provider says yes to a specific job. Rule: the provider accepts by signing the card, which carries the criteria template and the bounds on principal and duration. At fund, the 8183 hook recomputes `compile(card, userInput)` and refuses the job if the `criteriaHash` in the description does not match. This is why `compile` must be an on-chain view. Vanilla jobs without a card use `setBudget` as the acceptance step.

# Open

1. Start job: A first or B from day one (depends on the demo user).
2. Card storage: fully on-chain, or hash on-chain with content off-chain.
3. Canonical encoding of the card for hashing and signing (ABI vs JSON). SDK, marketplace and hook must agree.
4. Vetting: curated list of contracts and functions, warning tier, or badge only.
5. Bid mode in v1 at all. If not, `setProvider` leaves the flow.
6. Which repo, which owner.