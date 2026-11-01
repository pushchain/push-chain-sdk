# M4 mutability and M6 / K-12 payment analysis

October 20. This answers the questions in the user's supplied team discussion, checked against fresh Notion bodies/comments and deployment source. Recommendations below are proposals, not new product decisions.

## M4: what the design says versus what exists

The page-body understanding is substantially right: a provider-authorized replacement is proposed while Open, the client accepts at fund, and `origin`, `allowedMutability` and timing restrictions survive. The original page does not provide a client proposal route even though CLIENT/BOTH exists and setBudget is provider-only.

**Current deployed v2 does none of the replacement workflow.** The builder copies the flag; the interim RulesBindingHook only processes fund's rulesId; the evaluator is an EOA. A setBudget payload does not replace the kernel's description or establish evaluator state. A non-NONE flag is not an implemented permission system. The independent review case registers BOTH, passes arbitrary replacement bytes to setBudget, observes the original description unchanged and funds successfully.

The later evaluator source linked by Nilesh does contain a different client-fund replacement design in its type comments, but also a different wire, enum order and hook contract assumptions. It cannot resolve the deployed API by inference. Marketplace NONE=0 while that evaluator NONE=1 and BOTH=0 is a particularly dangerous ordinal mismatch. Never send bytes across those profiles on the assumption that matching enum names imply matching ABI.

### Is it needed for the first release?

Recommend retaining the schema field and requiring **NONE in the initial marketplace authoring flow**, pending Harsh's explicit decision. Parameterized templates already handle expected input variation. For a genuinely changed agreement, cancel the Open job, revoke its permissions, preview a new job and sign again. Do not describe cancel as revocation unless that cleanup actually happened.

This is an SDK/product restriction unless enforced on-chain too: existing deployed contracts accept non-NONE templates. It is not a security guarantee against arbitrary direct callers. To guarantee immutable card criteria at protocol level, a compatible hook/evaluator or marketplace registration/open guard must enforce NONE.

### The same-price front-run is real for the proposed mutable workflow

`expectedBudget` only commits a number. If the future evaluator freezes its current standing proposal without checking what the funding client reviewed, the provider can replace criteria at the same price before fund executes. A last-moment SDK reread/simulation does not close a mempool race.

The example's exact payout depends on the actual checks: changing only a rate threshold does not remove an independent “deposit at least 499 USDC” check if both are required. A whole replacement with weaker/removable checks can still make the attack work. The core issue is accepting an uncommitted spec, regardless of the example's arithmetic.

### A complete later solution

1. Give a quote/proposal a canonical identity, at minimum `keccak256(exactEncodedJobSpec)`, optionally a monotonically increasing quote revision. Keep marketplace/version/provider/client/kernel/job identity in the checked context.
2. The client reviews and authorizes **both the exact expected budget and exact expected spec hash/revision**. Do not silently refresh either when sending. The token is already immutable in the current single-token kernel; a later per-job token must be part of that accepted context too.
3. During fund, before acceptance/escrow commits, the hook compares the supplied expected hash/revision with the standing spec that will actually be frozen. Any mismatch reverts the entire transaction. Freeze those exact bytes atomically; no mutation after funding.
4. Authenticate proposals against the original allowedMutability. For CLIENT/BOTH, define an explicit authenticated client route: a dedicated proposal call, or a replacement submitted by the client in fund. Do not allow the provider to impersonate a client proposal through provider-only setBudget. Preserve origin/flag and validate complete replacement timing/structure.
5. Version the hook payload and capability. Today's RulesBindingHook **requires exactly 32 bytes**, so appending a hash to current `abi.encode(rulesId)` will revert. This requires compatible hook/evaluator delivery; it is not an SDK-only patch. A versioned payload might include rulesId, expectedSpecHash and proposal revision. Kernel signature can remain unchanged if its hooks enforce this through optParams.
6. Test same-price and changed-price front-runs, stale revisions, client/provider authorization, immutable fields, timing, rollback, replay, alternate hooks and terminal-state writes. SDK checks improve feedback; the on-chain atomic comparison supplies the protection.

## M6 / K-12: present answer

The requested end state is reasonable: each card chooses a token and every job's escrow/payout/refund uses that immutable token. Adding that token to createJob and the stored Job is a Push extension to the presently deployed ABI. The current kernel has one token from initialize and scalar totalEscrowed; a card label alone cannot change it.

**The rollout has already chosen the interim path:** v2 registration/update rejects every card token except the kernel's actual pUSDC. No K-12 decision is needed to start this SDK phase. Read the deployed token and explicitly reject unsupported user input; do not follow the stale instruction that an explicit mismatching token is simply ignored.

Do not switch marketplace addresses to an unrelated multi-token/demo kernel. KERNEL is set once, and old jobs remain associated with the old kernel. Bind ABI, hook, evaluator, token and marketplace configuration as one verified deployment profile.

### If K-12 is approved later

- Add token to creation and immutable per-job storage; use the job token in funding, provider/evaluator/platform payout, refunds and rescue accounting. Track escrow liabilities per token. Preserve old storage layout and define old-job migration/reads rather than reinterpreting existing slots.
- Keep a capability-specific createJob encoder. The token must be inside the createJob calldata hash authorized by OwnerIntent. Publish the new ABI/version and shared vectors together; no speculative two-format signing now.
- A curated admin allowlist is a reasonable first policy, with events and clear treatment of already-open/funded jobs when a token is delisted. Always permit settlement/refund of existing liabilities. An allowlist alone is not proof of safe ERC-20 behavior: validate exact received amounts or explicitly exclude fee-on-transfer/rebasing assets, and test reentrancy and unusual token failures.
- “PC” needs clarification: the current kernel is ERC-20-only. Native PC escrow is not accomplished by passing address(0); either choose a supported wrapped-PC ERC-20 or design payable/native accounting separately.
- Upgrade/redeploy the kernel plus compatible marketplace/hook wiring once the choice is final. Existing addresses and signed plans remain tied to their original deployment. Old signatures must fail closed on an incompatible new path.

## Adjacent funding issue already present

Card providerFee is a reference, not a kernel constraint. The independent test funds at three times the card's providerFee when the client supplies that exact larger expectedBudget. Therefore the page's “read current budget” convenience must not become silent price acceptance. For an initial fixed-card-price UX, fund against the **opened card version's reviewed providerFee** and reject a different current budget. For negotiation, expose an explicit reviewed quote with expectedBudget. The source makes either possible; product must choose the public behavior.
