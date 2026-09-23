# Universal Read — Pending Items

As of 2026-09-23

The SDK release unblocks the docs merge; the contracts/node asks are independent of both.

## SDK (@pushchain/core)

- [ ] Open the PR from `feature/readstate-docs-parity` to `main`, review, and release the minor version with the changesets (`read-state-docs-parity.md`, `read-state-solana-account.md`).
- [ ] After core-contracts merges `feat-read-state`: update the pinned-commit comment in `constants/read-state.ts` (currently `f8d1a0c`).

## Website (push-chain-website PR #1244)

- [ ] Merge `docs/universal-read` only after the SDK release. The docs describe features that exist only on the SDK branch: `outcome`, `idl` without `accountName`, any-mutability calls, lookup events, `requestIdUint`.
- [ ] After core-contracts merges `feat-read-state`: change the Contract Helpers links from `blob/feat-read-state/...` to the merged path.

## Contracts / node

| # | Ask | Owner | Why |
| --- | --- | --- | --- |
| 1 | Add terminal statuses `CALLBACK_FAILED` and `SOURCE_ERROR` to `RequestStatus` in `ReadTypes.sol` and the node's `UniversalReadStatus` | Contracts + node | Today `FULFILLED` also covers a reverted callback and a source error. The SDK derives `outcome` meanwhile and will map 1:1 onto the new statuses. |
| 2 | Decide the protocol read fee | Contracts + node | `estimateFee` returns 0 on every Donut source, so contract-built requests only fail by an underfunded callback budget. The docs need the final fee model. |
