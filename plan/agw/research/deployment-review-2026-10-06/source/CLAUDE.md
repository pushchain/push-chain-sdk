# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**`docs-internal/v3-architecture-docs/README.md` is the single entry point for design intent.** Read it, and
the reading plan it sets out, before writing any code. This file is conventions, commands and orientation;
it does not restate the architecture.

**Precedence, highest first:** `docs-internal/v3-architecture-docs/CORE_RULES_v3.md` →
`docs/1_AGW.md` and `docs/2_UniversalRulesPolicy.md` → `docs-internal/v3-architecture-docs/v3-decision-register.md` →
the five PRDs in `v3-prds/` → the worked examples in `docs/`
(`3_Universal_Flow.md` cross-chain, `4_Native_Flow.md` Push-side).
Everything else in the repository is history. **The PRD is the specification; the existing code is not.**

**The narrative docs live in `docs/`, not `docs-internal/`** — `1_AGW.md` (the system), `2_UniversalRulesPolicy.md`
(the rules policy, split out of the system doc) and the two flow walkthroughs; addresses per network live in
`docs/addresses/`. `docs-internal/` holds the build specifications, the decision register and the PRDs.

## Commands

```
make build             # forge build
make test              # check-execute, then forge test -vv
make sizes             # the S-06 size gate — forge build --sizes, exits non-zero over 24,576 B
make check-execute     # sha256 pin: execute() byte-identical to its reviewed text (the B2 checkpoint revision)
make snapshot-execute  # WARNING only — owner-door test gas vs .gas-snapshot-execute (±1000 gas)
make e2e               # PARKED: prints that the Marketplace E2E awaits its rewrite, exits 1
forge fmt              # line_length 120, tab_width 4
```

**`execute()` is hash-pinned.** `script/check-execute.sh` hashes the source span of
`AGW.execute` (pinned at the B2 checkpoint revision) — not a byte, not a comment may change.
Owner-authority features go in *sibling* doors (`executeWithSig`, `grantRulesWithSig`), never in
`execute`; the per-call checkpoint is the one addition `execute` carries, and it consults nothing and
cannot revert.

**The Marketplace E2E deploys the core repo's own artifacts** via `vm.deployCode` (core is
shanghai / 99,999 runs / OZ 5.3; this repo does not recompile it). Run `make e2e` — `test_E2E_13` fails on
a stale core artifact. **That suite is currently PARKED** as `test/integration/24_marketplaceE2E.t.sol.parked` (not compiled): the core
marketplace is migrating to a new surface that also needs D3's agent config, so the suite awaits a rewrite; `make e2e`
says so and exits. `lib/push-chain-core-contracts` is currently a **symlink** to the sibling checkout
(`../../push-chain-core-contracts`), which is why `foundry.toml` carries a temporary `allow_paths`.

**The demos (`demo/`, `demo-native/`) are frozen against the deployed v1 contracts** and do not compile against
the renamed `src/`; they are listed in `.gitignore` and must not be edited. The two demos have their own Foundry
profiles so `forge test` runs only the v3 specification suite:
`FOUNDRY_PROFILE=demo forge test`, `FOUNDRY_PROFILE=demo-native forge test` (each wrapped by its `justfile`;
see `demo/README.md`, `demo-native/README.md`).

`make sizes` runs `--sizes` twice — once for the build, once for the vendored engine explicitly. That is
deliberate: **which contracts the default table covers is forge-version-dependent** (1.5.1-stable includes
`lib/`; 1.6.0-nightly did not), and SmartSession has the smallest margin in the build. The gate must not
rest on a reporting default that has already changed once.

Narrower runs:

```
forge test --match-path test/unit/5_universalRulebook.t.sol -vv
forge test --match-test test_U09_ -vvv           # one test, full traces
forge test --match-contract URPTest              # test contract names predate the rename and are kept
forge coverage --ir-minimum                       # via_ir is on; plain coverage will not compile
forge test --gas-report
```

One suite is env-gated and **skips silently when the variable is unset** — a skipped test is not a passing
test, so run it at least once against a real endpoint before reporting a phase done:

