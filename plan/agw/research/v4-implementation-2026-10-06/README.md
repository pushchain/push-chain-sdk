# V4 SDK migration — October 6, 2026

> Superseded validation status: [live acceptance report](../live-acceptance-2026-10-06/README.md). Full permissions are restored: public Donut derive, all 53 Anvil cases, unfiltered units, Nx build and four typechecks pass. Bounded testnet funding/broadcasts have started. Earlier restrictions and unrun-live statements below describe the original execution only.

Branch: `feat/agw-sdk-v4`, based on `b1597b9`. Working changes are uncommitted and not pushed. The pending October 5 comment review and October 6 deployment review were preserved. This implements native and EVM v4 integration; it is not a claim of completed SVM support or funded live acceptance.

## Implemented

- **V4 only:** removed the e704d5b adapter, ABI modules, single-asset historical codec and old contract vector file from runtime/test code. Replaced them with e8db748/v4 artifacts and regenerated contract-produced vectors. Earlier review documents remain historical evidence, not runtime dependencies.
- **Donut configuration:** checked factory, URP, implementation, engine/validator and start block are in the registry; CONSTANTS.AGENTIC is populated. Unsupported networks still fail before signing. Custom registrations/manifests must match the v4 source pin.
- **Envelopes:** version 1 for native/EVM; other versions and old two-field data are rejected. Actual v4 contracts reject the old envelope in the new local suite.
- **EVM multi-asset grants:** resolve wallet CEA and ordered token caps, check PRC20 source chain and token identity, reject duplicate resolved assets and preserve token units. Omitted total is maxUint256; explicit zero stays zero. Empty user lists become a single destination gas-token cap at 0/0.
- **Reads and pure helpers:** decode v4 Config/asset arrays, reconstruct origin token addresses and exact beneficiary offsets, retain enabled-only reads without public spent. Native gas PRC20s can report an empty source address; only the on-chain gas-token identity maps that to the native marker. Pure decodeRules resolves known static-registry tokens; unknown mappings fail with a hint to use asynchronous rules.get. Shared PRC20 mapping was extracted without changing its existing behavior.
- **Replacement:** snapshot every old token in stored order and encode assertSpent(expectedSpent[]) before revoke/grant in one owner batch. Native replacement also asserts every action if the old rule has several. Existing race/partial-create/allowance/identity fixes are retained.
- **Execution:** choose the request token from the selected rule's assets, use maxGasPerCall, and consume separately established owner allowance. Updated policy ABI/events/errors and response/replay imports; each outbound still moves one request token.
- **Multiplicity:** management permits multiple same-agent/same-chain grants. An ambiguous send returns AMBIGUOUS_RULE with candidate IDs; no arbitrary first match, automatic permission deletion or speculative selection API.
- **Acceptance preparation:** live EVM setup now grants via public SDK methods. Added opt-in two-token create/read/replacement and call-only outbound scenarios. Built-in Donut manifest supplies defaults; read-only code/wiring/version checks still precede funding. SVM todos only describe the remaining public mapping/cluster acceptance, not absent wire types.

## Validation

| Check | Result |
| --- | --- |
| Full core unit suite | 1,919 passed, 0 failed; 12 skipped; 112 suites passed, 1 skipped |
| Actual v4 contracts through SDK on Anvil | 46 passed, 0 failed; 6 suites |
| Explorer ABIs vs isolated e8db748 build | All 5 sets match exactly, including constructors/errors/events/parameter names/internalTypes; ABI array order ignored |
| Typechecks | lib, spec, local harness and AGW E2E files pass |
| SDK build | core:build passes |
| Lint | Same 7 pre-existing errors in unchanged read-example/PC20 files; no new errors |
| Opt-in AGW E2E selection | 25 scenarios, 9 files, 25 distinct tests; consistent |
| Default all E2E selection | Unchanged: 76 scenarios, 40 files, 81 distinct tests |
| Public SDK Donut read-only derive | Unconfirmed in this session: the corrected script could not read a block from the RPC under the current restricted network environment |

[ABI build comparison](abi-build-comparison.json). Command outputs are under [logs/](logs/). Local tests use actual AGW/factory/engine/validator/URP and real type-4 transactions, with token/core/gateway/executor and destination lookup fixtures. They do not prove Cosmos/TSS, production executor, UEA or destination execution. The local Jest run prints an open-handle warning but exits; Anvil children are stopped. No full contract-security suite/audit is claimed.

The ten new actual-contract cases cover ordered two-asset grant/read; wrong chain; same-chain wrong token identity; independent counters; hard zero and maxUint256; call-only routing; atomic replacement/five checkpoints; second-token intervening spend rollback; permitted duplicate grants/ambiguous sends; and old-envelope rejection. Reverts are checked by their named errors.

The original read-only invocation mistakenly imported PUSH_NETWORK from the package root; that enum is accessed through PushChain.CONSTANTS. The corrected saved script reaches its RPC read but cannot complete here. This is separate from the successful earlier block-23931055 deployment probe and is not reported as public-SDK live success.

## Still pending

- Harsh H3: exact native omission defaults/public maxValueTotal and token-independence wording. Native defaults remain provisional and unchanged; delivered universal total semantics are implemented.
- Harsh H4.5: public raw-offset authoring versus separate decoded wire records. Native pins/amount and EVM beneficiary offsets are lossless raw data; the latter now has beneficiaryOffset. The SDK never invents ABI argument indexes.
- Harsh H6: send selection when multiple rules match, including native arrays and overlapping permissions. Source/management capacity is implemented; selection remains explicit ambiguity.
- Ref and editable-label v1 scope: absent from deployed contracts; capability gates remain.
- SVM: contract types are delivered, but public SDK mapping/composition/account coverage and cluster acceptance remain gated. Solana-origin agents through UEA are separate from Solana destinations.
- Authorized funded Donut E2Es: none were run. creditRevert still depends on executor integration. Release validation must prove real pull/burn, node/TSS handling, recipient/executor correlation and destination tracking.

## Reproduction

From the SDK root:

```sh
node packages/core/scripts/agw-local/gen-abi.mjs
OUT="${TMPDIR:-/tmp}/push-agw-local-v4" packages/core/scripts/agw-local/prepare.sh
AGW_LOCAL_DIR="${TMPDIR:-/tmp}/push-agw-local-v4" node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand
node node_modules/jest/bin/jest.js --config packages/core/jest.config.ts --runInBand
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.lib.json --noEmit
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.spec.json --noEmit
node node_modules/typescript/bin/tsc --project packages/core/tsconfig.agw-local.json --noEmit
NX_DAEMON=false node node_modules/nx/bin/nx.js run core:build --skip-nx-cache
```

The AGW E2E typecheck uses [tsconfig.agw-e2e.json](tsconfig.agw-e2e.json), extending the core config with AGW E2E includes, Jest/Node types and the existing @e2e/shared alias; no specs are executed. From packages/core, run e2e:verify with --group agw or --group all to check selection without broadcasting. [donut-readonly.ts](donut-readonly.ts) uses a public read-only account and only calls initialize/derive; it contains no transaction submission.
