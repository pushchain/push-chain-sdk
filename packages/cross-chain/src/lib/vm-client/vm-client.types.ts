import { Abi } from 'viem';
import { UniversalSigner } from '../universal/universal.types';

/**
 * Common options used by all VM clients (EVM, SVM, etc.)
 */
export interface ClientOptions {
  rpcUrl: string;
}

/**
 * Parameters for reading from a smart contract (read-only call).
 */
export interface ReadContractParams {
  address: string; // VM clients will cast as needed (e.g., `0x` for EVM, base58 for SVM)
  abi: readonly string[];
  functionName: string;
  args?: any[];
  value?: bigint; // value in ether
}

/**
 * Parameters for writing to a smart contract (requires signature).
 */
export interface WriteContractParams extends ReadContractParams {
  signer: UniversalSigner;
}