- `DEPLOYMENT_RPC` + `CHAIN_ID` — gate S-05, which checks `deployments/<chainId>.json` against a live chain.

Deployment (all five contracts, dependency order, writes `deployments/<chainId>.json`):

```
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast
```

Requires `UNIVERSAL_GATEWAY_PC`, `UNIVERSAL_EXECUTOR_MODULE`, `CHAIN_ID`, and `FACTORY_ADMIN` off local
chains. See `.env.example`. The script asks the chain for its id and reverts on a mismatch with `CHAIN_ID`.

## The system in one pass

A user funds a small, purpose-built wallet on Push Chain and grants it a **rules set**: a frozen bundle of
limits (which agent, which token, which destination protocol and functions, how much per call, how much
total, until when). The wallet's balance is the hard ceiling on everything the agent can lose. Every agent
action is checked by contracts at execution time; the agent's honesty is never assumed.

**The one hard problem.** Push Chain reaches other chains through a single frozen gateway function, so every
agent action — a trade, a deposit, a theft — is the *same* Push-side call: the wallet calling
`sendUniversalTxOutbound`. To the permission engine they are indistinguishable. Everything the user cares
about lives inside the payload, two decode levels down. **URP is the contract that opens that payload.**

### Five contracts

| Contract | Role |
|---|---|
| `AGWFactory` (`src/`) | UUPS proxy. Deploys wallet clones at pre-computable addresses; the registry of record for "is this a real wallet, and who owns it?" There is no owner parameter: the owner is the caller, or the signer of an `OwnerIntent` (the `deployWalletWithSig(intent, sig, label)` form). |
| `AGW` (`src/`) | Holds funds. Minimal clone with 40 bytes of immutable args (owner 0–19, factory 20–39). Push Chain has no ERC-4337 EntryPoint, so the wallet does the EntryPoint's jobs itself. |
| `UniversalRulesPolicy` — URP (`src/policies/`) | The only novel contract and the security boundary. **Three rulebooks**, in normative order, fail closed: universal-EVM (gates 1–16), universal-SVM (S1–S18; S1–S10 restate gates 1–10, S11+ parse the Solana execute payload), and native/Push-side (nine gates). Which one runs is derived from the rules set's chain string, never from a flag anyone sets. Upgradeable behind a transparent proxy. |
| `AgentValidator` (`src/validators/`) | Stateless sender validator: the rules set's config is the agent's Push address; it confirms the sender the wallet wrote into the engine's signature field. Verifies no signature. |
| `SmartSession` (`lib/smartsessions/`) | Adopted unmodified. Stores rules sets, runs policies, deletes on revoke. The wallet's only installed module. |

### Naming

AGW follows the core/gateway naming standard (`docs-internal/sdk-first-changes/N-nomenclature_prd.md`):

- **"Rules", one word everywhere** — `grantRules`, `revokeRules`, `revokeAllRules`, `rulesId`, `RulesGranted`,
  `RulesRevoked`, `RulesActionAuthorized`, `RulesConfigured`, `RulesType`. `rulesId` is the engine's
  `permissionId` (`rulesId == permissionId`). "Mandate" is retired from code and docs.
- **Rename boundary:** ERC-7579 names (`execute`, `ModeCode`, module functions) and SmartSession names
  (`Session`, `PermissionId`, `PolicyData`, `ActionData`, `ConfigId`, `checkAction`,
  `initializeWithMultiplexer`, …) never change. Test function and test contract names never change.
- **Errors** live in `src/libraries/Errors.sol` — `AGWErrors`, `AGWFactoryErrors`, `UniversalRulesPolicyErrors`,
  `AgentValidatorErrors`; caller checks are `CallerIsNotX`. **Types** live in `src/libraries/Types.sol`.
- **Set-once wiring** is read through `UPPER_CASE()` getters: `SESSION_ENGINE()`, `RULES_POLICY()`,
  `SESSION_VALIDATOR()`, `UNIVERSAL_GATEWAY_PC()`. The deployment JSON keys keep their old names for tooling.
- **Interfaces** use numbered banners (`AGW_1: EVENTS` … `AGW_5: VIEWS`, `URP_1`–`URP_3`, `AGWF_1`–`AGWF_3`);
  `IAGW` declares the wallet's full external surface and `AGW is IAGW`.
