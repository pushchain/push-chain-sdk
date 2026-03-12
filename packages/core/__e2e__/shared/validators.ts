import { UniversalTxResponse } from '../../src/lib/orchestrator/orchestrator.types';

/**
 * Comprehensive transaction response validator.
 * Extracted from pushchain.spec.ts.
 */
export const txValidator = async (
  tx: UniversalTxResponse,
  from: string,
  to: `0x${string}`
) => {
  expect(tx).toBeDefined();

  // 1. Identity fields
  expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  expect(tx.origin).toBeDefined();
  expect(tx.origin).toMatch(
    /^[a-zA-Z0-9_-]+:[a-zA-Z0-9]+:(0x[a-fA-F0-9]{40,64}|[1-9A-HJ-NP-Za-km-z]{43,44})$/
  ); // Format: namespace:chainId:address (supports both EVM and Solana)

  // 2. Block Info
  expect(typeof tx.blockNumber).toBe('bigint');
  expect(tx.blockNumber).toBeGreaterThanOrEqual(BigInt(0));
  expect(typeof tx.blockHash).toBe('string');
  expect(typeof tx.transactionIndex).toBe('number');
  expect(typeof tx.chainId).toBe('string');

  // 3. Execution Context
  expect(tx.to?.toLowerCase()).toBe(to.toLowerCase());
  expect(tx.origin.split(':')[2].toLowerCase()).toBe(from.toLowerCase());
  // Always validate that from and to exist and are strings
  expect(tx.from).toBeDefined();
  expect(typeof tx.from).toBe('string');
  if (tx.to) {
    expect(typeof tx.to).toBe('string');
  }
  expect(typeof tx.nonce).toBe('number');

  // 4. Payload
  expect(typeof tx.data).toBe('string');
  expect(tx.data).toMatch(/^0x/);
  expect(typeof tx.value).toBe('bigint');

  // 5. Gas-related
  expect(typeof tx.gasLimit).toBe('bigint');
  expect(tx.gasLimit).toBeGreaterThanOrEqual(BigInt(0));

  if (tx.maxFeePerGas !== undefined) {
    expect(typeof tx.maxFeePerGas).toBe('bigint');
    expect(tx.maxFeePerGas >= BigInt(0)).toBe(true);
  }

  if (tx.maxPriorityFeePerGas !== undefined) {
    expect(typeof tx.maxPriorityFeePerGas).toBe('bigint');
    expect(tx.maxPriorityFeePerGas >= BigInt(0)).toBe(true);
  }

  expect(Array.isArray(tx.accessList)).toBe(true);

  // 6. Utilities
  expect(typeof tx.wait).toBe('function');

  // 7. Metadata
  expect(typeof tx.type).toBe('string');
  expect(['99', '2', '1', '0']).toContain(tx.type); // Universal, EIP-1559, EIP-2930, Legacy

  expect(typeof tx.typeVerbose).toBe('string');
  expect(['universal', 'eip1559', 'eip2930', 'eip4844', 'legacy']).toContain(
    tx.typeVerbose
  );

  // Signature object validation
  expect(tx.signature).toBeDefined();
  expect(typeof tx.signature.r).toBe('string');
  expect(typeof tx.signature.s).toBe('string');
  expect(typeof tx.signature.v).toBe('number');
  expect(typeof tx.signature.yParity).toBe('number');
  expect(tx.signature.r).toMatch(/^0x[a-fA-F0-9]+$/);
  expect(tx.signature.s).toMatch(/^0x[a-fA-F0-9]+$/);
  expect([0, 1]).toContain(tx.signature.yParity);

  // 8. Raw Universal Fields (optional)
  if (tx.raw) {
    expect(typeof tx.raw.from).toBe('string');
    expect(typeof tx.raw.to).toBe('string');
    expect(typeof tx.raw.nonce).toBe('number');
    expect(typeof tx.raw.data).toBe('string');
    expect(typeof tx.raw.value).toBe('bigint');
  }

  // Optional: Wait for receipt and confirm it's mined
  const receipt = await tx.wait();
  expect(receipt).toBeDefined();
  expect(receipt.hash).toBe(tx.hash); // Same transaction
  expect(receipt.blockNumber).toBeGreaterThan(BigInt(0));
};
