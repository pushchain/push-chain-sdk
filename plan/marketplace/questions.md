# Agentic marketplace — questions for the contracts team

## 1. Which CEA deployments should the SDK and marketplace use?

The SDK and marketplace registry use different CEA factories on **Sepolia, Base Sepolia and Arbitrum Sepolia**. They derive different wallet addresses, so the SDK blocks opening jobs with `CEA_MISMATCH`. BSC Testnet matches and works.

**Please confirm the canonical CEA factory and proxy implementation for each chain, and whether SDK routing or the marketplace registry needs updating.**

[Current address comparison](implementation-status.md#destination-rollout-mismatch)

## 2. When will the compatible marketplace/evaluator stack be available on Push Donut?

Nilesh confirmed `feat/universal-evaluator-pre-post-reads` ([contracts PR #132](https://github.com/pushchain/push-chain-core-contracts/pull/132)) as the current branch. The SDK can implement against this source; the existing Donut marketplace uses a different JobSpec format and a manual evaluator.

**Please share the rollout commit and addresses for the compatible marketplace, hook and evaluator on Push Donut.**

[Checked source and SDK migration scope](research/evaluator-pre-post-2026-10-26/README.md)