- "URP" stays as the short form in comments and messages; test files are numbered by area (`test/unit/1_factory…`).

### Load-bearing invariants (each has a permanent test)

- **The two doors are the whole authority model.** `execute` (owner door) consults *exactly two things* —
  the immutable-args owner and calldata — and its only side effect besides the calls is one checkpoint
  write per call to the wallet's own slot 0, which cannot revert. No module, policy, engine state or flag
  may ever be read there; it must succeed with the engine uninstalled, a hostile validator installed, or
  ghost-rules state. Adding any check is the catastrophic regression. `executeAsAgent` (agent door) is
  callable only by the rules set's agent: the wallet checks `msg.sender == agentOf(rulesId)` and writes the
  sender into the engine's signature field, which the sender validator checks. The agent is a Push
  address — an EOA, or the UEA of an external key; the wallet verifies no signature, and replay is the
  sender's own nonce.
- **Checkpoints never tick from the agent door.** `_checkpoint` is called only from the two owner doors
  (once per call, before the call), `_grantRules`, `revokeRules` and `revokeAllRules` — never from
  `_execute`, which both doors share. Kinds are a frozen, append-only wire format.
- **Owner-intent doors are siblings, not extensions, of `execute`.** `executeWithSig` and
  `grantRulesWithSig` let a relayer (`intent.executor`) present an EIP-712 `OwnerIntent` signed by the
  owner — usually a UEA, which has no ERC-1271, so `OwnerAuthLib.isOwnerSig` tries
  `verifyUniversalPayloadSignature` first, then ERC-1271, via raw staticcalls that never revert. The domain
  is the **factory's**, shared by factory and wallets. These doors read storage (nonce lanes; the owner lane
  requires `OWNER_LANE_FLAG`), which is exactly why they cannot live in `execute`; `executeWithSig`
  duplicates `execute`'s mode switch deliberately rather than sharing it.
- **`execute(bytes32,bytes)` is a frozen signature.** The engine branches on this selector; any other shape
  routes validation to a path where URP's value gate sees a hardcoded zero instead of the real value.
- **`grantRules` enforces the canonical session shape and nothing else** — the skeleton, not the organs.
  Term validation is URP's own init guards. Its monotonic `_grantNonce` becomes the session salt, so every
  grant yields a distinct permission id that never recurs.
  **One exception, bounded:** the wallet decodes the policy envelope's `chain` string from each action's
  `initData` — *after* the policy-shape check has proven the policy is URP — solely to derive the
  rules set's mode and assert targets against it. It validates nothing else in the envelope; URP re-derives
  the same value from the same bytes and remains the sole judge of the terms.
  **The order is load-bearing and is pinned by two tests: count → shape → decode → derive.** Decoding
  before the shape check would read an arbitrary policy's data as though URP had authored it, and reading
  action 0 before the count check would index an empty array. The per-action shape check inside the native
  loop matters as much as the one before it — a rules set whose *third* action names a foreign policy would
  otherwise be granted with no URP gate on that action at all.
- **`revokeRules` / `revokeAllRules` must have nothing on them that can fail.** No guard, no probe, no extra
  external call. Blockable revocation is the one regression these functions can develop.
- **URP's `checkAction` makes no external calls.** It runs *before* the session validator is consulted, and
  must remain safe on arbitrary calldata (the wallet's own agent check precedes the engine, but URP does not
  rely on it); its safety rests on having no external calls, all effects last, and reverting on every
  failure. Do not wrap its `abi.decode` in `try/catch` to name an
  error — that introduces the external call the argument forbids.
- **Gate 12 (payload must be a multicall) is not a format check.** It confines the agent to the one CEA
  branch whose entries gates 13–16 can walk; the other branches bypass the allow-list, beneficiary pin and
  value cap entirely.
- **Gate 16's per-entry cap is in destination-chain native units** and is never compared against the
  Push-side `value` (gate 8). Conflating them is a real bug this design once carried.
