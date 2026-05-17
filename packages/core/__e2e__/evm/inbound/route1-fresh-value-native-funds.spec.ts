import '@e2e/shared/setup';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const masterPrivateKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const skipE2E = !masterPrivateKey;

describe('Route 1: fresh UOA value + native funds regression', () => {
  it('bridges Sepolia ETH as funds and parks requested PC value in the fresh UEA', async () => {
    if (skipE2E) {
      console.log('Skipping — EVM_PRIVATE_KEY not set');
      return;
    }

    const rpcUrl = CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0];
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const masterAccount = privateKeyToAccount(masterPrivateKey);
    const masterWallet = createWalletClient({
      account: masterAccount,
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const freshPrivateKey = generatePrivateKey();
    const freshAccount = privateKeyToAccount(freshPrivateKey);
    console.log(`Fresh Sepolia UOA: ${freshAccount.address}`);

    const fundTxHash = await masterWallet.sendTransaction({
      to: freshAccount.address,
      value: parseEther('0.07'),
      account: masterAccount,
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTxHash });
    console.log(`Funded fresh UOA: ${fundTxHash}`);

    const freshWallet = createWalletClient({
      account: freshAccount,
      chain: sepolia,
      transport: http(rpcUrl),
    });

    const universalSigner =
      await PushChain.utils.signer.toUniversalFromKeypair(freshWallet, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

    const pushClient = await PushChain.initialize(universalSigner, {
      network: PUSH_NETWORK.TESTNET_DONUT,
      rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: [rpcUrl] },
      printTraces: true,
    });

    const uea = pushClient.universal.account as `0x${string}`;
    console.log(`Fresh UEA: ${uea}`);

    const progressEvents: ProgressEvent[] = [];
    const txResponse = await pushClient.universal.sendTransaction(
      {
        to: uea,
        value: PushChain.utils.helpers.parseUnits('20', 18),
        funds: {
          amount: PushChain.utils.helpers.parseUnits('0.001', 18),
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      {
        progressHook: (event: ProgressEvent) => {
          progressEvents.push(event);
          console.log(`[${event.id}] ${event.title}`);
        },
      }
    );

    console.log(`Push tx hash: ${txResponse.hash}`);
    expect(txResponse.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await txResponse.wait();
    console.log(`Receipt status: ${receipt.status}`);
    expect(receipt.status).toBe(1);
    expect(progressEvents.some((event) => event.id === 'SEND-TX-199-01')).toBe(true);
  }, 600000);
});
