# Preset alpha release readiness — October 18, 2026

Source commit: v4 `2d16bfe0`; equivalent v5 `83f9a713`. V5 keeps its existing 6.0.27-alpha.2 version/changelog/lockfile. Publication remains the user's manual workflow action. No package was published or workflow dispatched by this work.

## Shipped behavior

- Curated tokens, explicit modest raw-unit caps, 20 PC value ceiling and seven-day expiry. Explicit overrides/zeros are preserved. General rules and supplied-asset missing caps remain zero.
- Funding defaults to Push: unmapped assets stay in the output and yield BRIDGE_ASSET_UNAVAILABLE instead of a misleading ready result. Unsupported gateway destinations and unadvertised AGW networks are reported separately.
- Explicit destination funding returns rules with empty bridge assets and unchanged token/call constraints. Selected tokens/limits remain visible in readiness.chains[].selectedAssets. These rules grant no Push token-export budget and require destination balances already funded.
- ConfigurationReady is separate from Ready: Ready additionally requires offline release-network, destination and registry support for the selected mode. It is not a live balance/liquidity/current-chain guarantee. Mainnet templates remain discoverable and unavailable for Donut execution.
- Sepolia WETH/stETH registry resolutions now use already-deployed mappings, verified by exact chain/source identity. EVM casing is normalized without changing case-sensitive Solana matching. Explicit mainnet references cannot alias a Sepolia source. String and address-word PRC20 source metadata are supported.
- No source token, route or deployment was invented; unavailable mocks/Circle tokens are not aliased to same-symbol registered tokens.

## Verification

| Check | Result |
| --- | --- |
| Full unit suite | 2,142 passed, 12 skipped, no failures |
| Actual v6 local policy suite | 21 passed; includes direct get → create for destination-funded DEX/lending/staking without rewriting the rules |
| Donut factory simulations | 9/9 destination-funded testnet preset cases passed, including preparation, CEA lookup and index-bound create calldata |
| Source identity | WETH and stETH resolutions verified against actual PRC20 metadata |
| Build / spec and local typechecks | Passed |
| Guide | Six TypeScript blocks typechecked |
| API comparison | Compiled matches source |
| Production lint | No errors/warnings in changed production modules |
| Package | CJS/ESM imports and declaration examples pass; no plan/E2E/local-harness/scripts/.env folders in npm contents; built preset smoke checks pass |
| V5 | Build/package checks pass; core sources identical to v4 except preserved package version and changelog |
| V5 immutable install | Passed in an isolated workspace copied from release manifests/lockfile; builds skipped. Existing peer/optional TypeScript patch warnings remain, no lockfile rewrite |

Donut read-only evidence pins block 24381571 and factory 0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc. The checker initializes a read-mode UniversalAccount with no key. Calls are RPC reads and eth_call; simulated wallet deployments/grants are transient, not broadcasts. Reports are acceptance.json and routes.json. The initial standalone checker had a wrong relative build path and used a non-exported enum import; both were corrected before these final passing results.

No funded live E2E was repeated for this release. Previous Aave/EigenLayer/BNB live flows remain historical execution evidence, with fresh Base/Moonwell acceptance incomplete at the user's stop request. Nine factory simulations establish default grant acceptance, not actual cross-chain settlement/protocol execution, funding, reserves or liquidity.

## UI handoff

Use presets.get(category, { agent, chainNamespace, funding: 'destination' }) for prefunded destination execution. Display selectedAssets as token permissions; returned rules.assets is Push bridge authority and intentionally empty in that mode. Check readiness.ready and show issues. Use default Push mode only with registered, verified source routes. Missing routes and mainnet execution remain external availability limits, not reasons to invent registry entries.

The repository read-only checker is packages/core/scripts/check-agw-preset-routes.js. It runs against built artifacts, never loads keys, and is excluded from the npm package. Publishing remains manual; select feat/agw-sdk-v5 and an alpha release.

## CI repair and complete unfunded command

The first pushed workflow was rejected before starting jobs: runner.temp was used at job-level env where that context is unavailable. Actionlint reproduced the exact diagnostic; moving the value to step env validates. The checkout was also still pinned to 2e61e1 while the harness defaults to deployed v6 ffd567d. Both were aligned. Workflow fix commits: v4 089a0b51 / v5 21857417. GitHub's [context availability reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) confirms the distinction.

Once jobs could start, GitHub's hardened public-PR install exposed two pre-existing invalid merged lock descriptors: babel-plugin-macros ^3.1.0 resolving to 2.8.0, and commander ^4.0.0 resolving to 13.1.0. Kept the older versions for their compatible consumers, split the incompatible descriptors and regenerated through Yarn with hardened mode enabled. Yarn resolved macros 3.1.0, commander 4.1.1 and their required transitive entries. V4 5eee8bbb and v5 66dc81f8 contain the correction; hardened checking stays enabled in CI. V5 preserves its alpha.2 workspace/version-specific resolution. Clean hardened immutable install passed against the exact v5 lock. The earlier ordinary immutable-install result did not exercise public-PR hardened validation.

The full repository agw-verify.js command also passed locally: 417 focused units, all three typechecks, docs, pinned contract preparation, **107 real local contract tests across 13 suites**, build, package and public API checks. This broadens the earlier 21-test subset. The command loads no .env, broadcasts no transactions and invokes no publish action. Full unit coverage separately remains 2,142 passed / 12 skipped.

## User-requested lighter CI

The user clarified that CI is lower priority and should be faster. V4 6108348f / v5 b291b873 switches PR validation to agw-verify.js --sdk-only: **421 focused units**, spec typecheck, build (including library types) and compiled package/guide checks. This command passed locally. It skips the external contract checkout, Foundry setup/compilation, full contract suites, duplicate standalone guide check and full API comparison. Full unit coverage separately remains 2,142 and all local contracts separately passed 107.

The full unfunded path remains manual via workflow_dispatch with contracts=true. Yarn package archives are cached; hardened immutable install remains enabled. The fresh hosted full run passed installation, units, types and docs but failed at contract preparation; its hidden artifact folder was not uploaded, so the exact nested error was not available. Added failed-command output to the console, enabled upload of the explicit validation folder, and allowed downloading the pinned compiler on fresh manual CI runners. Default local preparation remains offline. The manual fresh-run path is not represented as remotely passing; local full verification passed. No funded run or publish was dispatched.

Publishing the next alpha is based on the completed local tests, 9/9 read-only factory simulations, package checks and hardened v5 lock validation. We are not waiting on the optional heavy CI job at the user's request. Publishing remains the user's manual action from feat/agw-sdk-v5.