- **A universal rules set lists 1..`MAX_ASSETS` tokens, and gate 5 checks the request's token on every
  request, zero amount included** (multi-asset branch). The gateway routes by the token, so the token is
  what pins the destination chain: every listed token is chain-checked at grant, an empty list is refused,
  and a zero-amount request naming an unlisted token is refused. Each token has its own caps and its own
  `spent`; "unlimited" is `type(uint256).max`, never 0. See `docs/multi-asset-review.md`.
- **The factory's derivation is frozen forever.** `_walletImplementation` is the append-only storage anchor
  with no setter; the salt formula and the 40-byte immutable-args encoding may never change, because
  counterfactual funding is a supported flow with no recovery path.

### Where the layers meet

- `SEND_OUTBOUND_SELECTOR` and `MULTICALL_SELECTOR` are declared **once**, in
  `src/libraries/Types.sol`, beside the struct mirrors they derive from. The wallet's grant-shape
  check and URP's request gate both read from there so they cannot disagree. `Types.sol` is the
  authoritative mirror of the gateway's frozen structs — reordering a field silently breaks the selector.
- URP's config is keyed `configId => multiplexer => account`. `ConfigId` already binds account and
  permission (see the derivation chain in URP's storage comment — note it mixes `abi.encode` and
  `abi.encodePacked` across levels; an SDK that assumes one throughout derives every id wrong). The middle
  level isolates *callers*: `msg.sender` on the two engine-driven entry points, the `SESSION_ENGINE`
  immutable everywhere else.
- The engine truncates policy revert data to 32 bytes and rewraps it as `PolicyCheckReverted(bytes32)`. Use
  `BaseTest.expectUrpGate(...)` so negative tests name *which* gate fired; never hand-encode this.
  **This applies to `checkAction` only.** `initializeWithMultiplexer` is a plain call from `ConfigLib`, so
  init reverts bubble with full data — assert `ChainMismatch`, `InvalidAsset` and `EmptyChain` with every
  argument, never through `expectUrpGate`.
- **Which rulebook a rules set uses is DERIVED, by both contracts, from one string.** Each action's URP
  `initData` is `abi.encode(uint16 version, string chainNamespace, bytes body)` — the same shape in every mode,
  which is what lets the chain be read before the mode is known. URP reads the version from the first word
  before decoding anything else and refuses anything but `ENVELOPE_VERSION` (`UnsupportedEnvelopeVersion`);
  the wallet decodes the same three fields but judges only the chain. The wallet hashes it and the engine hands URP the
  identical bytes, so both call `PushChainLib.deriveMode` and reach the same answer with nothing between
  them that can drift. There is no mode byte, no `RulesType` argument and no `PUSH_CHAIN_HASH` constant:
  `PushChainLib` computes this chain's identity from `block.chainid`, so there is nothing to configure and
  therefore nothing to configure wrongly. A near-miss string (`"EIP155:42101"`) derives the *other* mode
  and is refused against the action targets — the hash comparison is the whole rule, and the wallet
  deliberately does not parse, normalise or length-check the string.
  **For a UNIVERSAL rules set URP derives a second thing, the VM family:** `PushChainLib.deriveVm` reads the
  7-byte prefix (`eip155:` → EVM, `solana:` → SVM, anything else reverts `UnsupportedNamespace` at init).
  The result is stored on `ModeSlot.vm` and routes `checkAction` to `_checkUniversal` or `_checkSvm`. Mode
  still comes from the full hash; `deriveVm` is never asked about a native string.
- **Tests must pin `block.chainid`.** Foundry defaults to 31337, so the native chain string is
  `eip155:31337` unless a test calls `vm.chainId(42101)`. Native helpers build the string from
  `block.chainid`, never a literal.
- **`Config`, `SvmConfig` and `NativeConfig` are STORAGE types; `UniversalTerms`, `SvmTerms` and
  `NativeTerms` are the wire types.** URP storage is append-only — `_svm` took slot 7 and one `__gap` slot.
  The SDK encodes the latter. `Config` stores no chain — a rules set's chain lives on `ModeSlot.chainHash`,
  where it has been checked against every listed asset.
  `test_upgradeable_configStructLayoutIsFrozen` pins every member's label, slot, offset and type, because a
  struct inside a mapping never appears in the contract-level layout and can otherwise be reordered
  silently.

