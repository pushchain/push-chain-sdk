# Read-state coverage audit — 2026-09-10

This audits the custom-contract API and includes the uncommitted recovery fixes.
Coverage percentages apply to `src/lib/read-state/**/*.ts`, excluding test and
integration directories; they do not measure the entire SDK or validator code.

Verified: 1,145 scoped unit tests, 24 read-only integrations, 13 read-group live
scenarios plus the new raw-Solana scenario (14 total), lib/spec TypeScript checks,
and CI manifest validation. ESLint reports no errors (test non-null assertions and
existing warnings remain). Module coverage: 97.2% lines, 95.44% statements, 85.47%
branches. These metrics are not a claim of exhaustive behavioral coverage.

## Coverage map

| Area | Deterministic coverage | Live coverage |
|---|---|---|
| Preparation and validation | Query grammar, bounds, blocked/unknown destinations, fee sizing, destination/preflight mismatch, refund defaults | EVM/SVM/Web2 preflight; valid simulation and decoded invalid-height revert |
| Public API | Entrypoint encoding/mapping, empty batches, read-only guards, option propagation | One-shot reads, ERC-20 shorthand, refresh retaining decoder, read-only preparation and execution refusal |
| Wire formats | Golden EVM/SVM/Web2 envelopes, real protobuf fixtures, unknown fields and unsafe uint64 rejection | Node fixture decoding; requests served by validators |
| Decoding | Balances/storage/raw, overload selection, array outputs, signed/dynamic Web2 values, mismatched shapes | Native balance, ERC-20 balance, contract call, storage, Web2 values, raw Solana System Program bytes |
| Batch identity | Reordered records, identical inputs, callback target/gas/spec mismatch, missing/extra logs | Mixed queries, duplicate inputs, independent success/EVM-revert/Web2-not-found results |
| Execution recovery | Actual native execution layers: send, decline, nonce refresh, receipt, revert, indexing, response-construction failures; confirmed vs unconfirmed hashes | Sequential partial batch failure followed by successful recovery; EOA and UEA batches |
| Lifecycle | Every terminal status, bounded polling/stalled RPC, missing snapshots, retry without resetting deadline, decoder retention | Fulfilment, callback reversion, client timeout followed by refresh/resume and expiry |
| Refunds | EndBlock attempt ordering/deduplication, unavailable blocks, malformed/foreign logs, rejected refunds, expiry event alone is insufficient | Fulfilment accounting and accepting-recipient expiry refund |
| Progress | Nested bigint serialization, reference deduplication, init/per-call hooks, route suppression | Shared hook deduplication, fulfilment/error/expiry events |
| EndBlock transport | Finalize and legacy event formats, transient HTTP retry, JSON-RPC pruning errors | Historical expiry fixture and fresh expiry |

## Additions in this audit

- 13 unit cases: EndBlock transport, dynamic/signed decoding, codec forward compatibility
  and precision, empty/duplicate batches, wrong callback target/gas.
- Two integration cases: `executeReads` read-only refusal and deployed custom-error simulation.
- Three live scenarios: ERC-20 shorthand/refresh/hook deduplication, mixed consensus
  outcomes with duplicate requests, and raw Solana System Program account bytes.
  Existing expiry scenario also verifies timeout recovery.
- The CI read group contains 14 scenarios, with independent payer funding declarations.

## Remaining gaps and prerequisites

- Positive SPL Token and Token-2022 balances need stable devnet mint/account fixtures.
  ATA derivation is unit-tested; the live Solana scenario covers lamports, not these tokens.
- Web2 POST and numeric scaling need a controlled deterministic HTTP fixture service.
  Current live tests use GET; signed and dynamic return decoding is covered offline.
- Actual expiry retries, ABORTED/admin recovery, and rejected-refund recipients need a
  controlled node/contract harness. The SDK branches are tested with recorded/synthetic
  records, without inducing those failures on the shared testnet.
- Atomic batch rollback and app entrypoints that emit missing/extra requests need dedicated
  observable receiver fixtures. Success batching is live-tested; mismatch handling is unit-tested.
- Default registry, CEA ingestion, and the Go execution of shared golden vectors remain
  external work. Tests here cannot establish support for those unimplemented paths.
- RPC stalls and partial receipt visibility are simulated deterministically. Healthy live
  RPC checks are not evidence that all infrastructure failure modes have been exercised.

The suite intentionally does not claim exhaustive or 100% end-to-end coverage.
