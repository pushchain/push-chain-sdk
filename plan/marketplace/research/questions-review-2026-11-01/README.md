# Pending-question source audit — November 1, 2026

Reviewed the current remote branch heads, contract implementations, tests, AGW v6
source, marketplace docs and the SDK's live acceptance records. Rechecked Donut
read-only at block **24873403**. No public-chain writes or implementation changes.

## Revisions and validation

- Evaluator remote head remains `a7a8547822904b62c9b9dc031822b14c972abbc8`.
- Marketplace remote head remains `5aad0392510b7b4dce807f7edba39054c8f95fc4`;
  PR135 is open. The recent PR inventory contains no delivered all-rule hook upgrade.
- AGW review uses deployed-generation pin `ffd567d3e49b2d27c6f50ad36093274dbac3090f`.
- Fresh live reads confirm cap4, the documented hook/evaluator wiring, unchanged
  marketplace/hook/evaluator implementation addresses, and a 32-byte scalar return
  from the hook's `rulesOfJob(23)`. The marketplace returns that job's ID in an array.
  Addresses and current implementation code hashes are in [live-state.json](live-state.json).
- Reran **32 hook-binding tests** and **one owner-check test** successfully, offline.
  Logs are [hook-tests.log](hook-tests.log) and [owner-check-test.log](owner-check-test.log).

The deployed implementations are not source-verified according to the address
book. The live checks establish wiring, implementation identity and getter shape;
source behavior below is established against the reviewed branches and local tests,
with prior live acceptance supporting single-rule integration. This is not a claim
of byte-for-byte reproduction of deployed implementation code.

## What we can answer ourselves

| Previous question | Established answer | Evidence |
| --- | --- | --- |
| Current fund payload, getter and event | Evaluated funding accepts `(bytes32 rulesId, bytes32 expectedSpecHash, bytes newSpec)`. The hook getter returns one bytes32 and emits `RulesBound(jobId, agw, rulesId)`. | Hook `_parseFundParams`, `rulesOfJob`, `RulesBound`; fresh scalar-return read. |
| Hash/replacement semantics | `expectedSpecHash` must equal the final criteria hash; empty `newSpec` keeps current criteria. Replacement follows the original mutability flag; marketplace criteria are NONE. This hash is not a commitment to the complete permission set. | Hook `_postFund`, `_flag`, `_requireSameFlag`. |
| Before-escrow validation | The supplied permission must be enabled on the funding AGW. Failure reverts the funding transaction, including token movement and binding. This check currently covers only the supplied ID. | Hook `_preFund`; kernel `fund`; revoked/missing/foreign-wallet and transfer-rollback binding tests. |
| One live job per wallet | Already wallet-wide, not scoped to the first rule's chain. The hook rejects a second funding while its previous job is Funded/Submitted. | Hook `_lastBoundJob`, `activeJobOf`; funded/submitted exclusion tests. |
| Can an owner revoke after funding? | AGW revocation is permitted for owner/self and has no job-lock check. It immediately removes the permission and increments the wallet checkpoint. | AGW `revokeRules`, `revokeAllRules`. |
| What does ownerCheck cover? | The evaluator compares the wallet-wide checkpoint at funding with its value when the verdict is recorded. Grant/revoke and owner execution activity can produce TOUCHED, including legitimate client retries. It does not identify the affected rule or establish malicious interference. Cosmetic label changes do not increment this counter. | AGW checkpoint calls and `setLabel`; evaluator `startSnapshot`, `_ownerCheck`; EvaluationTypes OwnerCheck documentation. |
| Does TOUCHED change payment? | No. The flag is recorded in `Verified` and the reason hash, not used to choose settlement. PASS completes/pays, FAIL rejects/refunds, INCONCLUSIVE does not settle. No separate client-fault compensation policy exists in this implementation. | Evaluator `_finish`, `_apply`, `_reason`; `test_UE13_ownerCheck_clean_touched_unknown` proves TOUCHED and UNKNOWN can still complete. |
| Automatic terminal revocation? | None in this stack. Grants may remain enabled until an authorized revocation; their validity window limits execution. Provider/evaluator status alone supplies no AGW revoke authority. | AGW `onlyOwnerOrSelf`; hook has no terminal cleanup handler; marketplace README §13.4 explicitly documents retained grants. |
| Does the wallet wait for cleanup? | No. Hook occupancy becomes free when kernel status is terminal, independently of permission removal. Funded/Submitted jobs remain busy after the clock passes expiry until a settlement/refund changes status. Marketplace also treats an unexpired Open job as busy. | Hook and marketplace `activeJobOf`; free-after-complete/reject/refund tests; same-permission reuse across sequential jobs. |
| Cleanup/retry ABI? | No automatic protocol cleanup/retry workflow exists. The SDK owner cancellation path batches rejection and revocation. Our completion E2E explicitly called owner `rules.delete` after settlement. | Kernel terminal functions, hook/base handlers, SDK live test and cleanup audit. |
| Is the current cap decision unknown? | No. The thread records Aman requesting a cap above1 and Zaryab setting4; the address book and fresh chain read confirm4. Reconsidering that interim policy would be a new request, not missing information. | Provided discussion, marketplace address book and live state. |
| Current deployment handoff? | Current commits, proxy/implementation addresses, transactions and wiring are already documented. Only the future upgraded hook handoff is missing. | Current address book; unchanged remote heads and fresh implementation-slot reads. |