## Standing build rules

1. **One phase at a time.** Stop at the gate, report, wait for acknowledgement before proceeding.
2. **One contract per phase, its tests in the same phase.** No contract ships without its suite.
3. **The PRDs are locked.** A PRD error is *reported with evidence and waited on* — never fixed in place,
   never coded around. Never "fix" anything on a PRD's DO NOT FIX list; raise it instead.
4. **`src/libraries/` and `src/interfaces/` may change only via a diff proposed at the start of the phase
   that needs it.** Never edited opportunistically.
5. **Branch `pushAgenticWallet_v3`.** All build work lives there. **Zaryab alone commits and pushes** —
   prepare the change, report what is ready, print the commands; never run `git commit` or `git push`.
   Never commit `deployments/*.json`, `out/`, `cache/`, or `.env`.
6. **Never invent addresses, selectors or magic values.** Several are deploy-time inputs and marked as such.
7. **Say what you did not do.** Skipped, unverified or uncertain work is stated plainly, not presented as
   complete.
8. **Gate report format:** what was built · what was verified and how · what deviated and why · what you are
   unsure of · `forge test` and `forge build --sizes` output verbatim · the exact `forge --version` line.

## Standing test rules

1. **Every negative test names its expected error.** Two documented exceptions only: URP gate 4 case (d)
   (correct-length, malformed-offset body), which asserts "reverts" because it fails at an un-named
   `abi.decode` step, and the **malformed-envelope rejection test**.

   **The envelope exception, restated for `abi.encode(uint16 version, string chainNamespace, bytes body)`.**
   URP reads the version from the **first word** before decoding anything else, so on an **uninitialised**
   config almost every malformed or pre-version blob is refused **named** as
   `UnsupportedEnvelopeVersion(firstWord)`: a two-field `(string, bytes)` envelope reports 64, a bare struct
   32, a `(uint8, …)` header its leading byte. What stays **unnamed** at URP: blobs shorter than one word, a
   version-1 envelope whose body is the wrong `Terms` type for the derived mode (**owner-door-direct path
   only**), and an asset that *answers* `SOURCE_CHAIN_NAMESPACE()` with a non-string. **Through the wallet**
   the wallet decodes the envelope first and does not judge the version: an unsupported version reaches the
   owner named from URP, but a pre-version two-field envelope panics in the wallet's decode (`0x41`) before
   URP is reached — assert that panic, not a bare revert. On an **already-initialised** config every shape
   reverts `AlreadyInitialized` first, because the re-init guard precedes the decode. The property the tests
   assert is that each **reverts rather than mis-decoding**.

   **A bare `vm.expectRevert()` is permitted only where the revert genuinely carries no data, and
   only with an in-line justification saying so.** Before writing one, **grep the repo for the same
   assertion elsewhere** — twice now a bare form was written where the named form already existed in
   the same file (`test_W29_Native`, Block A §2.2; the native revoke in `8_e2e.t.sol`, Block B §2.1).
   A bare `expectRevert` on a revocation or authorisation claim passes on an out-of-gas, a signature
   failure or a nonce collision — the weakest assertion in the suite sitting on the strongest claim.
2. **A mock may be the OBSERVER, never the ORACLE.** A mock that supplies the behaviour under test can make
   a dead branch look live. That is how this repo's one shipped critical bug survived review: the Ed25519
   branch called the precompile through a typed interface, solc inserted an `extcodesize` check, precompiles
   have no code — so the branch reverted on the real chain while every test passed, because the tests etched
   bytecode at the precompile address. Whenever you etch or stub something, ask what the code would do
   against the real thing.
3. **Gas assertions carry a number.** "Within a sane budget" is not assertable; a test that cannot fail is
   worse than no test.
4. **Nothing marked ⚠️ NEVER-DELETE is deleted or weakened.** Test names are specification: keep the names
   given, add tests freely, rename nothing.
5. **Prefer artifact assertions over `vm.load` for structural claims.** Solidity offers no runtime way to
   prove "declares no storage"; `assertEmptyStorageLayout` and `assertSelectorSet` in `test/Base.t.sol` read
   solc's own output instead. Use those helpers — do not write second copies.

