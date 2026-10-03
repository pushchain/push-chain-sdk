# Contract questions for Zaryab

Revised October 3, 2026 after checkpoint implementation. Local draft, not sent. AGW baseline `pushAgenticWallet_v3@e704d5b`, core `cb69e0b`. D3 is implemented in source and owner batching is already the documented design; those questions have been removed. Refresh the sources before sharing.

## Z1 Next wallet generation surface

Checkpoints are now implemented in source, including count views, per-call ticks and WithSig behavior. Which of grant ref, label storage/setLabel, envelope version and the new multi-asset/maxGasPerCall terms are planned together for the next generation? Please include agent attribution in RulesGranted if the SDK must return revoked-rule history; the engine clears that agent config on revoke. If ref is added to signed grants, confirm it is bound by the owner's signed digest.

The checkpoint implementation has chosen storage and deliberately revised the owner-door invariant; we have removed that design question. Replacement batches add five ticks. We will consume the implemented event/count semantics and separately align evaluator snapshot timing and the documented allowance blind spot.

The new section 4c also needs exact per-asset spent and replacement assertion ABIs. Its no-expected-value assertSpent returning totals is not by itself the current stale-spend race guard. Please define that guard, empty-assets call routing, zero/unlimited maxTotal behavior and whether bytes32 expectedCEA is intended for EVM terms.

## Z2 Push-side gateway allowance

Gateway PRC20 outbound pulls from the AGW with transferFrom, but the documented setup has no approve step. The universal agent rule only permits the gateway action. We propose an owner-door bounded approve(gateway, amount) during a separate funding/owner setup flow, with explicit replenishment and recovery behavior. Funding is no longer part of create in the updated SDK spec; multi-asset rules require per-token allowance handling.

Please confirm the intended allowance mechanism and add it to the flow and an integration test that actually pulls/burns tokens. Destination approvals are a separate owner operation.

## Z3 Deployment and generation plan

Please provide the next generation's factory, wallet implementation, validator, engine and policy addresses, source commits and deployment start block when available. Will engine/URP be reused, or will this be isolated from historical configs? How will accountId/version distinguish ABI generations? Is SVM destination support enabled there?

Existing clones cannot acquire the new wallet ABI. The recorded Donut factory still points to the old implementation in our probes. We will add SDK generation guards and handle historical addresses separately.

## Z4 Gateway struct intent

The available evidence shows six-field gateway main is older, while the current September branch and live Donut dispatcher use eight fields. Is any future removal of gasPrice/maxPCForGas actually planned? If not, page 1's coordinated-removal warning should be corrected. We will encode the matched deployed ABI.

## Heads-up and downstream alignment

Our dedicated agent composer must send a nonzero maxPCForGas, empty EVM recipient and AGW revertRecipient. The first authorized live test will verify positive-amount multicall settlement with this shape; an existing successful transaction hash would help. This is not a request to change URP's empty-recipient guard.

creditRevert is already documented as waiting on Push-core executor support; we will document that limitation rather than ask you to redesign it. The old Ed25519 session-validator issue is obsolete at head. Separate downstream alignment remains for marketplace expiry equality, rule binding, payment tokens and hook lifecycle.

## Current source freshness

Successful full Notion export: October 03, 2026 at 13:23 IST; 12 pages checked, pages 1 and 5 changed. AGW remains pinned to reviewed e704d5b; no new Git refresh was part of this pull. Core/gateway retain cb69e0b/bcbf7df evidence. Drafts remain unsent.