## What remains unresolved

1. **The new hook interface and delivery:** no reviewed current branch implements
   all-rule fund binding. The final tuple/getters/events/errors and upgrade
   commit/deployment must come from the implementation owner.
2. **Authenticating the complete set:** the marketplace already stores ordered
   `_rulesOfJob[jobId]` after validating/granting all sessions. The hook does not
   consult that mapping or another job-specific rule commitment. Merely accepting
   an array would still let callers omit a secondary rule unless completeness is
   enforced. The trusted source/linkage, ordering and invalid-set handling are
   future contract-design details, not facts discoverable in today's implementation.

Post-funding revocation and owner-driven cleanup are known current policies. A
change to those policies would require explicit new scope; neither should be
presented as an unanswered description of how the current contracts behave.

## Primary sources

- [UniversalHook: binding and funding](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/src/agentic-commerce-8183/hooks/UniversalHook.sol#L108)
- [Evaluator: verdict, owner check and settlement](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/src/agentic-commerce-8183/evaluator/UniversalEvaluator.sol#L746)
- [Owner-check semantics](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/src/agentic-commerce-8183/evaluator/EvaluationTypes.sol#L29)
- [Owner-check test](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/test/8183-tests/UniversalEvaluator.t.sol#L281)
- [Hook binding tests](https://github.com/pushchain/push-chain-core-contracts/blob/a7a8547822904b62c9b9dc031822b14c972abbc8/test/8183-tests/UniversalHook.binding.t.sol)
- [AGW revocation and checkpoints](https://github.com/pushchain/push-agentic-wallets/blob/ffd567d3e49b2d27c6f50ad36093274dbac3090f/src/AGW.sol#L906)
- [Marketplace: recording all granted rule IDs](https://github.com/pushchain/push-chain-core-contracts/blob/5aad0392510b7b4dce807f7edba39054c8f95fc4/src/agentic-commerce-8183/UniversalMarketplace.sol#L318)
- [Marketplace limitations](https://github.com/pushchain/push-chain-core-contracts/blob/5aad0392510b7b4dce807f7edba39054c8f95fc4/docs/universalmarketplace/README.md)
- [Existing deployment record](https://github.com/pushchain/push-chain-core-contracts/blob/5aad0392510b7b4dce807f7edba39054c8f95fc4/docs/addresses/push_donut_universal_marketplace.md)
- [SDK live acceptance](../sdk-2.1-2026-11-01/live/README.md)
