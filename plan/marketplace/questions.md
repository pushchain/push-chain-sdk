# Agentic marketplace — questions for the contracts team

## 1. Which CEA deployments should the SDK and marketplace use?

The SDK and marketplace registry use different CEA factories on **Sepolia, Base Sepolia and Arbitrum Sepolia**. They derive different wallet addresses, so the SDK blocks opening jobs with `CEA_MISMATCH`. BSC Testnet matches and works.

**Please confirm the canonical CEA factory and proxy implementation for each chain, and whether SDK routing or the marketplace registry needs updating.**

[Current address comparison](implementation-status.md#destination-rollout-mismatch)

## 2. Which JobSpec format and evaluator should the SDK integrate?

The deployed marketplace uses a manual EOA evaluator. Its JobSpec format is incompatible with the linked evaluator implementation, including field order and enum values. `client.job.verify` is therefore disabled.

**Please provide:**

- The final shared JobSpec Solidity definition or commit.
- Compatible hook/evaluator deployment addresses and ABIs for Push Donut.
- The public function signatures the SDK should call to verify and retry evaluation.
