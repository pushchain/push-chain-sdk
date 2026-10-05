# Donut v4 deployment and SDK integration review

> Historical pre-migration inspection. Its missing-adapter/registry findings were implemented in a66ff7d. [Current migration](../v4-implementation-2026-10-06/README.md) and [live acceptance](../live-acceptance-2026-10-06/README.md) supersede those implementation-status statements; original source evidence is preserved below.

Reviewed October 6, 2026. **The contract deployment/artifact dependency is substantially delivered; the current SDK adapter still cannot use it.** This is a source/ABI/read-only integration review, not a funded acceptance run or a security audit.

## Revisions and evidence

- [deploy-agw documentation head](https://github.com/pushchain/push-agentic-wallets/tree/10a24f101e2e6e0a9b76517b29f5cdb1aa967796): `10a24f101e2e6e0a9b76517b29f5cdb1aa967796`.
- [Reported deployed source](https://github.com/pushchain/push-agentic-wallets/tree/e8db74815cfbbf5389593805e464fe8d85f7f735): `e8db74815cfbbf5389593805e464fe8d85f7f735`. No src changes between it and the documentation head; the linked owner guide was added afterward.
- [Saved address book](source/docs/addresses/donut.md) and [owner guide](source/docs/5_SDK_Owner_Integration.md). [Source manifest](source-manifest.json) records hashes; these are GitHub snapshots, not a new Notion export.
- [Read-only probe](donut-probe.json): Donut chain 42101, block **23931055**, block hash `0x53bae3cfa28570dc06361ef91e33aa9a885e0d01284cf749d4fd5c018d72c83c`. Code, proxy slots and selected views were read at this block.
- [Explorer artifact metadata](explorer-artifacts.json): the five implementation/engine/validator contracts returned verified ABIs, solc 0.8.26, optimizer 833, Cancun. Saved under [abis/](abis/). Explorer verification is reported by the explorer; a local bytecode rebuild was not performed.
- [ABI comparison](abi-comparison.json) against the SDK e704d5b artifacts; [four focused compatibility checks](wire-checks.json) passed.

## Deployment facts

| Integration input | Verified at the probe block |
| --- | --- |
| Factory proxy | `0xaF88D0FD947afAe7bBb8F34e8417DCfc165e1aaF` |
| URP proxy | `0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af` |
| Wallet implementation | `0x96D69ec7e6cDdaD414e656B5c9DCA24587DF713c` |
| Engine | `0x165A5E6782f39D30B38c7D97e1303e4CB2aD102a` |
| Validator | `0x068EE2388475A98EE1f5a434C58bFF3444fffFe6` |
| URP version | `3.1.0` |
| Wallet accountId | `push.agw.1.0.0`, unchanged from the earlier source generation |
| Factory paused | false |
| Historical scan start | Address book reports deployment blocks 23923806–23923810; capture transaction receipts/log provenance when producing the release manifest |

Factory/URP implementation slots and URP admin match the new book; wallet implementation getters point to the new engine, URP, validator and C1 gateway. Runtime sizes match the book. URP SESSION_ENGINE also returned the documented engine. Core's Sepolia gas-token getter returned `0x2971824Db68229D087931155C2b8bB820B275809` at the same block, matching the guide (see supplemental reads).

These replace the earlier supplied address table for **new v4 integrations**. Existing wallets remain tied to their original factory/generation; their addresses, rules and balances do not migrate. Do not use an unchanged accountId as proof of envelope compatibility.

## Contract questions now answered

| Former uncertainty | Delivered answer | Remaining SDK work |
| --- | --- | --- |
| Z1.1 multi-asset body | UniversalTerms = `(uint48,address,(address,uint256,uint256)[],uint256,(address,bytes4,uint16,bool,uint256)[])`; 1–8 PRC20s, distinct and chain-checked | Resolve user tokens, encode/decode caps, retain order and select outbound token |
| Envelope | `abi.encode(uint16(1), string chainNamespace, bytes body)` for native, EVM and SVM | Migrate every grant and decode path; isolate old fixtures |
| EVM expectedCEA | `address`, not proposed bytes32; derived from the wallet on the destination chain | Resolve/check wallet CEA; preserve derivation-drift handling |
| Empty user assets | Empty wire list rejected; guide prescribes destination gas PRC20 at 0/0 for a no-movement rule | Add exactly one routing-only cap only when input is empty; amount remains zero |
| Universal total zero | Zero forbids movement; uint256 maximum represents no total cap | Replace the provisional zero/unlimited universal default; preserve explicit zero |
| Z1.2 assertion | `assertSpent(bytes32,address,uint256[])`; length and every expected value checked in listed-token order, EVM and SVM | Internal per-token snapshot → assertion → revoke → grant in one owner batch |
| SVM terms | Detailed assets/programs/account/data pins/CEA accounts supplied | Public SDK representation, registry/ATA/PDA resolution, payload composer, reads and acceptance |
| Multiple rules | Guide explicitly permits several rules for one agent and chain | Lifecycle validation must align with Harsh's acceptance; send selection still unspecified (H6) |

Exact source: [Types.sol](source/src/libraries/Types.sol:208), [asset validation](source/src/policies/UniversalRulesPolicy.sol:439), [ordered assertion](source/src/policies/UniversalRulesPolicy.sol:1437). [Multi-asset source tests](source/test/unit/28_multiAsset.t.sol:142) include exact-counter, independent-token, zero-cap and no-movement cases. They were inspected, not rerun. The owner guide excludes the agent outbound path explicitly.

## Why the SDK is not ready by adding addresses

1. **All grants:** [session.ts](../../../../packages/core/src/lib/agentic/codec/session.ts:43) still encodes `(string,bytes)`. Its first word is 64, not version 1. New wallet code decodes three fields before URP; native grants are affected too. The exact revert on a grant depends on which decoder is reached; the wire check does not claim an on-chain grant was executed.
2. **New generation:** [deployments.ts](../../../../packages/core/src/lib/agentic/deployments.ts) only recognizes e704d5b and ships an empty registry. Add a separate v4 adapter/manifest after compatibility tests. Keep old local fixtures reproducible.
3. **Universal reads:** getConfig/getSvmConfig retain selectors but return different tuples. A real empty v4 getConfig response decoded with its verified ABI; the old ABI rejected the same bytes.
4. **Universal grants:** [universal.ts](../../../../packages/core/src/lib/agentic/codec/universal.ts:68) still gates encoding. Implement the delivered multi-asset schema, wallet CEA context and routing-only zero cap.
5. **Agent outbound:** [send.ts](../../../../packages/core/src/lib/agentic/execution/send.ts:170) still reads cfg.asset/maxPCPerCall. V4 requires selected token membership in cfg.assets and maxGasPerCall; each outbound still moves one request token, not all listed tokens together.
6. **Replacement:** implement the array-form internal assertion, preserving token order and checking every old-rule asset; do not replace it with a getter or only check the asset used last.
7. **Logs/errors:** OutboundMetered and RevertCredited now include token; creditRevert gains a token argument; the old scalar universal assertion disappears. Refresh policy ABI/error decoding and event consumers.
8. **Multiplicity:** create/add/update and send resolver still enforce one enabled agent/chain pair. Remove lifecycle restrictions in the agreed change, but settle rule selection first; arbitrary first-match execution is not an acceptable substitute.

Factory, wallet and engine function/event/error signatures and return shapes match the older ABI comparison. **Wallet execution semantics still changed through envelope decoding despite that ABI similarity.** This is why selector/accountId checks alone are insufficient.

## Still open and scope limits

- **H3, narrowed:** universal omitted total is specified as uint256 maximum; explicit zero is a hard zero. Native wire totals also use max for unlimited, maxCalls zero is unlimited, destination maxValue zero is non-payable. The guide does not decide all *SDK omission defaults*, especially native maxValuePerCall/maxValueTotal, or explain Harsh's referenced public maxValueTotal change. Token-independence wording still needs product confirmation; the delivered schema retains assets[].
- **H4.5:** raw offsets are confirmed wire data, but the public authoring/read model is still a product choice. The guide's `4+32*argIndex` shorthand is valid for simple one-word top-level ABI arguments, not arbitrary tuples/arrays; retain the SDK's ABI-layout validation.
- **H6:** same-agent multiplicity is supported; decide public explicit-rule selection versus a defined automatic strategy, including multi-call/overlapping rules.
- **Z1 metadata:** grantRules still takes Session only, RulesGranted has no job ref, label exists only in WalletDeployed, and setLabel is absent. Confirm intended v1 scope; do not fabricate storage/ref events.
- **SVM:** wire definitions are delivered, but usable SDK inputs/resolution and representative cluster fixtures/acceptance are outstanding. CEA plus every listed token/output value-holding account must be protected; URP cannot derive those accounts for the SDK.
- **creditRevert:** [source](source/src/policies/UniversalRulesPolicy.sol:1514) explicitly says the executor does not yet call it on failure. Its no-code account is an expected module-address property, not proof of a defect by itself. Platform integration remains pending.
- **Gateway allowance:** retain separate owner-established allowance. The SDK must not automatically restore an allowance from a stale read. The owner guide does not itself provide a complete approve/setup sequence.
- **Live acceptance:** no wallet was created, funded or granted by this review; no production pull/burn, agent transport, destination execution or settlement was exercised. Native/local SDK counts from e704d5b do not validate v4.

## Next SDK steps

1. Add the e8db748/v4 adapter, verified ABIs and candidate manifest; retain e704d5b as a fixture generation.
2. Make envelope encode/decode generation-aware for all rule kinds and replay utilities; add malformed/version regressions.
3. Implement EVM multi-asset codec, token/chain/CEA resolution, no-movement routing and corrected total semantics.
4. Implement v4 term reads and internal per-token spend/assertion adapter; prove all-asset stale-state rollback.
5. Adapt outbound token choice, maxGasPerCall, events/errors and live/replay summaries. Preserve explicit allowance and identity behavior.
6. Settle H6 and revise management/resolver/batch metadata/tests together. Keep ref/label gated until scope is decided.
7. Port the existing real-contract SDK harness to e8db748 and add multi-asset/call-only/version/multiplicity tests. The four checks here are not that harness.
8. Implement SVM SDK mapping/composition with explicit account coverage and cluster fixtures.
9. Finalize registry/manifest including verified event start provenance, then perform preflight and authorized funded E2Es. Do not silently fund or submit while checking docs.

Reproduction: `python3 plan/agw/research/deployment-review-2026-10-06/probe.py` (new pinned block each run); `node plan/agw/research/deployment-review-2026-10-06/verify-wire.cjs` (uses the saved probe block). The SDK's full test suite and contracts' build/full suite were not rerun because no implementation was changed.
