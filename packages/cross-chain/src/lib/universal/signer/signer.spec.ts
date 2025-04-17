import { createUniversalSigner, toUniversal } from './signer';
import { CHAIN } from '../../constants/enums';
import { createWalletClient, http } from 'viem';
import { UniversalSigner } from '../universal.types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

describe('createUniversalSigner', () => {
  it('creates a valid UniversalSigner with chain info', () => {
    const dummySigner: UniversalSigner = {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97',
      signMessage: async (data: Uint8Array) => new Uint8Array([...data, 1]),
      signTransaction: async (tx: Uint8Array) => new Uint8Array([...tx, 2]),
    };

    const signer = createUniversalSigner(dummySigner);

    expect(signer.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(signer.address).toBe('0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97');
    expect(typeof signer.signMessage).toBe('function');
    expect(typeof signer.signTransaction).toBe('function');
  });
});

describe('toUniversalSigner', () => {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
  });

  it('wraps a viem WalletClient into a UniversalSigner', async () => {
    const signer = await toUniversal(client, CHAIN.ETHEREUM_SEPOLIA);

    expect(signer.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect(signer.address).toBe(account.address);

    // signMessage test
    const msg = new TextEncoder().encode('gm wagmi');
    const sig = await signer.signMessage(msg);
    expect(typeof sig).toBe('object'); // Uint8Array
    expect(sig).toBeInstanceOf(Uint8Array);
  });
});
