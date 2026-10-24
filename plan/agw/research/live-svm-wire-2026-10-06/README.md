# Live AGW Solana wire acceptance

October 6, 2026. Internal SVM backend against verified Donut v4 contracts and Solana devnet. Public Solana Rule inputs/capability are still gated; no native/EVM behavior, public method, default, selector option or export changed.

## Outcome

| Work | Result |
| --- | --- |
| Read-only network/program preflight | Pass: Donut wiring/URP 3.1.0, devnet genesis, executable gateway/counter programs, ProgramData fingerprints, unpaused gateway Config and decoded counter |
| Positive internal outbound | Pass: actual Solana counter CPI plus System transfer from the AGW-derived CEA to the pinned owned recipient |
| SDK preflight refusals | Pass: substituted account / excessive instruction amount fail without advancing the agent nonce |
| Deployed policy refusals | Pass: read-only eth_call bypasses SDK validation and obtains SvmAccountPinMismatch and SvmDataCeilingExceeded, wrapped/truncated by SmartSession |
| Receipt/replay | Pass: wallet from, agent origin, SVM route, same external signature on replay and wait |
| Destination-error acceptance | Initial 600-second wait timed out; the same outbound later became REVERTED and read-only SDK replay returned failed, preserving Push status 1 |
| Concrete public API proposals | [Prepared for H4.4/H4.5/H6](../../public-api-proposals.md); no proposed public type/option enabled |

The initial funded suite result is **2 passed, 1 failed**: its strict terminal-failure assertion received timeout at ten minutes. The platform subsequently published REVERTED for that exact outbound, and read-only replay confirmed failed without another funded submission. The failed assertion remains strict; its future bounded terminalization window is extended to twenty minutes. A full second funded run is not claimed. [Operational timing follow-up](platform-followup.md). Public SVM E2E coverage still requires the agreed public adapters.

The follow-up **read-only E2E group passes 3/3** against these recorded transactions: success/identity/signature, terminal rejection/charged spend and deployed policy refusals. It performs no signing or funding. [Jest result](logs/replay.log).

## Actual delivery

