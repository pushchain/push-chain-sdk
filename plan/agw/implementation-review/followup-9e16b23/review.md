# Follow-up review of the R1 through R7 fixes

Reviewed `9e16b23a76816176dca20793d74df5a5548a497e`, including fixes in `880e7ae`, against the original `3008497` review. The two authorization races are addressed. The other original mechanisms have been corrected, with R5 still requiring public API approval and outbound settlement still requiring live acceptance. One new medium-priority replay inconsistency remains before merge.

## F1 Explicit ERC20 calls are reinterpreted during replay

**Priority:** medium. **Source:** [response.ts](../../../../packages/core/src/lib/agentic/response.ts#L138).

`logicalOutboundCall` treats every one-call payload with selector `0xa9059cbb` and the expected length as an automatically generated funds-only transfer. But a user can explicitly call `transfer(recipient, amount)` on a destination token using `to = token` and `data = transferCalldata`, with no funds input. The live send reports the token and calldata; replay changes them to `to = recipient` and `data = 0x`.

The serialized call does not distinguish a generated transfer from identical explicit calldata. The current heuristic therefore invents an original input shape and breaks send/track consistency. Amount-bearing receipt interpretation and display of what was actually called can be misleading even though wallet `from` remains correct.

**Reproduced:** [replay.spec.ts](replay.spec.ts), F1. Expected the explicit token target/calldata; received the transfer beneficiary and empty data. [Output](replay.log).

**Fix direction:** preserve the actual call representation or define a common canonical representation for both live and replayed responses. Do not infer whether calldata was generated from the selector alone. If requested-recipient conveniences are retained, keep them separate from authoritative execution data. Cover explicit transfer, funds-only transfer, transfer plus contract call, and explicit multicall arrays.

## Original finding disposition

| Finding | Follow-up result | Remaining work |
| --- | --- | --- |
| R1 create race | Fixed by index/address-bound factory call. Pinned AGWFactory.sol checks index and prediction before deploying, and skips signature verification only when msg.sender equals owner. Local race/retry coverage passes. | External-owner/UEA and atomic transport acceptance remain part of the existing coverage scope. |
| R2 explicit Push destination | Fixed by normalization of the connected Push chain and rejection of another Push network. | Keep alias/localnet coverage. |
| R3 lost outbound recipient | Composer now encodes transfer/native-value instructions or rejects unsupported empty-call shapes. Explicit call arrays remain caller-authored. | Actual recipient effects and executing CEA correlation still need a verified live deployment. |
| R4 revoked/unlimited allowance | Fixed by removing allowance writes on both paths. A concurrent revocation makes the pull fail; it is not restored. | Production token/gateway acceptance; retain the separate approval setup flow. |
| R5 misleading decode | Raw offsets and exact words now round-trip without pretending to recover ABI indexes. | This extends both input and output types. Product must approve the representation and whether raw authoring is permitted. |
| R6 wrong replay route | Route correction works. The deeper reviewer check below confirms response-builder wait enters outbound polling. | F1 is a separate logical-call reconstruction defect. Live indexing is still untested. |
| R7 false partial-create state | Recovery uses this operation's receipts, keeps unknown state explicit, and preserves submitted hashes when receipt retrieval fails. Updated unit cases pass. | Maintain distinct confirmed/pending/unknown states as recovery evolves. |

Pinned contract check for R1: [AGWFactory at e704d5b](https://github.com/pushchain/push-agentic-wallets/blob/e704d5b58fd1d30ce02bc0ad74dccfbdb37804f9/src/AGWFactory.sol#L164). Empty signature/deadline is valid on this direct-owner path because only the non-owner branch checks executor, deadline and signature; index and predicted-wallet checks always execute first.

## Additional R6 verification

The reviewer constructed a real `transformToUniversalTxResponse` result with an early UOA_TO_PUSH route and Push chain, applied the AGW adapter, then invoked the real `wait()` closure. Destination polling was mocked at the RPC boundary. The test confirms:

- Route/chain change to the outbound context.
- Destination polling executes exactly once.
- The waited receipt retains AGW from and reports the destination result.

This closes the previously untested adapter-to-wait linkage locally. It does not exercise the entire trackTransaction acquisition path, real Cosmos timing, node/TSS behavior or live settlement. Keep that limitation separate from the now-tested wait branch.

## Verification reproduced

| Check | Result |
| --- | --- |
| Full unit suite | 1,899 passed; 12 skipped; 110 suites passed and 1 skipped |
| Local real-contract harness | 34 passed in 4 suites, including create and allowance races |
| Library typecheck | Passed |
| Spec/E2E typecheck | Passed |
| Core build with cache bypassed | Passed |
| AGW E2E manifest verification | 21 scenarios, 7 files, 21 selected tests |
| Existing all manifest verification | 76 scenarios, 40 files, 81 selected tests |
| Additional replay follow-up | R6 wait-branch test passed; F1 explicit-transfer regression failed |
| Live E2E | Not run |

Lint was not rerun in this follow-up; the earlier seven-error baseline remains recorded separately. No production file or original review evidence was edited. Only the new follow-up report, tests and logs were added. [Evidence and checksums](evidence.json).

## Next steps

1. Fix F1 and add the canonical live/replay cases to the regular suite. Promote the passing R6 response-builder/wait test into regular coverage as well.
2. Add the R5 public type question to the product decision list: should decoded rules expose `{ offset, expected }`, should that raw form be accepted for new grants, or should decoded wire records remain separate from ABI-based authoring? The contract-delegated ABI-position generation obligation needs an explicit answer if raw authoring is exposed.
3. Keep the current registry/capability gates while the existing product and contract answers are pending. Do not replace them with historical Donut addresses to obtain a green live test.
4. Before a funded run, complete destination caller/event correlation, verify exact deployment artifacts/capabilities and network, and check funding budgets and setup. Shared-counter growth plus a computed CEA address is not by itself proof of the actual executor.
5. After F1 and focused regression checks pass, prepare a draft PR for the gated implementation with A01–A08 and the raw-offset API decision clearly identified. Release/live enablement remains a separate gate.

Keep the original review folder on the branch: it explains the fixes and preserves reproducible evidence. Its tests are tied to the old API and are not the current acceptance suite. The parent README now makes the revision boundaries explicit.
