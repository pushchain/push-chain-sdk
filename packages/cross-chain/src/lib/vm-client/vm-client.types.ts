import { UniversalSigner } from '../universal/universal.types';
import { Abi } from 'viem';
import { Keypair, PublicKey } from '@solana/web3.js';

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
  /**
   * EVM contract address
   * SVM program id
   */
  address: string;
  /**
   * EVM abi
   * SVM idl
   */
  abi: Abi | any;
  /**
   * EVM contract fn name
   * SVM PDA var name
   */
  functionName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * EVM fn vars
   * SVM - undefined
   */
  args?: any[];
}

/**
 * Parameters for writing to a smart contract (requires signature).
 */
export interface WriteContractParams extends ReadContractParams {
  value?: bigint; // value in ether
  signer: UniversalSigner;
  /**
   * **For Solana only** Dynamic accounts to pass to the solana program instruction
   */
  accounts?: Record<string, PublicKey>;
  /**
   * **For Solana only** Keypairs that should sign the transaction
   */
  extraSigners?: Keypair[];
}