- Push transaction: [0x50a96ff8…ee73b8](https://donut.push.network/tx/0x50a96ff863722ced3464e3e8e5e451621903396c9bc83fcc010756dc1aee73b8), block 23949837.
- Solana transaction: [kGUaPUfA…PXKgK](https://explorer.solana.com/tx/kGUaPUfASg9Poo93aMsztHJjUk27MKuRJBfDZK1WP3FFSaXSYcoPcxjUMFyDxaK6aU6mQkZeowSu3MtvK5PXKgK?cluster=devnet).
- Wallet: 0x4612ad240cd66A77b921693BbbB356d1B8219b2c.
- CEA: Fuas2d6gmyPEpKgvBEHGhNgu99Nx8xVWmmf6cVFp4feY, derived from this wallet's 20 bytes under the configured gateway.
- Rules ID: 0x0ed59a0b2764cf395b53a7a7d1b58e2ae3fb99b818be5392f3fdbc7eb4f645d0.
- Destination program: 8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx; counter PDA 6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg.
- Actual instruction: receive_sol(10000), with counter, pinned owned recipient, wallet CEA and System program accounts.

The parsed transaction independently shows the counter program's inner instruction with the exact discriminator/amount and the wallet CEA account, and a System transfer of **10,000 lamports** from that CEA to the pinned recipient. The shared counter increased by at least this amount. Attribution relies on this transaction's CPI/transfer, not only a global counter change. Push-side policy spent increased; the agent call did not tick checkpoints. Replay resolved the same Solana signature.

[Public live evidence](live-evidence.json) includes setup, receipt, parsed destination transaction, replay and initial timeout records. [Read-only replay](readonly-replay.json) separately verifies the wallet from, actual agent CAIP-10 origin, successful signature and later terminal failure. These contain public addresses/signatures and wire terms only; signer keys are not recorded.

## Fixture and funding boundaries

Preflight recorded Donut block 23949601 and Solana slot 508014048. The gateway is CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS. The local sibling counter source declares a different program ID, so it was not used as proof of deployed binary equivalence. We fingerprinted live ProgramData and verified actual instruction behavior against the selected SDK IDL.

Setup creates a fresh owner-controlled AGW and a fresh native agent. It checks cluster/program/configuration and funding prerequisites before setup funding. Agent funding is at most 0.5 PC; wallet receives 41 PC for two outbounds capped at 20 PC each plus reserve; exactly 20,000 pSOL base units are funded/approved. No origin-chain deposit or Solana signing is needed; the existing Solana key is used internally only to identify the owned recipient. Each source send uses the separate owner-established allowance. No agent approval is inserted.

Two source outbounds were submitted: positive and intentional destination rejection. The first live attempt failed in the new test's module bootstrap before any funding; its log is retained. The corrected attempt funded one fixture and submitted those two outbounds. Subsequent policy probes, rejection simulation, spend checks and replay were read-only; the rejected transaction was not rebroadcast. Unused PC remains in the owner-controlled wallet. The fresh agent key is not retained in the committed evidence.

## Negative evidence and limitation

The intended failure calls decrement(1) using the wallet CEA against a counter owned by a different authority. Solana read-only simulation independently returns custom error 6002/Unauthorized, with the actual counter authority and wallet CEA in its logs. It does not send a transaction or charge the simulated fee. [Simulation](destination-rejection-simulation.json).

The actual Push outbound [0x51e2227e…410fc](https://donut.push.network/tx/0x51e2227e833e8090844f151c2d5d959225d3ec24828bf11a1c6467e2a74410fc), block 23949885, succeeded. The first captured node state was PENDING without a hash/error, and the SDK's ten-minute wait accurately returned timeout. The [later record](failure-observation-final.json) is REVERTED (3), observed success=false and error "tx not executed on destination chain", with no Solana hash. Read-only SDK replay accurately returns failed; a missing destination hash is legitimate for a pre-broadcast rejection.

The later record reports successful asset/gas refund executions at block 23950149. At block 23950160 the rule's pSOL spent is still 20,000. [Final accounting](terminal-accounting.json), block 23950641, independently checks returned wallet balance=10,000, allowance=0 and spent=20,000. Returning funds does not restore the rule budget: the separately documented creditRevert platform dependency remains.

Direct deployed-URP probes at block 23949837 independently refuse account and instruction-data mutations. [Results](live-policy-probes.json). These were added to the final reusable E2E source after the funded run and exercised separately against its pinned historical state; no second funded run is claimed.

## Code and validation

- New opt-in agw-svm-wire group: 3 funded scenarios in one spec; agw-svm-replay: 3 read-only recorded-transaction scenarios in another spec. Default all remains 76 scenarios/81 tests; public AGW group remains 25 scenarios.
- Fixture preflight records account owners, discriminators, ProgramData hashes/upgrade slots, cluster genesis and Config paused state. Six unit cases cover substituted/missing/paused/wrong-cluster prerequisites.
- A shared eth_call probe verifies actual policy refusals independently of the SDK validator.
- Full units: **1,981 passed**, 12 existing skips; library/spec typechecks and core build pass. Changed-file lint has 0 errors and 21 non-null assertion warnings. No production library code changed; the earlier 75 local-contract cases were not rerun for this fixture-only change.
- Existing public replay adaptation is applied to the internal raw signer response, using the gateway wire call as the logical summary. That enables normal outbound wait without inventing public Solana instruction-display fields.

[Logs](logs/): live-initial.log (unfunded bootstrap error), live-bootstrap-fixed.log (initial 2/1 funded result), replay.log (read-only acceptance), unit.log, lint.log. The funded runner redacts credential environment values before saving/printing logs. Its ten-minute timeout is retained as evidence; no timeout was relabeled failed or counted as a passing funded run.

## Reproduction

Read-only, no keys loaded:

```sh
cd packages/core
node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/agw-svm-preflight.ts ../../plan/agw/research/live-svm-wire-2026-10-06/preflight.json
node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/run.ts --verify --group agw-svm-wire
node ../../node_modules/ts-node/dist/bin.js --transpile-only __e2e__/ci/run.ts --group agw-svm-replay
```

Funded opt-in run from the repository root, using the existing authorized testnet environment internally:

```sh
node plan/agw/research/live-svm-wire-2026-10-06/run-redacted.cjs live.log
```

The replay group never signs or funds and can check these recorded hashes independently. Repeating the funded suite creates/funds a fresh fixture. Public Solana authoring/dispatch acceptance remains a later task after H4.4; this wire suite is an independent contract/node/destination proof.
