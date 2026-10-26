# October 12 feedback — work items and deployment boundary

Source: native Markdown exports of [SDK page 5](https://app.notion.com/p/pushprotocol/5-SDK-AGW-3e9188aea7f481cf8e8de324956549b9) and [contract page 1](https://app.notion.com/p/pushprotocol/1-AGW-Contract-Changes-nomenclature-standard-change-set-3e9188aea7f4813aa31fc95ceb4e684d), downloaded October 12 at 20:23 IST. Both section 6 introductions say the new text overrides sections above. [Downloads, hashes and diffs](research/section6-feedback-2026-10-12/). The user confirms the new contract changes are not deployed. Planning stays on `feat/agw-sdk-v4`; non-plan changes are also synced to `feat/agw-sdk-v5`.

## SDK-owned changes available on deployed v5

S01–S12 are implemented locally (within the explicit v5 limitations below). S13 has 68/68 passing live coverage across the full run (65 passed, 3 failed) and the three-case rerun (3 passed). This is not one clean full invocation. Section 7 now has a preset-only framework; the catalog remains empty by user decision. Encoding/ID utilities remain private.


| Item | Feedback | Required change |
| --- | --- | --- |
| S01 | SDK 6.a, 6.h | Unified `Rule.allowedCalls[]` for native/EVM/SVM; retire public native `actions[]` and single-function shorthand. Preserve internal per-action wire terms. |
| S02 | SDK 6.a | Pins inside calls: `{arg, expected}` / `{arg, max}`; native max compiles to the existing metered argument (at most one). Remove public native lifetime totals/call limits and per-action expiry. |
| S03 | SDK 6.a | `AGENTIC.WALLET = 'agentic:wallet'`; resolve AGW/CEA/ATA context, map existing EVM beneficiary to one WALLET pin, reject unsupported destination pins before signing. |
| S04 | SDK 6.b / contract 6.5 | Omitted asset maxTotal and call maxValue become zero. Explicit zero already works in contracts. |
| S05 | SDK 6.c–d | Restore `spent` in records; per-asset universal spend in asset order. Read pins as arg, support get→change expiry→update. See read-shape questions below. |
| S06 | SDK 6.f / contract 6.6 | Direct wallet setLabel on both EOA/UEA paths; no owner checkpoint; AGENTIC-TX-106 progress event. |
| S07 | SDK 6.g / contract 6.6 | First-use EVM CEA gas default when caller omits gasLimit, preserving explicit caller value and policy checks. |
| S08 | SDK 6.h, 7 | Remove public addresses/limits/encoding/ID helpers. Retain WALLET and the later preset namespace only when preset data/behavior is settled. |
| S09 | SDK 6.i | Solana signature/discriminator and numeric arg/account pins replace IDL-bearing rules. Send-data IDL helper remains. Fixed-width layout only. |
| S10 | SDK 6.l | Restore DUPLICATE_RULE at create/add; retain AMBIGUOUS_RULE for pre-existing overlaps. Reject before signing. |
| S11 | SDK 6.l | Unsupported network/deployment maps to CAPABILITY_UNAVAILABLE rather than public GENERATION_UNSUPPORTED. Preview-only RULE_LIMIT_EXCEEDED becomes internal. |
| S12 | SDK 6.m | rules.delete replaces rules.revoke; DELETE_NEEDS_TARGET replaces REVOKE_NEEDS_TARGET. Contract functions/events/checkpoint names do not change. |
| S13 | Review acceptance | Update unit/local/live scenarios and consumer examples for new behavior, then run the full compatible AGW group. A complete final suite also needs the new deployment. |

## Keep deferred until contract delivery

| Item | Contract dependency | Current safe behavior |
| --- | --- | --- |
| C01 | Page 1 §6.1: exact approval inside each outbound, both doors | Do not delete allowance safety checks or claim automatic approval on v5. Switch only with verified source/ABI/deployment. |
| C02 | Page 1 §6.2: createWallet(label, Session[]) and factory-only initial grant path | Do not invent the ABI or remove partial recovery until every supported owner has atomic creation. Decide the signed variant and preserve index-race protection. |
| C03 | Page 1 §6.3: general destination EQ/MAX pins | Use existing WALLET beneficiary support; reject other destination pins until deployed. Native v5 supports 8 EQ pins and one metered MAX per action. |
| C05 | SDK §6.k: contract-owner confirmation of wallet-token-account pins in all supported cases | SDK derives and validates CEA/ATA context. Local SPL and selected live cases provide evidence for those cases, not a claim of universal policy coverage. |
| C04 | SDK §6.l: remove CREATE_PARTIAL, allowance error and split-write recovery fields | Follows C01/C02; removing them early would hide real existing failure states. Core non-AGW transaction fields must not be removed globally. |

Ref removal is already implemented and deployed. Explicit zero cap semantics are already implemented by the contract; no deployment is needed to change SDK defaults.

## Specification gaps to highlight

1. **Native action ceiling:** SDK 6.h says 1..32 allowedCalls for all chains; deployed AGW caps native session actions at 8. Keep the actual cap and identify this unsupported request explicitly.
2. **Native spent with several actions:** the new public Spent shape has one native amountSpent/callsUsed despite per-action contract counters. Summing unrelated token amounts has no useful token meaning; the user approved per-action spend entries on October 12. Keep scalar counters for a single action; return identified action entries for multiple actions.
3. **Argument reconstruction:** contracts keep offsets and four-byte selectors, not ABI signatures/types. Flat 32-byte EVM arguments map to arg; offsets after static tuples/arrays cannot reliably recover original top-level indexes. Reject unsupported round-trips rather than silently re-encode different calldata constraints. Preset §7.e explicitly leaves struct fields open.
4. **Solana read/modify/update:** raw eight-byte selectors and stored byte offsets have no Borsh argument types. Exact numeric arg reconstruction needs layout metadata or a defined raw representation. Account positions can round-trip directly. The user approved a decoded raw representation on October 12. Authored rules use numeric arg/account positions; decoded raw rules preserve offsets and all constraints and are accepted by update.
5. **Presets (§7):** first app/address lists and struct-field pin semantics remain open. The preset framework is implemented; missing caps default to zero per the user. No invented DEX/lending addresses or permissive approval presets. The agent is already one Push address (EOA/UEA) across destinations.
6. **Old statements:** contract §6.2 describes native multicall rejection, but SDK EIP-7702 atomic native creation is already tested. The new factory entry is still a requested target; do not remove index-race protection simply to match its illustrative signature.

## Discussion check

The SDK All discussions panel contains the older October 1–7 comments (including the resolved multiple-rules-per-chain comment and ref omission). The contract All discussions panel contains September 29/October 1 comments, including direct cosmetic label guidance. No later inline thread was visible. The fresh section 6 body and the user's supplied Harsh message supersede the older comments. Native Notion exports exclude discussion threads.

## Live acceptance follow-up

Donut reported `height 23989983 is not available, lowest height is 24073229` for a default checkpoint-history scan. The SDK now retries from an explicitly reported retention floor only for an unbounded/default scan, and still requires the full sequence 1..checkpointCount at one snapshot. Missing old events remain an error; no partial history is returned as complete. Explicit sinceBlock requests and unrelated RPC errors are not silently truncated.