## Test harness

Every suite extends `BaseTest` (`test/Base.t.sol`), which deploys the real engine, validator, URP, wallet
implementation and an ERC-1967 factory proxy, then hands out wallets via `newWallet(owner)` — the real
`deployWallet` path, not a simulated factory. It also carries the canonical session builder, the outbound
request builder, the gate-naming helper, the agent-config helper and the call recorder. Test ids (`T-`, `W-`,
`U-`, `P-`, `S-`) come from the PRDs and appear in test names and comments.

## Toolchain pins (facts, not preferences)

- `solc 0.8.26` · `optimizer_runs = 833` · `evm_version = "cancun"` · `via_ir = true`
- OpenZeppelin 5.7.0 · forge-std 1.16.2 · SmartSession fork `7dc20e4`
- **forge: use STABLE, never nightly** (`foundryup -i stable`). Runtime bytecode is a function of
  solc + optimizer + via_ir + evm_version + metadata — all pinned in `foundry.toml` — so the forge binary
  does not change the sizes S-06 gates on. It does change how `--sizes` reports, how remappings resolve, and
  how `forge script` broadcasts, which is where a nightly actually bites. `foundry.toml` has no key for the
  driver version: **record the exact `forge --version` in every gate report.** That is the reproducibility
  mechanism — do not invent a config key for it.

  **Recorded at Gate 0 and still current:** `forge 1.5.1-stable`
  (`b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`, 2025-12-22). SmartSession runtime 22,581 B / +1,995 margin —
  byte-identical to the figure measured on 1.6.0-nightly, which is the evidence that the driver does not
  move bytecode.

**`optimizer_runs` and `evm_version` are load-bearing.** The vendored engine exceeds EIP-170 above ~833 runs
and becomes undeployable; `cancun` is required for `MCOPY` in URP's `_slice` helper. A local `anvil` deploy
will not catch the size problem — anvil does not enforce EIP-170.

`fs_permissions` grants read access to `out/` and write access to `deployments/`. Both are required, not
conveniences: the artifact-based storage-layout and selector-set assertions depend on the former.

## Layout

| Path | Contents |
|---|---|
| `src/` (root) | `AGW.sol`, `AGWFactory.sol` |
| `src/policies/` | `UniversalRulesPolicy.sol` (URP) |
| `src/validators/` | `AgentValidator.sol` |
| `src/interfaces/` | `IUniversalRulesPolicy`, `IAgentValidator`, `IAGWFactory`, `IAGW`, `IAGWInit`, `ISmartSessionConfigReader` (the one engine view upstream omits), gateway + module interfaces |
| `src/libraries/` | `Types.sol` (the policy's terms/config types, `RulesType`, `VmFamily`, `OwnerIntent` + EIP-712 typehashes, and the temporary gateway/core mirrors), `Errors.sol` (one error library per contract), `PushChainLib` (mode/VM derivation), `OwnerAuthLib` (owner-signature check shared by factory and wallet), `AgentConfigLib` (the one decoder of the agent config, shared by validator and wallet), `ModeLib`, `ExecutionLib` |
| `test/Base.t.sol` | Shared harness — every suite extends `BaseTest` |
| `test/unit/`, `test/integration/`, `test/mocks/` | Suites numbered by area (`1_factory` … `27_naming`), end-to-end flows, observers |
| `script/check-execute.sh`, `script/snapshot-execute.sh` | The `execute()` source pin and its advisory gas check |
| `demo/`, `demo-native/` | Cross-chain and Push-native demos — **frozen** against the deployed v1 contracts; own `justfile`, Foundry profile and `state/` ledger |
| `script/Deploy.s.sol` | The five-contract deployment, in dependency order |
| `deployments/` | `<chainId>.json` records — **never committed** |
| `_to_delete/` | v1/v2 code staged for deletion — **ignore entirely** |

## Build order (all phases complete)

| Phase | Deliverable |
|---|---|
| 0 | Baseline: build green, harness, size gate |
| 1 | `URP` |
| 2 | `AgentValidator` — `validateConfig` addition + full suite |
| 3 | `AGW` |
| 4 | `AGWFactory` |
| 5 | Integration + deploy script |
