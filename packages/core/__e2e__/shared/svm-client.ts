import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';

export interface SvmClientSetupOptions {
  privateKeyBase58: string;
  chain?: CHAIN;
  network?: PUSH_NETWORK;
  progressHook?: (val: any) => void;
}

export interface SvmClientSetupResult {
  pushClient: PushChain;
  keypair: Keypair;
}

/**
 * Creates a PushChain client from a Solana private key.
 */
export async function createSvmPushClient(
  opts: SvmClientSetupOptions
): Promise<SvmClientSetupResult> {
  const keypair = Keypair.fromSecretKey(bs58.decode(opts.privateKeyBase58));

  const universalSigner =
    await PushChain.utils.signer.toUniversalFromKeypair(keypair, {
      chain: opts.chain ?? CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });

  const pushClient = await PushChain.initialize(universalSigner, {
    network: opts.network ?? PUSH_NETWORK.TESTNET_DONUT,
    progressHook: opts.progressHook,
  });

  return { pushClient, keypair };
}
