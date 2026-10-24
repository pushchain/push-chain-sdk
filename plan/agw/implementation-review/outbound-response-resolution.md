# Outbound response consistency and wait regression resolution

This change resolves F1 from the [follow-up review](followup-9e16b23/review.md) and promotes R6 wait-path coverage into the regular SDK unit suite. The earlier review evidence remains unchanged and identifies the revisions it tested.

## Response convention

Live sends and tracked AGW outbounds now share one canonical summary: `to`, `data` and `value` describe the first actual destination call. `agentic.destinationCalls` contains the complete ordered destination call list. `from` remains the AGW, `origin` remains the signer, and `agentic.rawTo/rawData` retain the wrapped Push call.

An explicit token transfer therefore keeps the token target and transfer calldata. A funds-only ERC20 send has the same canonical representation: the actual generated token transfer, including its recipient and amount in calldata. A transfer followed by an app call reports the transfer first and preserves both calls in order. Arrays are not reduced to a guessed last or primary action. Native transfers retain their encoded destination value.

Identical wire calls cannot reveal whether they came from explicit calldata or funds convenience inputs. The adapter no longer attempts that inference. Unrecognized historical destination payloads retain the actual gateway call rather than inventing an empty destination call.

This is an additive response-metadata field and a correction to the unreleased AGW response summary. Receipts continue using the standard core shape; the full call list is attached to the response.

## Regular regression coverage

[Outbound response tests](../../../packages/core/src/lib/agentic/__tests__/outbound-response.spec.ts) add nine cases:

- Explicit ERC20 call, funds-only ERC20 transfer, transfer plus app call, explicit call array and native-value transfer: verify canonical fields and complete calls match on live send and replay.
- Owner and agent replay, with successful and reverted Push receipts: use the real response builder and wait closure. An early Push-only route becomes outbound; successful roots poll once; reverted roots never poll. Init and per-call terminal hooks each fire once.

RPC/account lookup and the destination poller are mocked. This exercises the real SDK response/wait branch, not live Cosmos or TSS settlement. The separate historical F1/R6 reviewer tests also pass against the fix.

## Validation

- Focused response/send suites: 48 passed.
- Full unit suite: 1,908 passed, 12 skipped; 111 suites passed and 1 skipped.
- Local pinned-contract harness: 34 passed in 4 suites.
- Library/spec typechecks and core build: passed.
- Core lint: seven errors in unchanged files; no new errors from this change.
- No live-network transactions were sent.

Commands: standard core Jest config with --runInBand, the local AGW Jest config with AGW_LOCAL_DIR set to the prepared e704d5b build, both core tsc --noEmit configs, and the separate commands `yarn nx run core:build --skip-nx-cache` and `yarn nx run core:lint --skip-nx-cache`.

Raw-offset public types still require product agreement. Compatible deployment, live recipient/executor correlation, and the existing A01–A08 decisions remain separate gates.
