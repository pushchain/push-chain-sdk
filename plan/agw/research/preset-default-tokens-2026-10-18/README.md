# Automatic preset tokens — October 18, 2026

> Intermediate stage. Final funding behavior, commits and release checks are recorded in [release readiness](../preset-release-readiness-2026-10-18/README.md).

Riyanshu clarified that presets must provide token selections per network. SDK-only changes are local on feat/agw-sdk-v4; nothing is committed, pushed or published by this change.

## Behavior

- Omitted assets includes curated destination tokens per chain for DEXES, LENDING and STAKING. PREDICTION remains empty.
- DEX includes the complete pair, both directions, exact-input/output constraints and spender-pinned approvals.
- Lending defaults are protocol-specific, including testnet reserve/mock addresses rather than unrelated DEX tokens.
- Every default expansion stays within 8 assets, 32 calls and 32 pins. Base/BNB mainnet lending uses a shared market/reserve token to fit; other markets remain selectable explicitly. The complete Aave reserve list is not selected automatically.
- Explicit assets replaces defaults across all returned chains, including [] or a list limited to one chain. No tokens are appended to explicit selections.
- Returned defaults and metadata cannot mutate subsequent results.
- KnownTokens includes the default subset, including DEX pairs.

Source selection reuses the reviewed October 15 catalog, Aave reserve snapshots and live protocol fixtures. See default-tokens.ts and the network/token table in packages/core/AGW.md. No new address freshness/liquidity guarantee is made.

## Remaining permission-policy decision

Tokens are now preselected, but caps retain the existing zero default. No spending, PC gas budget or expiry is invented. These templates are disabled until a permission policy is applied via get with capped assets. UI can use the SDK-provided selections without asking users to choose tokens per chain; fully automatic execution still needs approved positive caps, a gas budget and expiry.

Suggested 10 USDC per call, 100 USDC cumulative Push-outbound and 7-day expiry are proposals only. Per-token values/decimals and chain-specific gas budgets need agreement. These numbers are not implemented and are not equivalent to a destination lifetime/batch cap.

## Verification

- 62 focused preset tests pass.
- Full unit suite: 2,119 passed, 12 skipped, no failures.
- Local pinned v6 AGW/URP/engine suite: 18 passed. Default DEX token constraints reject positive input under zero MAX even if bridge asset budgets are edited; explicit empty-list preview/regeneration remains covered.
- Build, spec/local typechecks, 6 guide TypeScript blocks and package CJS/ESM/declaration/import checks pass.
- Source/compiled API comparison matches. Lint has no errors; test non-null assertion warnings remain.
- Existing live Sepolia DEX/Aave scenarios now check the default token lists; Aave regenerates its executable rule from returned tokens. They were typechecked, not broadcast again.

The first local invocation failed setup because its previous temporary build directory had been removed. Rebuilt the pinned ffd567d contracts in /tmp/agw-preset-defaults-v6 using the existing prepare script; the actual local suite then passed. No contract checkout was modified and no live E2E was started.
