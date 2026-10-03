# AGW implementation review

**Verdict: changes requested before merging or enabling a deployment.** The implementation has useful boundaries and its reported passing suites reproduce, but additional tests expose seven correctness issues. Two reproduce with the actual pinned contracts on local Anvil and affect which permissions survive a transaction.

Reviewed `feat/agw-sdk-impl@3008497b2492a6be78300011d4572076414505bf` against planning base `349635b2254823488603b37f4b44c4f5c929feb9`. Production files and existing tests were not edited. New review files are confined to this directory. No live-network transaction was sent. The generation registry is empty, so these findings concern implementation readiness rather than a currently enabled public deployment.

## Findings

### R1 High priority Granting on the wrong wallet after a create race

**Source:** [create.ts](../../../packages/core/src/lib/agentic/management/create.ts#L98), construction of deploy/grant calls; the index mismatch is checked only after confirmation at line 129.

The SDK predicts wallet N, encodes `deployWallet(label)` without binding the expected index, and encodes all grants against wallet N. If another creation for the same owner lands before this operation, the factory deploys N+1 while the grant calls still target N. The SDK then throws INDEX_RACE, but the grants on the other-purpose wallet are already committed. This is more than an inconvenient return value: the agent receives authority on a wallet this creation did not deploy.

**Reproduced against real contracts:** inserted one owner deployment after composition and before the SDK transport executes. The SDK threw INDEX_RACE, and `getPermissionIDs(predictedWallet)` returned one enabled rule instead of zero. See [local test](local-races.spec.ts), test R1, and [output](local-races.log).

**Required change:** for sequential creation, confirm the deployed wallet/event before building and signing grants for that actual wallet, revalidating inputs as needed. An atomic creation path needs a contract-enforced expected-index/address condition, such as a verified index-bound deployment intent, or must be gated until safe. An extra RPC read or per-process mutex alone cannot prevent cross-client races. Add a regression asserting that neither another wallet nor the wrong creation receives grants.

### R2 Medium priority Explicit Push destinations are treated as outbound

**Source:** [send.ts](../../../packages/core/src/lib/agentic/execution/send.ts#L100).

`outbound = isChainTarget(p.to)` checks the input shape, not the chain. Therefore `{ to: { address: target, chain: CHAIN.PUSH_TESTNET_DONUT } }` enters the universal path. With a valid native rule it throws “not an EVM universal rule”; owner calls instead attempt destination CEA/outbound composition. The equivalent bare address succeeds.

**Reproduced:** the explicit connected-Push agent call fails before sending in [regressions.spec.ts](regressions.spec.ts), R2. Core's ordinary [route detector](../../../packages/core/src/lib/orchestrator/route-detector.ts#L186) already distinguishes a Push ChainTarget from a foreign destination.

**Required change:** normalize the connected Push destination before selecting rulebook, gas fields and call address. Reject incompatible Push network targets explicitly. Cover owner and agent, string and ChainTarget forms, and chain aliases/localnet identity.

### R3 High priority Transfer-only owner outbounds discard the recipient

**Source:** [outbound.ts](../../../packages/core/src/lib/agentic/execution/outbound.ts#L50), destinationCalls; [request construction](../../../packages/core/src/lib/agentic/execution/outbound.ts#L137).

For an owner send with `to: { address: recipient, chain }`, `funds.amount > 0` and no data, the composer creates no destination calls, uses `payload = 0x`, and forces `recipient = 0x`. The requested address is absent from the encoded gateway call. Nevertheless, the response path reports that requested address as the logical `to`. An outbound without any encoded recipient/transfer instruction cannot perform the requested delivery; depending on the gateway/node path it parks value in the wallet's CEA or fails.

The same empty-call branch ignores a transfer-only `value` request. This is not covered by the successful payload-bearing historical universal experiment.

**Reproduced:** a positive-amount owner transfer-only request contains no bytes of the intended recipient in the encoded gateway call; R3 in [regressions.spec.ts](regressions.spec.ts).

**Required change:** preserve owner transfer semantics using the appropriate request recipient or destination transfer payload, including native value behavior. If a shape is not supported yet, reject it explicitly before signing. Do not report a logical delivery that the encoded request never instructs. Add recipient-balance/target-effect acceptance tests when a deployment exists.

### R4 High priority Automatic owner approval can restore revoked authority

**Source:** [outbound.ts](../../../packages/core/src/lib/agentic/execution/outbound.ts#L170), ownerOutboundCalls; allowance is read earlier in [send.ts](../../../packages/core/src/lib/agentic/execution/send.ts#L168).

The owner composer automatically approves `snapshotAllowance + outboundAmount`. That is an unconditional write based on stale state. If an owner revokes the standing allowance after the read but before this send, the batch restores the previous allowance. Likewise, agent spending in the interval can be replenished unintentionally. Atomic approval plus burn does not make the preceding off-chain snapshot atomic.

**Reproduced against real contracts:** started with allowance 50, composed an outbound of 10, then mined an owner approval of zero before executing the outbound batch. The final allowance was 50, restoring the revoked permission. See R4 in [local-races.spec.ts](local-races.spec.ts) and [output](local-races.log).

There is also a deterministic boundary failure: an existing `uint256.max` allowance plus any positive amount overflows ABI encoding. R4 in [regressions.spec.ts](regressions.spec.ts) fails before signing with IntegerOutOfRangeError.

**Required change:** remove the implicit read-modify-write allowance preservation. Prefer the already planned separate bounded owner approval flow, consuming an existing sufficient allowance. If automated approval remains supported, define its explicit authorization and concurrency semantics without reinstating revoked/consumed authority. Handle unlimited and zero-reset token behavior deliberately. Retest both races and maximum allowance.

### R5 Medium priority Decoded native rules contain misleading argument data

**Source:** [native.ts](../../../packages/core/src/lib/agentic/codec/native.ts#L196).

`nativeTermsToRule` converts calldata offsets into public `arg` indexes using `(offset - 4) / 32`, although the encoder supports preceding fixed arrays and static tuples occupying multiple words. For `deposit(uint256[2],address)` the correct pin argument is 1; the returned public record says 2. The on-chain terms do not carry enough ABI information to justify that conversion.

It also returns every pin's expected word as raw bytes32. A simple address pin cannot be re-encoded even after the caller restores the known function signature: `encodeArgWord(address, bytes32)` rejects the returned expected value. Without restoring the signature, any pinned rule fails because the returned selector is only four bytes.

**Reproduced:** both static-array indexing and simple address-pin re-encoding fail in R5's two tests in [regressions.spec.ts](regressions.spec.ts).

**Required change:** recover/require verified ABI context for a faithful public NativeRule, or return an explicitly distinct raw representation/capability error while that metadata is unavailable. Do not label a wire-word index as an argument index. This needs an explicit read/codec contract if the public shape changes. Add encode → read/decode → edit/re-encode tests across addresses, integers, arrays and tuples.

### R6 Medium priority Replay can retain a non-outbound route after decoding an outbound

**Source:** [response.ts](../../../packages/core/src/lib/agentic/response.ts#L109).

After successfully recognizing an AGW gateway outbound, replay uses `resp.route ?? 'UOA_TO_CEA'`. Core can already have assigned UOA_TO_PUSH when the Cosmos record exists but has not yet exposed an outbound leg/status; see [route inference](../../../packages/core/src/lib/orchestrator/internals/tx-transformer.ts#L565). The adapter keeps that route even though it has decoded the outbound calldata. `wait()` then sees a non-outbound route and does not enter destination polling.

**Reproduced:** a valid decoded AGW outbound carrying a preexisting UOA_TO_PUSH route remains UOA_TO_PUSH in R6 of [regressions.spec.ts](regressions.spec.ts). This covers the adapter boundary; the delayed Cosmos scenario was not exercised live.

**Required change:** make known AGW execution context authoritative for the route and destination when reconstructing a supported outbound. Test delayed/incomplete Cosmos data through the real response-builder/wait boundary, not only response objects without an existing route.

### R7 Medium priority Partial-create recovery reports unknown state as absent

**Source:** [create.ts](../../../packages/core/src/lib/agentic/management/create.ts#L173).

Recovery starts with `walletDeployed = false` and an empty granted-ID list, then suppresses RPC errors. If deployment committed but the recovery getCode/read fails, CREATE_PARTIAL reports `walletDeployed: false` with the hint “No wallet was deployed.” That can cause an unsafe retry and contradicts the stated exact partial-commit reporting.

**Reproduced:** simulate a confirmed deployment followed by a grant failure, then make recovery getCode unavailable. R7 returns CREATE_PARTIAL with walletDeployed=false. See [regression](regressions.spec.ts) and [output](regressions.log).

**Required change:** represent unknown recovery state explicitly, preserve confirmed and pending hashes, and require receipt/state reconciliation before a retry. Derive committed grants from this operation's receipts rather than treating a later active-rule list as its exact outcome. Also preserve the known transaction hash when post-send receipt retrieval fails, instead of returning an unannotated transport error.

## Verification reproduced

| Check | Reviewer result |
| --- | --- |
| Full existing unit config | 1,883 passed, 12 skipped; 110 passed suites and 1 skipped |
| Existing local contract harness | 32 passed across 3 suites |
| Library type check | Passed |
| Spec/E2E type check | Passed |
| Core build, cache bypassed | Passed |
| Core lint, cache bypassed | 7 errors in files unchanged from the planning base; not a clean lint run |
| E2E agw manifest | 21 scenarios / 7 files / 21 distinct selected tests; consistent |
| E2E all manifest | 76 scenarios / 40 files / 81 selected tests; unchanged |
| New reviewer regressions | 7 failing SDK/helper-boundary cases and 2 failing real-contract race cases; failures reproduce the findings above |
| Live E2E | Not run |

Commands and artifact checksums are in [evidence.json](evidence.json). Existing suite results support the implementation's covered behavior; they do not invalidate missing-case failures. Review tests deliberately assert the desired safety/behavior and fail on this revision. They are separate from production test discovery, and may need API-aware adaptation when fixes change the representation rather than preserving it.

## Notes on the highlighted design choices

- **Web2 aliases:** the new public alias value follows the saved spec. The old literal is accepted as input and wire identity remains web2:https. This does not preserve every caller's literal equality comparison against returned values. Document that observable migration and obtain the planned public review; it is not counted as a newly discovered algorithmic defect here.
- **Batched-write checkpoints:** extra OWNER_ACTION ticks follow the contract's actual execute semantics. Keep them documented and covered; do not change contracts simply to make batched and direct counts equal.
- **Error export/cause:** preserving the underlying error and exporting the base type is useful and compatible with the intended error hierarchy.
- **Source/deployment claims:** say “no compatible deployment has been verified or registered.” Empty registry and missing manifest are evidence of unavailable support, not proof that no deployment exists anywhere.
- **Active-only list:** A06 remains unresolved. The status matrix acknowledges active-only list behavior, but the public target still says every rule. Keep that restriction clearly provisional and prevent a release from advertising complete historical reads.
- **Live E2E assertions:** the positive outbound checks a shared counter increasing and the SDK-computed CEA metadata. That is not yet independent proof of the actual executing CEA. Strengthen destination caller/event correlation, and harden deployment verification with exact artifacts/capabilities before enabling/funding a live run. Manifest title verification does not exercise those checks.

## Recommended next implementation pass

Fix R1 and R4 first, then R2/R3, then the decoder, replay and recovery reporting. Move these regressions into the appropriate normal suites after fixes. Preserve the existing 1,883/32 passing coverage and rerun relevant tests plus the new cases. Continue tracking product/ABI/deployment dependencies separately; they do not explain the reproducible SDK bugs in this report.
