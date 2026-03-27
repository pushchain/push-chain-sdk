import { createWalletClient, http, Hex } from 'viem';
import {
  privateKeyToAccount,
  PrivateKeyAccount,
} from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';

export interface EvmClientSetupOptions {
  chain: CHAIN;
  privateKey: Hex;
  network?: PUSH_NETWORK;
  progressHook?: (val: any) => void;
  printTraces?: boolean;
  rpcUrls?: Record<string, string[]>;
}

export interface EvmClientSetupResult {
  pushClient: PushChain;
  account: PrivateKeyAccount;
  walletClient: ReturnType<typeof createWalletClient>;
}

/**
 * Creates a PushChain client from an EVM private key on a given origin chain.
 * Replaces the ~15-line beforeAll boilerplate found in every EVM test.
 */
export async function createEvmPushClient(
  opts: EvmClientSetupOptions
): Promise<EvmClientSetupResult> {
  const account = privateKeyToAccount(opts.privateKey);
  const walletClient = createWalletClient({
    account,
    transport: http(CHAIN_INFO[opts.chain].defaultRPC[0]),
  });

  const universalSigner =
    await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
      chain: opts.chain,
      library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
    });

  const pushClient = await PushChain.initialize(universalSigner, {
    network: opts.network ?? PUSH_NETWORK.TESTNET_DONUT,
    printTraces: opts.printTraces,
    progressHook: opts.progressHook,
    ...(opts.rpcUrls ? { rpcUrls: opts.rpcUrls } : {}),
  });

  return { pushClient, account, walletClient };
}
