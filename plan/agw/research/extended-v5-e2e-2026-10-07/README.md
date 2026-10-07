# Expanded v5 E2E coverage — October 7, 2026

Added the five requested scenarios. The opt-in AGW group now registers **58 scenarios across 14 files**; default `all` remains **76 scenarios / 40 files / 81 tests**. This report records validation performed before commit and push.

## Coverage added

| Scenario | Independent assertions |
| --- | --- |
| Solana-origin owner create / rename / reset | Correct UEA ownership, stored label, list visibility, default reset and two owner checkpoints |
| Rename with an active rule | Same rule ID/config/grant nonce and spend after rename; agent consumes its remaining budget; further value is rejected without signing |
| Failing owner batch after rename | SDK simulation maps `LabelTooLong`; a bounded mined transaction with the same SDK encoding reverts with no logs, preserving label and checkpoint count |
| Two assets used under one universal rule | Both ETH and USDC reach this wallet's CEA; each allowance/balance/spend changes independently; exhausted ETH does not prevent USDC; extra units are rejected by URP with nonce and counters unchanged |
| Owner funds-only SPL export | Recipient USDT ATA credit, per-transaction token delta, wallet burn, allowance consumption, owner checkpoint and response/replay identity |

Existing label tests now check isolation between two wallets and the intermediate renamed label through an EVM UEA owner, before reset. Destination receipts remain required: a successful Push leg alone cannot pass a delivery test.

## SDK defect found and fixed

The new SPL test failed **before signing** when `SOURCE_TOKEN_ADDRESS()` was decoded as a Solidity string. A read-only raw probe showed that the current SVM synthetic precompile returns a **zero word**, not a source mint string. It must not be interpreted as the mint of a non-native token.

The shared SVM metadata resolver now:

- Accepts populated string/word metadata when supplied.
- Treats a zero marker as native only for the registered gas PRC20.
- Resolves a known non-native mapping using the SDK's existing registry, matching the full origin chain, network and exact PRC20 address, as ordinary Route 2 already does.
- Rejects unknown mappings instead of guessing a mint.
- Serves quoting, authoring and rule reads consistently; decoded hexadecimal mint inputs normalize to base58 for registry lookup.

Four added regression units cover real ABI decoding, unavailable metadata, the live zero-word/registered-mint case, and hexadecimal mint authoring. The subsequent funded SPL test delivered exactly **1,000 raw USDT units** to the intended ATA and passed replay checks. No public API or permission-selection behavior changed.

## EVM destination gas finding

The existing positive EVM case initially reached Sepolia and **reverted** with a 500,000-gas transaction. Replaying its exact call with 500,000 gas failed; five million gas succeeded; `eth_estimateGas` returned **1,304,470** for fresh CEA finalization. This was not evidence of malformed SDK payloads or a gas-limit safety bypass.

Positive EVM tests and the guide now supply an explicit **2,000,000 destination-gas budget**. A later fresh-fixture run succeeded with that exact gas limit, using **1,265,746 gas**, and independently verified the wallet's CEA, caller, target, ETH credit and replay. The two-token case also passed both real deliveries.

One explicit-budget run timed out after ten minutes before the later successful run. Its timeout is retained as delivery-latency evidence; we have not established its root cause. The SDK's default is **not silently raised**. Core/gateway should revisit the default for fresh CEA deployment; the caller workaround is verified. See [failed transaction](evm-failed-destination.json), [read-only gas checks](evm-failure-followup.json), and [successful explicit budget](evm-explicit-success.json).

## Validation and execution limits

- Full unit suite: **2,014 passed / 12 skipped / 0 failed**.
- Actual v5 contract harness: **90 passed**, 12 suites, retaining the documented gateway/core/token/destination fixtures.
- Typecheck, build, package imports/declarations, API comparison, guide examples, scenario manifests and scoped lint pass; lint has test non-null warnings, not errors.
- Funding preflight `--dry-run` passes with explicit new master-USDC and master-SPL requirements. This check does not fund anything.
- Live labels: **8/8 passed**, including a genuinely mined reverted owner batch.
- Live multi-asset suite: **3/3 passed** with explicit destination gas, including the new independent-budget case.
- Final EVM/SPL rerun: **3/3 passed** (EVM positive, intentional destination failure, SPL transfer).
- Native SOL public suite: **6/6 passed again after the metadata resolver fix**, including actual agent delivery, owner funds-only SOL delivery and replay.

These are selected runs, not a single complete 58-case run. Across this expansion, 20 distinct live scenarios are covered (8 labels, 3 multi-asset, 2 EVM, 6 native SOL, 1 SPL). Earlier v5 native/lifecycle acceptance adds ten further distinct cases; it is not a fresh rerun of every scenario.

Initial default-gas EVM failure, an explicit-gas timeout and the pre-fix SPL decoding failure remain in the logs. Failed delivery is never accepted as success. All actual broadcasts were on Donut, Sepolia or Solana devnet, using fresh AGWs and bounded fixture funding. No mainnet transaction, contract deployment, team message, publication or credential dump occurred.

Evidence: [logs/](logs/), [live records](live-evidence.jsonl), [raw SPL metadata](spl-metadata-probe.json), [API comparison](api-comparison.json). Some diagnostic event/search files contain no matches; those empty results are not proof that no outbound exists.
