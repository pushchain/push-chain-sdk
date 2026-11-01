# V6 SDK migration — completed locally

Source pin: `ffd567d3e49b2d27c6f50ad36093274dbac3090f`; documentation head `e57998c2d8ef9db15e69a68061ad3101120a6c6c`. Factory/URP/wallet wiring and nine bytecode sizes were checked on Donut at block 24244801. Executable runtimes of factory logic, wallet, URP, engine, validator and SvmRulebook match the isolated source build after excluding metadata and constructor/link slots (block 24245374); [comparison](bytecode-comparison.json). Both proxy implementation slots and all three URP SvmRulebook link slots independently match the address book at block 24245415 ([wiring](proxy-library-wiring.json)). This is not a full audit or a claim that all constructor bytes were compared byte-for-byte.

## Implemented locally

- Replace the v5 runtime, ABI snapshots and deployment constants with v6; no legacy fallback.
- One index-bound createWalletWithSig call with the documented owner empty-signature path. Both index and predicted wallet are checked; up to eight initial rules. Rollback is atomic. Remove CREATE_PARTIAL; keep receipt-unavailable hash evidence.
- Remove allowance reads/requirements on owner and agent outbounds (EVM/SVM). Wallet performs the exact approval/cleanup. Remove GATEWAY_ALLOWANCE_INSUFFICIENT. Core response fields used outside AGW remain unchanged.
- Native and EVM pins encode (offset, op, value), including general EQ/MAX and multiple native MAX pins. Native maxCalls uses uint32 max. Solana unspecified account count uses 255. Native MAX pins do not increment the separate amountSpent meter.
- Multiple EVM entries for one target/selector are OR alternatives. Unpinned/pinned combinations are refused. Presets can now generate separate spender-pinned alternatives; approved app catalog remains empty.
- Include linked SvmRulebook error definitions with the policy ABI so nested revert names remain readable.
- Link the SvmRulebook in the isolated contract fixture. Regenerate contract-derived v6 vectors.
- Native call ceiling remains eight (not the spec's generic 32). Source still reports policy version 3.1.0, so address/wiring/source registration identifies the generation.

## Validation so far

- Full units: 2,073 passed, 12 skipped, zero failed.
- Real pinned contracts: 99 passed across 13 suites. Includes atomic initial-rule rollback, index race, zero-allowance send/cleanup, EVM alternative EQ/MAX constraints/read-update and Solana errors.
- Build, lib/spec/local typechecks, guide examples, built CJS/ESM imports and declaration/API comparison pass.
- Funded acceptance: **69 distinct scenarios have passing v6 coverage**. Original run selected 68: 67 passed and one stale allowance assertion failed. The corrected case and newly added EVM EQ/MAX alternative case both passed in the focused run. This is combined coverage, not one clean full invocation. [Full log](live-full.log), [focused log](live-focused.log), [structured results](validation.json), [transaction evidence](live-evidence.jsonl).
- Live proof includes one-call indexed creation, initial grants, owner/agent outbounds with automatic allowance handling, native/Solana execution, decoded-rule updates, zero defaults, concurrency rollback, and a real Sepolia Approval event through the second pinned EVM alternative. Wrong-spender and over-cap attempts fail before signing.
- A final remote recheck found the same deploy-agw head and no source difference from the pinned deployment ([recheck](head-recheck.json)).

V6 code is committed locally on v4 (`7dca3f2a`) and v5 (`700a52a7`); planning stays on v4. Neither migration commit has been pushed. No real contracts were deployed by this work; local Anvil fixtures are isolated. Contract-owner testnet dry runs are still ongoing.
