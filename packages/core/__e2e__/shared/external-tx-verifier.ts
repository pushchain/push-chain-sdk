import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { CHAIN, VM } from '../../src/lib/constants/enums';
import bs58 from 'bs58';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5_000;

/**
 * Sleeps for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verifies an EVM transaction succeeded on the external chain by querying
 * `eth_getTransactionReceipt` via the chain's default RPC.
 */
async function verifyEvmTransaction(
  txHash: string,
  chain: CHAIN
): Promise<void> {
  const rpcUrl = CHAIN_INFO[chain].defaultRPC[0];
  const chainName = String(chain);

  console.log(
    `[ExternalTxVerifier] Verifying EVM tx on ${chainName}: ${txHash}`
  );

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [txHash],
        }),
      });

      const json = (await response.json()) as {
        result?: { status: string } | null;
        error?: { message: string };
      };

      if (json.error) {
        throw new Error(
          `RPC error: ${json.error.message}`
        );
      }

      if (!json.result) {
        throw new Error(
          `Transaction receipt not found (attempt ${attempt}/${RETRY_ATTEMPTS})`
        );
      }

      const status = json.result.status;
      console.log(
        `[ExternalTxVerifier] EVM tx ${txHash} on ${chainName}: status=${status}`
      );

      expect(status).toBe('0x1');
      console.log(
        `[ExternalTxVerifier] EVM tx CONFIRMED SUCCESS on ${chainName}`
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_ATTEMPTS) {
        console.log(
          `[ExternalTxVerifier] Attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `[ExternalTxVerifier] Failed to verify EVM tx ${txHash} on ${chainName} after ${RETRY_ATTEMPTS} attempts: ${lastError?.message}`
  );
}

/**
 * Verifies a Solana transaction succeeded on the external chain by querying
 * `getTransaction` via the chain's default RPC.
 *
 * The `txHash` from the SDK receipt is hex-encoded (0x-prefixed).
 * Solana RPC expects a base58-encoded signature.
 */
async function verifySvmTransaction(
  txHash: string,
  chain: CHAIN
): Promise<void> {
  const rpcUrl = CHAIN_INFO[chain].defaultRPC[0];
  const chainName = String(chain);

  // Convert 0x-prefixed hex to base58 for Solana RPC
  let signature = txHash;
  if (txHash.startsWith('0x')) {
    const bytes = Buffer.from(txHash.slice(2), 'hex');
    signature = bs58.encode(bytes);
  }

  console.log(
    `[ExternalTxVerifier] Verifying SVM tx on ${chainName}: ${signature}`
  );

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [
            signature,
            { encoding: 'json', maxSupportedTransactionVersion: 0 },
          ],
        }),
      });

      const json = (await response.json()) as {
        result?: { meta?: { err: unknown } } | null;
        error?: { message: string };
      };

      if (json.error) {
        throw new Error(
          `RPC error: ${json.error.message}`
        );
      }

      if (!json.result) {
        throw new Error(
          `Transaction not found (attempt ${attempt}/${RETRY_ATTEMPTS})`
        );
      }

      const err = json.result.meta?.err;
      console.log(
        `[ExternalTxVerifier] SVM tx ${signature} on ${chainName}: meta.err=${JSON.stringify(err)}`
      );

      expect(err).toBeNull();
      console.log(
        `[ExternalTxVerifier] SVM tx CONFIRMED SUCCESS on ${chainName}`
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_ATTEMPTS) {
        console.log(
          `[ExternalTxVerifier] Attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`
        );
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `[ExternalTxVerifier] Failed to verify SVM tx ${signature} on ${chainName} after ${RETRY_ATTEMPTS} attempts: ${lastError?.message}`
  );
}

/**
 * Verifies that an outbound transaction succeeded on the external chain.
 * Dispatches to EVM or SVM verifier based on the chain's VM type.
 *
 * @param txHash - The external transaction hash (hex for both EVM and SVM)
 * @param chain  - The target CHAIN enum value
 */
export async function verifyExternalTransaction(
  txHash: string,
  chain: CHAIN
): Promise<void> {
  const vm = CHAIN_INFO[chain]?.vm;

  if (vm === VM.SVM) {
    await verifySvmTransaction(txHash, chain);
  } else {
    await verifyEvmTransaction(txHash, chain);
  }
}
