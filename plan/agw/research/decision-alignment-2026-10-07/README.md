# October 7 decisions — SDK alignment and acceptance

The approved decisions are implemented: native PC omission stays zero; token budgets stay independent; rule `ref` is removed; native/EVM argument indexes and raw offsets are both accepted; public Solana authoring uses named Anchor IDL inputs.

## Public changes

- New exported types: `SolanaRule`, `DecodedSolanaRule`, `SvmInstructionRule`, `SvmAccountRef`, `SvmFieldConstraint`.
- Existing create/add/update/get/list/revoke methods now support Solana rules. Reads preserve stored constraints and cannot recover the original IDL.
- The ordinary agentic `sendTransaction` path supports one Solana instruction, including owner sends, wallet-specific account derivation, gateway allowance/balance checks, errors, progress events and replay. Response metadata adds `destinationInstruction`.
- `NativeRule`/`UniversalRule`/`RulesRecord` no longer expose rule `ref`; old runtime inputs containing it are rejected. Checkpoint `ref` remains an existing, separate event field.
- EVM `UniversalRule.chainNamespace` is now EVM-specific; use `SolanaRule` for Solana. Both native argument/offset forms remain supported, with conflicting inputs rejected.
- The consumer guide documents fixed primitive/fixed-array Anchor layouts, eight-byte discriminators, top-level non-optional accounts, supported comparisons, and unsupported-layout failures. Public Solana execution currently uses configured devnet; no public raw-wire rule-authoring API was added.

## Contract delivery still pending

Fresh fetch: `deploy-agw@10a24f1`, `pushAgenticWallet_v3@e8db748`. These expose `executeAsAgent(rulesId,...)`, which already enforces permissions, and no `setLabel`. Only editable labels await AGW contract delivery. The SDK retains AMBIGUOUS_RULE when multiple candidates match and maps contract rejections; no automatic-selection interface or caller-facing selector is required. The previously recorded automatic-selection dependency was an assistant misinterpretation, corrected by Shoaib.

## Validation

| Check | Result |
| --- | --- |
| Full core unit suite | 1,999 passed, 0 failed; 12 existing skips |
| Actual v4 contract harness | 81 passed, 0 failed across 11 suites |
| New native funded cases | 3/3 pass; zero-default case additionally rerun with exact `ValueExceedsCap` assertion |
| Public Solana funded cases | 4/4 pass after the gas-estimation fix |
| Build | Pass |
| Typechecks | lib/spec/local-contract/AGW-E2E pass |
| Package/API/docs | Compiled exports match source; packed CJS/ESM imports and guide examples pass |
| E2E manifest | AGW: 46 scenarios/12 files/46 tests; default all remains 76/40/81 |

The 46 AGW cases have selected-run live coverage (39 historical cases plus these seven additions), not one new combined 46-case execution. The local harness uses actual AGW/factory/engine/validator/URP contracts and fixture gateway/core/token components; public live delivery independently checks the real Solana receipt and CEA-to-recipient transfer. [Live evidence](live-evidence.json), [sanitized logs](logs/).

New native cases cover omitted PC limits with a valid token transfer, raw-offset read/re-grant equality, and removed/conflicting inputs rejected before signing. Public Solana cases cover named-IDL grant/read/atomic replacement, actual destination transfer plus wait/replay, substituted account/oversized instruction refusals, and revoke followed by send refusal. A destination failure was previously tested through the internal wire backend; the new public suite does not claim a separate failing-program run.

## Live issue found and fixed

The initial public Solana create+grant reverted under the existing EIP-7702 fallback budget of 1,100,000 gas. Read-only replay at the preceding block failed at that limit and passed at 2,200,000. The fallback guessed 500k per call when state-override estimation failed, which was insufficient for this grant.

`sendBatch7702` now estimates the actual signed authorization transaction first. If that RPC form is unsupported, it estimates ordinary execution only when the sender already delegates to the exact executor, otherwise attempts the delegation state override. If all valid estimation paths fail, it refuses to broadcast instead of inventing a gas ceiling. Estimates receive execution headroom plus authorization overhead. The live retry succeeded with gas limit 1,732,532 and gas used 1,171,408. [Receipts](batch-gas.json).

Tests cover authorization-estimate fallback, fresh-account override, and refusal when estimation fails. The local batch rollback test explicitly overrides only its gas estimate to force a mined revert; a separate test verifies the normal pre-broadcast refusal path. Contract validation remains authoritative.

No contract deployment, mainnet transaction or team message was sent. The funded runs used bounded, previously authorized testnet fixtures; environment secrets are absent from the saved evidence.
