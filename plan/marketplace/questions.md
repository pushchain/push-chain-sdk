# Agentic marketplace — questions for the contracts team

## 1. Which CEA deployments should the SDK and marketplace use?

The SDK and marketplace registry use different CEA factories on **Sepolia, Base Sepolia and Arbitrum Sepolia**. They derive different wallet addresses, so the SDK blocks opening jobs with `CEA_MISMATCH`. BSC Testnet matches and works.

**Please confirm the canonical CEA factory and proxy implementation for each chain, and whether SDK routing or the marketplace registry needs updating.**

[Current address comparison](implementation-status.md#destination-rollout-mismatch)

## 2. Which JobSpec/evaluator version should the SDK target?

We checked `feat/universal-evaluator@46e7902` and the Notion-linked `8059817`. Neither JobSpec format matches the deployed marketplace. The live marketplace still uses a manual EOA evaluator, so `client.job.verify` remains disabled.

**Please confirm the target JobSpec commit and share compatible marketplace/hook/evaluator deployment addresses and ABIs for Push Donut.**

[Branch comparison and existing verification/retry APIs](research/evaluator-branch-2026-10-26/README.md)
