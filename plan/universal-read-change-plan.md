# Universal Read — SDK, Website & Protocol Change Plan

As of 2026-09-23

## Summary

The SDK work is done and verified live; the website PR still has about 30 gaps to fix, and the protocol has four asks. The Universal Read docs (push-chain-website PR #1244) were written ahead of `@pushchain/core` 6.0.25. We aligned the SDK where the docs described the right behaviour, applied the safe website fixes, and listed the rest below.

| Team | Status | What's needed |
| --- | --- | --- |
| SDK | Done on branch `feature/readstate-docs-parity`, not yet committed or released | Review, commit, release (minor bump) |
| Website | Partly done on `docs/universal-read` (uncommitted) | Fix the remaining gaps in the Website section; merge only after the SDK release |
| Contracts / node | Not started | Four asks in the Contracts section |
| Infra | Not started | Prune RPC receipt latency |

**Release gate:** the docs describe features that exist only on the SDK branch (`outcome`, `idl` without `accountName`, any-mutability calls, lookup events). The website PR must merge after the SDK release, not before.

## SDK (@pushchain/core)

All SDK items that can be finished in the SDK are done on `feature/readstate-docs-parity` and verified against live Donut; the branch needs review, commit and a minor release. Items 1 (registry default `0x…b2`) and 2 (Token-2022 inferred from the mint, `tokenProgram` removed) were already on `main` in 7b504a8.

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
- Live e2e: all 16 read-state specs (23 tests) passed on Donut.
- Integration: read-state + explorer specs, 35/35.
- Two new e2e specs added to the CI suite: `read-evm-any-mutability`, `smoke-read-track-lookup`.

### Still to do

- [ ] Review and commit the branch (one commit per item)
- [ ] Release the minor version and publish the changesets (`read-state-docs-parity.md`, `read-state-solana-account.md`)
- [ ] After core-contracts merges `feat-read-state`: update the pinned-commit comment in `constants/read-state.ts`

## Website (push-chain-website PR #1244)

Six website files are already fixed on `docs/universal-read` (uncommitted), and about 25 doc gaps remain, 7 of them blocking merge. Paths below are under `docs/chain/03-build/` unless they start with `static/`.

### Already applied

- Contract Helpers playgrounds (`08-Contract-Helpers.mdx`, `read-client-request-context.md`, `read-client-stored-result.md`) re-pointed to a durable read that exists on registry `0x…b2`. The old request only existed on the previous registry, so they printed `hasResult: false`.
- `99-Constants.mdx`: new Read Constants section (registry, callback, defaults, `OUTCOME`, `STATUS`, `RESULT_STATUS`).
- `static/agents/constants.json`: `READ.OUTCOME` added. `constants.json` and `contract-addresses.json` already listed `0x…b2`.
- `static/llms-full.txt` regenerated with `build.agents.preseed.mjs`.

### Fix before merge

1. **Solana `idl` rows describe instruction calls** (`04-universal-reads/_read-parameters.mdx:16-18`). With `idl`, `functionName` names the account layout and is optional (picked by discriminator); `args` are PDA seeds, allowed only when the subject is the program id; `idl` is an object, not `any[]`. Split into separate EVM and Solana rows.
2. **Registry playground wording** (`08-Contract-Helpers.mdx:596,598`). The query key is computed by the SDK and passed to `read(spec, queryKey, gas)`, not derived by the registry. `requestOrderOf` is a registry-wide counter, not a position within one query key.
3. **Budget floor for contract-built requests** (`03-Contract-Initiated…mdx:250,328`, `BalanceWatcher` example). `estimateFee` is 0 on Donut today; the node never fulfils a request whose budget is below `callbackGasLimit × baseFee`. Document `msg.value ≥ estimateFee + callbackGasLimit × baseFee`, with headroom.
4. **Events that are never emitted:** remove `READ-TX-105-03`, `106-01`, `199-99` (the node exposes no confirmation count, and VOTING → FULFILLED is one step). `errors.json` `read_web2_no_quorum` should detect via "stays PENDING/VOTING, then `199-02` EXPIRED".
5. **`199-01` / `199-02` descriptions** must follow `outcome`: `199-01` only on success; a failed FULFILLED read ends on `199-02` named by its outcome.
6. **`progress.level`** (`01-Read-Universal-State.mdx:93`) must include `WARNING`.
7. **Examples:** add `as const` to the contract-call ABI (`universal-read-contract-call.md`), and guard `done.value` with `outcome === SUCCESS` in the agent examples and the Track playground (`formatEther(undefined)` throws).

### Document what the SDK now does

- `response.outcome` as the success signal everywhere the docs say "`value` is the success signal": Track page, `schemas/universal-read-response.json`, `errors.json`, `recovery-playbook.md`, `workflows/universal-read.md`, `sdk-capabilities.json`, `capabilities.json`, frontend and backend skills. `UNKNOWN` needs its own recovery: refresh later, do not resubmit.
- Lookup events `104-03/04/05`, the 30 s lookup, and `ReadNotFoundError` (also thrown by `read()` and `waitForCompletion: false` after fees are paid).
- Error classes and codes: `InvalidReadQueryError`, `InvalidReadSpecError` (with `violations`), `ReadHeightUnavailableError`, `UnsupportedReadDestinationError`, `ReadDecodeError`, `INSUFFICIENT_READ_BALANCE`, `READ_REQUEST_TX_FAILED` (with `transactionHashes`), `READ_NOT_FOUND`, and `ReadTimeoutError.lastStatus`.
- Any-mutability contract calls, the Solana PDA form, `decoded.accountName`, Token-2022 auto-detection.
- `wait()` options are flat: `{ timeoutMs, pollingIntervalMs, resultShape }`.
- Batches are atomic only with an EIP-7702 signer; otherwise one tx per read, and `transactionHashes` is set.
- A prepared read goes stale after about 6.7 minutes (expiry is fixed at prepare time).
- `toCallData()` for the "pass the spec to your entrypoint" flow; the current link points to a page that doesn't cover it.
- `READ_REQUEST_MISMATCH` arrives after the tx is mined and paid; the entrypoint must forward the spec and gas unchanged.

### Unclear, clarify

- `maxFee` below the estimate does not lower the payment; it throws `EXCESSIVE_FEE`.
- Block pinning: the Contract-Initiated example pins at the oracle height, Contract Helpers subtracts `minConfirmations`. Use `height - 1`.
- `fees.burned` / `refunded` may stay `undefined` when receipts or block results are unavailable.
- Refund wording: SDK-prepared specs refund to the caller's Push account; only a contract-built spec with a zero `revertRecipient` refunds to the contract.
- Troubleshooting is missing `CallbackGasLimitExceeded`, `ZeroCallbackGasLimit`, `DomainBlocked`, `EmptyQuery`.

### Stale once the SDK ships

- Delete "This takes 15 to 20 seconds" and the custom "Looking up…" log lines in the Track playground, `universal-read-resume.md` and `read-client-stored-result.md`. The SDK emits `104-03` itself and returns in about 1 s.

Already correct against the new SDK, keep as is: the explorer host, `requestIdUint`, the `gasLimit` default, and the `105-04` / `102-04` rows.

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

- Commit order: SDK first (one commit per item), then the website as a single commit.
- Who on the docs team owns the remaining website fixes, and whether we apply them directly on `docs/universal-read`.
