# Preset permission defaults — October 18, 2026

> Intermediate stage. Final funding behavior, commits and release checks are recorded in [release readiness](../preset-release-readiness-2026-10-18/README.md).

User authorization: after confirming the SDK can supply spending caps, gas ceilings and expiry centrally, the user requested implementation. This supersedes the earlier pending-policy notes. Changes remain local on feat/agw-sdk-v4; no commit, push, package publication or live transaction is part of this task.

## Delivered policy

Omitted assets selects the curated tokens and explicit caps: stablecoins 10 per call / 100 cumulative Push outbound; ETH/WETH/stETH/wstETH 0.001 / 0.01; WBNB 0.01 / 0.1; LINK 1 / 10. Values are fixed token quantities, not USD equivalents. Every token is matched by chain and address; no symbol-based or unknown-token inference runs in production.

Omitted validUntil becomes seven days from the current get call, computed once for all returned rules. Omitted maxGasPerCall uses an explicit chain profile, currently 20 PC for the eight catalog EVM chains. This is an URP value ceiling, not an actual fee or guaranteed sufficient quote. Testnet protocol flows previously used this ceiling; mainnet policy templates have no funded execution acceptance. Each send still obtains a fresh quote and is subject to contract policy and wallet funds.

An agent alone now narrows the get result to Rule[]. The existing editable-template type remains compatible. The get API stays synchronous and performs no token metadata, price or quote fetch. Missing identity remains an actionable readiness issue. PREDICTION remains empty and no Solana preset is introduced.

Explicit assets replaces all selected-chain defaults. Omitted caps inside explicit assets still mean zero. Explicit gas zero stays zero, and explicit expiry is validated/preserved. These defaults do not alter ordinary rules, produce unlimited allowances, aggregate destination batches or meter destination lifetime spend. A new default token without a reviewed budget fails instead of receiving a guessed policy.

## Evidence

- Read-only RPC metadata checks covered 25 unique chain/token pairs across eight networks. Network, block and symbol/decimals are in token-metadata.json. No account/credential access was needed.
- Compiled policy compared against all 25 RPC metadata entries: metadata-comparison.json. BNB mainnet USDT uses 18 decimals; BSC testnet USDT uses 6.
- Focused preset tests: 72 passed.
- Full units: 2,129 passed, 12 skipped, no failures.
- Actual pinned v6 local AGW/URP/engine suite: 18 passed. Default DEX gas and expiry survive grant/read; amount above the generated policy MAX is rejected by the contract even after bridge budgets are edited. Gateway/core/token/origin metadata remain local fixtures; these are not destination-protocol execution tests.
- Build, spec and local typechecks pass. Six guide TypeScript examples and package CJS/ESM/declaration/import checks pass. Compiled API matches source; production policy and new policy tests have no lint errors/warnings.
- Existing funded E2E scenarios now assert the default configuration and then apply their small fixture-specific execution caps. They were typechecked, not broadcast again.

## Execution prerequisites remain

Configuration readiness is not full execution readiness. An offline Donut registry check (registry.json) found only 1 of 33 category/chain/token entries mapped; this count includes mainnet templates, which Donut does not support, and duplicate assets across categories. This is mapping evidence only, not an on-chain source-identity check or proof all unmapped tokens are deployable.

Most testnet protocol mock/wrapped tokens have no usable current SDK PRC20 mapping. The earlier live tests therefore prefunded destination accounts and granted the generated call constraints with bridge assets empty. The SDK cannot silently drop a default asset or pretend a different token has the same source identity. Passing unmodified generated default assets into create can fail preparation when those mappings are unavailable. The user must have a supported token route or use the documented destination-only grant workflow. Further bridge-token coverage depends on actual supported assets/deployments and registry validation, not permission-policy constants.
