# Selected SDK hardening — October 6, 2026

Shoaib approved items 2, 3, 4 and 5 only. Hosted CI execution and release preparation were excluded and were not performed. This batch changes tests and developer verification scripts, not production SDK API/transaction behavior.

## Completed items

| Item | Evidence |
| --- | --- |
| 2 Differential SVM validation | A reproducible seeded corpus (seed 23063) compares SDK validation directly with actual v4 URP initialization and authorization. 107 grant-shape cases (38 accepted/69 rejected), including uint64/uint256 cap boundaries, and 88 payload cases (6 accepted/82 rejected), including truncation/trailing bytes, pin substitution, aliasing, account counts and data floors. Zero accept/reject mismatches. Successful eth_call probes leave token balances unchanged. |
| 3 Races/faults | Five new actual-contract cases cover allowance revocation, token balance withdrawal and rule revocation after preflight, plus RPC failure during reads and receipt loss after a mined grant. Failures are checked by expected code/revert selector, agent nonce, spend counters and checkpoints. Receipt loss preserves the submitted hash and does not retry. Existing replacement/spend/initialization/nonce races remain. |
| 4 Broader API audit | Comparison now covers all root exports and their public declared members, static/instance PushChain members, universal transaction/tracking methods, utility groups, constants and optional/readonly markers. Transparent aliases, barrel forwarding, const-assertion readonly state, property/union ordering and compiler-generated symbol IDs are canonicalized. Source public declarations match built declarations. |
| 5 Runtime matrix | Node 20.19.2 and 24.14.0 pass the full unit run and the unfunded verification command: targeted units, lib/spec/local types, guide, local contracts, build, CJS/ESM consumer imports, built declaration examples, npm dry-run and API comparison. These are local macOS arm64 results, not a hosted Linux CI result. |

## Results

Both runtime entries: 1,975 unit passes (12 existing skips, 115 passed suites/1 skipped), 75 actual-contract passes in 10 suites, no open-handle warning or forceExit. Differential cases are probes inside two Jest tests; they are not reported as 195 additional Jest passes. Changed-file lint: 0 errors, 11 conventional non-null assertion warnings in tests.

[Runtime versions/results](runtime-results.json). Logs are in [node20/](node20/) and [node24/](node24/). The runtime runner takes explicit binary paths and copies per-runtime results before the next run; it dispatches no GitHub jobs, loads no .env keys, funds no live E2Es and publishes nothing.

## API findings

[Full comparison](api-comparison.json) against session baseline b1597b9: no added/removed root exports, no initialize signature change, no universal transaction/tracking method changes and no instance-member changes. Root-visible type differences are AGENTIC_ERROR_CODE, its dependent AgenticErrorCode/AgenticError code types, AllowedCall.beneficiaryOffset and AgenticNetworkConstants.ENVELOPE_VERSION. These arose in the earlier v4 migration. Native defaults, raw-offset authoring and rule selection remain externally unresolved. This batch adds no public SDK field/method.

## Actual live E2E status

**Actual funded runs have happened.** [The registered scenario matrix](../live-acceptance-2026-10-06/scenario-results.json) records 25 distinct passing AGW scenarios across selected sequential Donut runs, including native/UEA identities, grants/update/revoke/checkpoints, native batching/rollback, allowance, progress/replay and Sepolia call-only/positive-amount success and destination failure. It is not a claim that one complete group invocation passed without any initial failures.

The positive outbound independently checked wallet PRC20 debit, gateway allowance reduction and burn events, successful Sepolia receipt, CEA balance increase and the CEA-emitted execution event with AGW originCaller and intended target/data. [Previous live evidence](../live-acceptance-2026-10-06/README.md).

This batch performs a **read-only recheck**, not a new funded run: the Push and Sepolia receipts for both positive-amount and call-only sends remain successful. [Hashes, blocks and results](live-receipt-recheck.json). No new live transaction was submitted. The 75 local cases use actual contracts on Anvil with transport/metadata/destination fixtures; they are separate from live bridge/settlement evidence. No live AGW Solana-destination E2E has run because public mapping/cluster input and enablement are pending.

## Reproduce

```sh
AGW_LOCAL_DIR="${TMPDIR:-/tmp}/push-agw-local-v4" node packages/core/scripts/check-agw-runtimes.js --node20 /path/to/node20 --node24 /path/to/node24
```

Outputs default to .agw-runtime-validation/, ignored by Git. No runtime is installed automatically. Hosted CI and release/changelog/PR preparation remain outside this approved batch.
