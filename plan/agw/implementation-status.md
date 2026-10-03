# AGW SDK implementation status

October 3, 2026, updated after the implementation review (R1–R7 fixed; see the [handoff](implementation-review-handoff.md#review-response-2026-10-03)). Branch `feat/agw-sdk-impl` (base `feat/agw-sdk-planning@349635b`). This matrix records what the code does today against the [implementation plan](implementation-plan.md). "Implemented" excludes placeholders; a capability-gated method that throws `CAPABILITY_UNAVAILABLE` is listed as blocked, not implemented. Details, commands and review hotspots are in the [review handoff](implementation-review-handoff.md).

## Evidence levels

| Level | Meaning |
| --- | --- |
| Unit | Mock-boundary jest suites under `packages/core/src/lib/agentic/__tests__` and `read-state/__tests__/web2-compat.spec.ts`; no network |
| Local | Real pinned e704d5b contracts on anvil through the SDK (`packages/core/__agw-local__`); stub gateway only; Push-EOA signers only |
| Live | Testnet transactions against a verified deployment. **None has occurred** — no compatible deployment has been verified or registered (A07) and no live run was authorized |

## Per-step matrix

| Step | Deliverable | Status | Unit | Local | Live | Remaining dependency |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Source and capability contract | Implemented | ✓ | ✓ rebuilt ABIs identical to evidence | — | Refresh pins when answers land |
| 2 | Namespace, types, exports, errors | Implemented; A04–A06 types provisional | ✓ | ✓ | — | Final public error names, A04/A05/A06 shapes |
| 3 | Signer/wallet context and lifecycle | Implemented | ✓ | ✓ owner, agent, stranger, read-only, reinitialize, guards | Blocked (A07) | UEA owner/agent paths only unit-tested (no UEA on anvil) |
| 4 | Generation registry and adapter | Implemented for e704d5b; registry ships empty | ✓ | ✓ wiring verified | Blocked (A07) | Verified manifest; OwnerIntent signing not implemented (no transport needs it) |
| 5 | Wallet and checkpoint reads | Implemented: derive, list, info, owner, checkpoints, active rules | ✓ | ✓ | Blocked (A07) | Revoked history (A06), `setLabel` (A07) gated |
| 6 | Rule normalization and codecs | Native implemented and vector-verified; universal validated then gated | ✓ | ✓ contract vectors | — | A05 multi-asset wire/vectors; A01/A03 confirmation |
| 7 | Create, add, revoke | Implemented (native rules); index-bound deploy | ✓ | ✓ sequential create incl. partial recovery and the concurrent-creation race; atomic multi-rule add | Blocked (A07) | 7702/UEA create batch paths unit-only |
| 8 | Atomic rules.update | Implemented for native rules | ✓ | ✓ five ticks, stale-spend rollback | Blocked (A07) | A05 per-token assertion for universal rules |
| 9 | Owner execution and allowance setup | Implemented | ✓ | ✓ owner batches, approve/remove via owner door | Blocked (A07) | Production gateway pull/burn |
| 10 | Agent rule selection and native sends | Implemented | ✓ | ✓ maxCalls, pins, amount, expiry, A02 | Blocked (A07) | A02 confirmation |
| 11 | EVM universal sends and gas | Composer implemented for the e704d5b single-asset generation (Route-2-equivalent destination calls, no SDK allowance writes); signer gas guard implemented | ✓ | ✓ passes every URP gate with stub gateway; revoked-allowance race | Blocked (A07) | A05 token resolution for assets[]; node/TSS/destination acceptance |
| 12 | SVM destination support | Not implemented; gated | ✓ gating | — | — | A05/A07, Harsh H4.4, obligations 19–23 |
| 13 | Responses, tracking, hooks, reads | Implemented | ✓ | ✓ live send/receipt identity | Blocked (A07) | Replay and outbound wait need a live run |
| 14 | Deployment onboarding and acceptance | E2E authored and gated; not run | — | — | Blocked (A07) | Verified manifest + authorized budget |
| 15 | Web2 compatibility | Implemented | ✓ | — | Not rerun | Review of CHAIN.WEB2 value change |
| 16 | compileCard | Not implemented; gated | ✓ gating | — | — | A08 |
| 17 | Documentation, examples, release | Planning docs only | — | — | — | Accepted feature scope |

## Assumptions A01–A08

| ID | Design status | Artifact status | What the code does now |
| --- | --- | --- | --- |
| A01 | Provisional (Harsh H1 unanswered) | n/a | `codec/policy.ts`: approval selectors refused in universal agent rules; native approvals need a pinned spender. One boundary module |
| A02 | Provisional (Harsh H2) | n/a | Native agent arrays refused before signing; owner batches allowed |
| A03 | Provisional (Harsh H3) | n/a | `codec/defaults.ts` is the only defaults table, tagged A03 |
| A04 | Provisional (Harsh H4.1) | n/a | `utils.agentic.rulesId/deriveWallet` take explicit validator / factory / implementation context |
| A05 | Open (Harsh H4.2, Zaryab Z1.1/Z1.2) | Missing | Target universal encode/decode and universal update throw `CAPABILITY_UNAVAILABLE`; `Spent` kept as specified and tagged provisional |
| A06 | Open (Harsh H4.3) | Missing | `rules.get` of a revoked rule throws `CAPABILITY_UNAVAILABLE` with `revoked: true`; list returns active rules only |
| A07 | Open (Zaryab Z1/Z3) | **No verified deployment** | Registry and `CONSTANTS.AGENTIC` empty; every AGW call fails `GENERATION_UNSUPPORTED`; `ref` and `setLabel` gated |
| A08 | Open (Harsh H5, Zaryab Z5) | Missing | `utils.agentic.compileCard` throws `CAPABILITY_UNAVAILABLE` |

No product decision was assumed approved. No Notion refresh or answers were found in the workspace; remote AGW/core/gateway refs were rechecked unchanged (`e704d5b`, `cb69e0b`, `bcbf7df`).

## Gap register cross-reference

Implementation evidence exists for G03 (explicit-context IDs, receipt IDs), G08 (checkpoint/label reads), G13/G15 (creation strategy and partial recovery), G14 (wallet-level replacement), G16 (Web2), G17 (read-only and reinitialize), G18 (eligibility and uncached selection) and G20 (dedicated composer and response identity). None is closed: each closure criterion also requires review and, where stated, a verified deployment or live acceptance.
