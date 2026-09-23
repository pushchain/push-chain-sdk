# Universal Read — SDK, Website & Protocol Change Plan

As of 2026-09-23

## Summary

The SDK and website work are done and pushed; what remains is the SDK release, then the docs merge, plus four protocol asks and one infra ask. The Universal Read docs (push-chain-website PR #1244) were written ahead of `@pushchain/core` 6.0.25. We aligned the SDK where the docs described the right behaviour and fixed every docs gap against the new SDK.

| Team | Status | What's needed |
| --- | --- | --- |
| SDK | Done, pushed on `feature/readstate-docs-parity` (6 commits, last `5754fc0`) | Open a PR to `main`, review, release (minor bump) |
| Website | Done, pushed to PR #1244 on `docs/universal-read` (last `004e7424d18`) | Merge after the SDK release |
| Contracts / node | Not started | Four asks in the Contracts section |
| Infra | Not started | Prune RPC receipt latency |

**Release gate:** the docs describe features that exist only on the SDK branch (`outcome`, `idl` without `accountName`, any-mutability calls, lookup events, `requestIdUint`). The website PR must merge after the SDK release, not before.

## SDK (@pushchain/core)

All SDK items that can be finished in the SDK are done, verified against live Donut, and pushed on `feature/readstate-docs-parity`; the branch needs a PR, review and a minor release. Items 1 (registry default `0x…b2`) and 2 (Token-2022 inferred from the mint, `tokenProgram` removed) were already on `main` in 7b504a8.

### New API (from the Universal Read change list)

| Change | What it does | Verified live |
| --- | --- | --- |
| `options.idl` replaces `idl` + `accountName` | Account layout picked by its 8-byte discriminator. Optional `functionName` names the layout (snake, camel or Pascal case) and types `value`. With the program id as subject, `functionName` + `args` derive the PDA from the seeds the IDL declares. Passing `accountName` throws with a hint. | Solana devnet counter: the account read directly and the PDA derived from the program id decode identically |
| Any ABI mutability on EVM reads | Types loosened and the runtime view/pure check removed. Validators run the call as `eth_call` at the pinned block. | Sepolia: QuoterV2 (nonpayable) and Multicall3.aggregate (payable) match Sepolia at the pinned block |
| `response.outcome` / `PushChain.CONSTANTS.READ.OUTCOME` | One success signal: `SUCCESS`, `SOURCE_ERROR`, `CALLBACK_FAILED`, `DECODE_FAILED`, `EXPIRED`, `FAILED`, `ABORTED`, `PENDING`, `UNKNOWN` | All read e2e specs |
| Lookup events `READ-TX-104-03/04/05` | Looking Up Request, Request Found, Request Not Found (at the 30 s lookup timeout) | track-lookup e2e |
| Faster `trackRead` | 19.4 s → about 1 s on an old terminal read. Receipts now fetched in parallel, and the prune RPC and archive are raced. | track-lookup e2e (1.3 s) |

### Fixes that align the SDK with the docs

| Change | Why |
| --- | --- |
| `explorerUrl` → `https://donut.push.network` | `explorer.donut.push.org` does not resolve; it also fed Donut's viem `blockExplorers` for wallets |
| `response.requestIdUint: bigint` | Contracts key results by `uint256`; the docs' `results(result.requestIdUint)` examples now work |
| `callback.gasLimit` optional for custom targets (default `500_000n`) | Matches the docs table; unused budget is refunded |
| `value` typed `unknown` for non-const ABIs | Was typed as an array, but a single output returns bare |
| `READ-TX-199-01` only on `outcome === SUCCESS` | A fulfilled read that failed now ends on `199-02` with its outcome name |
| Refund events `106-05/06` also fire on EXPIRED | `errors.json` tells agents to detect a rejected refund via `106-06` |
| `105-04` Approaching Expiry during `wait()` | Fires once at 30 or fewer Push blocks left |
| `102-04` Preflight Stale in `executeReads` | Fires for a read prepared more than 60 s earlier |
| `getBlockResultEvents` archive fallback | Refunds on expired reads older than the prune window came back `undefined` |

### Verification

- Unit: 1740 passed, type-check and build clean.
- Live e2e: all 16 read-state specs (23 tests) and the docs-example playgrounds (6 tests) passed on Donut.
- Integration: read-state + explorer specs, 35/35.
- New e2e specs in the CI suite: `read-evm-any-mutability`, `smoke-read-track-lookup`; docs-example scenarios re-pointed to the restructured docs.

### Commits

| Commit | Change |
| --- | --- |
| `4e4d9e5` | Race prune and archive for Push receipts; archive fallback for block results |
| `dc5f81b` | Read-state API aligned with the docs (idl/PDA, any mutability, outcome, events, fixes above) |
| `a7a65f8` | Plan docs: this plan, spec, tutorial, blockers, registry notes |
| `2c8acb3` | CHANGELOG: unreleased section with breaking changes |
| `5754fc0` | Docs-example harness mirrors the restructured pages (`04-universal-reads/`); drift check gains `--write` |

### Still to do

- [x] Commit and push the branch
- [x] CHANGELOG unreleased section (`packages/core/CHANGELOG.md`)
- [ ] Open the PR to `main`, review, release the minor version and publish the changesets (`read-state-docs-parity.md`, `read-state-solana-account.md`)
- [ ] After core-contracts merges `feat-read-state`: update the pinned-commit comment in `constants/read-state.ts`

## Website (push-chain-website PR #1244)

Every docs gap found against the SDK is fixed and pushed to `docs/universal-read`; the PR only waits for the SDK release. Paths are under `docs/chain/03-build/` unless they start with `static/`.

| Commit | Change |
| --- | --- |
| `64eac3dfa9f` | Contract Helpers playgrounds re-pointed to a durable read on registry `0x…b2` (the old request only existed on the previous registry, so they printed `hasResult: false`); new Read Constants section in `99-Constants.mdx`; `READ.OUTCOME` in `static/agents/constants.json` |
| `004e7424d18` | Docs aligned with the SDK across 33 files (below) |

### What `004e7424d18` fixed

- [x] Solana `idl` / `functionName` / `args` rows describe account layouts and PDA seeds; EVM contract calls accept any mutability (`_read-parameters.mdx`).
- [x] Registry playground: the query key is computed by the SDK; `requestOrderOf` is a registry-wide sequence (`08-Contract-Helpers.mdx`).
- [x] Budget floor for contract-built requests: `msg.value ≥ estimateFee + callbackGasLimit × block.basefee`, with headroom; `BalanceWatcher` enforces it (`03-Contract-Initiated…mdx`).
- [x] Never-emitted events `105-03`, `106-01`, `199-99` removed; `104-03/04/05` added; `199-01` only on `SUCCESS`, `199-02` named by outcome; `106-05/06` on expiry; `105-04` and `102-04` triggers; `progress.level` includes `WARNING`.
- [x] `outcome` is the success signal across the read pages, response schema, `errors.json`, recovery playbook, workflows, capabilities and skills; every playground guards on it; `UNKNOWN` recovery documented.
- [x] Errors: `ReadNotFoundError`, `InvalidReadQueryError`, `InvalidReadSpecError` (violations), `ReadHeightUnavailableError`, `UnsupportedReadDestinationError`, decode failures, `ReadStateError` codes, `ReadTimeoutError` fields.
- [x] Contract-initiated reads: refund recipient on the SDK path, pinning at height − `minConfirmations`, `toCallData`, `READ_REQUEST_MISMATCH` timing, missing contract reverts in troubleshooting.
- [x] Batches: atomic vs sequential execution, prepared-read staleness; `maxFee`, `callback.gasLimit` default, flat `wait()` options, Web2 limits, `READ.ERROR_CODE` constants.
- [x] Stale lookup workarounds ("15 to 20 seconds", custom "Looking up…" lines) removed.
- [x] Agent examples and llms files regenerated; example-syntax, link and JSON checks pass; all changed MDX compiles.

Not changed, by design: `as const` in the playground ABIs. Playgrounds run as plain JavaScript in the browser, where `as const` is a syntax error; the typed snippet above them has it.

## Contracts / node (protocol)

Four asks for the core-contracts and node teams; none block the SDK release, but #1 and #2 block the docs links and the cleanest success model.

| # | Ask | Owner | Why |
| --- | --- | --- | --- |
| 1 | Add terminal statuses `CALLBACK_FAILED` and `SOURCE_ERROR` to `RequestStatus` in `ReadTypes.sol` and the node's `UniversalReadStatus` | Contracts + node | Today `FULFILLED` also covers a reverted callback and a source error. The SDK derives `outcome` meanwhile and will map 1:1 onto the new statuses. |
| 2 | Merge or tag `feat-read-state` in push-chain-core-contracts | Contracts | Docs link to `blob/feat-read-state/...`; the SDK pins `f8d1a0c` in a comment. Both move to the merged commit after. |
| 3 | Publish the `UniversalReadRegistry` source | Contracts | The deployed `0x…b2` source isn't in any repo we have; `requestOrderOf` / `readerOf` semantics were confirmed only by live calls. |
| 4 | Decide the protocol read fee | Contracts + node | `estimateFee` returns 0 on every Donut source, so contract-built requests only fail by an underfunded callback budget. The docs need the final fee model. |

## Infra

The public Donut RPCs slow down or lose old history; the SDK now works around both, but other clients still pay the cost.

| Issue | Measured | SDK workaround | Ask |
| --- | --- | --- | --- |
| Prune EVM RPC takes about 8.3 s to answer any receipt it doesn't have (`-32002`), even for a random hash | curl, twice, on 2026-09-23; the archive answers the same receipt in about 0.4 s | Prune and archive are raced in `getTransactionReceiptWithArchiveFallback` | Make a receipt miss return fast on `evm.donut.rpc.push.org` |
| Prune Tendermint RPC dropped block results below height 23394068 (HTTP 500, "height N is not available") | curl on 2026-09-23 | `getBlockResultEvents` falls back to the archive | None needed; note for other consumers |

## Reference

### Durable registry read (for the Contract Helpers playgrounds)

| Field | Value |
| --- | --- |
| Query | USDC `totalSupply()` on Ethereum Sepolia, target `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Registry | `0x00000000000000000000000000000000000000b2` |
| requestId | `0x9dd18b4139fe335e1848022503aabb699f319be395df5109c4e48754ea3d5bbe` |
| Push tx | `0xe56ca590ba08fd2d09d04e478b16933f215f0c64e435c0e8be0b9d85116fe369` |
| Sepolia pin | block 11763025 |
| Stored at Push block | 23493111 |
| Result | 10742404454944514730 (10,742,404,454,944.514730 USDC) |
| Verified | `hasResult` is true on `0x…b2`; stored bytes match the read; `outcome` is `SUCCESS` |

The previous docs request `0x9d276d87…67f3` lives only on the old registry `0x91b0…28C8`.

### Open decisions

- Who opens and reviews the SDK PR to `main`, and when the minor release goes out.
- Owners and dates for the four contracts/node asks and the infra ask.
