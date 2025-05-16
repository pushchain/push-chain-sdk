import { Orchestrator } from './orchestrator';
import { CHAIN, NETWORK } from '../constants/enums';
import { UniversalSigner } from '../universal/universal.types';
import {
  bytesToHex,
  createWalletClient,
  defineChain,
  Hex,
  hexToBytes,
  http,
  parseEther,
  parseTransaction,
} from 'viem';
import { CHAIN_INFO } from '../constants/chain';
import { privateKeyToAccount } from 'viem/accounts';

describe('Orchestrator', () => {
  const chain = CHAIN.ETHEREUM_SEPOLIA;
  const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;

  if (!PRIVATE_KEY) {
    throw new Error('Private key not Found');
  }

  const account = privateKeyToAccount(PRIVATE_KEY);
  const walletClient = createWalletClient({
    account,
    chain: defineChain({
      id: parseInt(CHAIN_INFO[chain].chainId),
      name: chain,
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
      },
      rpcUrls: {
        default: {
          http: [CHAIN_INFO[chain].defaultRPC],
        },
      },
    }),
    transport: http(),
  });
  const universalSigner: UniversalSigner = {
    address: account.address,
    chain,
    signMessage: async (data: Uint8Array) => {
      const hexSig = await walletClient.signMessage({
        message: { raw: data },
      });
      return hexToBytes(hexSig);
    },
    signTransaction: async (unsignedTx: Uint8Array) => {
      const tx = parseTransaction(bytesToHex(unsignedTx));
      const txHash = await walletClient.signTransaction(tx as never);
      return hexToBytes(txHash);
    },
  };

  const orchestrator = new Orchestrator(universalSigner, NETWORK.TESTNET);

  it('should estimate fee for a basic tx', async () => {
    const fee = await orchestrator['estimateFee']({
      target: '0xD8634C39BBFd4033c0d3289C4515275102423681',
      value: parseEther('0.1'),
      data: '0x',
    });

    // TODO: change to greater than 0 always
    expect(fee).toBeGreaterThanOrEqual(BigInt(0));
  });

  it('should return NMSC balance', async () => {
    const balance1 = await orchestrator['checkNMSCBalance'](
      '0x35B84d6848D16415177c64D64504663b998A6ab4'
    );
    expect(balance1).toBeGreaterThan(BigInt(0));

    const balance2 = await orchestrator['checkNMSCBalance'](
      '0x35B84d6848D16415177c64D64504663b998A6cb4'
    );
    expect(balance2).toBe(BigInt(0));
  });

  it('should successfully send funds to locker contract', async () => {
    const txHash = await orchestrator['lockFee'](parseEther('0.0001'));
    console.log('lockFee txHash:', txHash);
    expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
