import type {
  SignAuthorizationParams,
  SignedAuthorization,
} from '@pushchain/core';
import { ChainType, type IWalletProvider, type WalletInfo } from '../types';
import { EIP_7702_UNSUPPORTED_ERROR } from '../providers/walletProviders/ethereum/signAuthorization';
import { signAuthorizationForWalletConnection } from './walletAuthorization';

const params: SignAuthorizationParams = {
  contractAddress: '0x1111111111111111111111111111111111111111',
  chainId: 11155111,
  nonce: 7,
};

const signedAuthorization: SignedAuthorization = {
  address: params.contractAddress,
  chainId: 11155111,
  nonce: 7,
  r: '0x01',
  s: '0x02',
  yParity: 0,
};

const externalWallet: WalletInfo = {
  address: 'eip155:11155111:0x2222222222222222222222222222222222222222',
  chainType: ChainType.ETHEREUM,
  providerName: 'Test EVM Wallet',
};

const createProvider = (): IWalletProvider => ({
  name: externalWallet.providerName,
  icon: '',
  supportedChains: [ChainType.ETHEREUM],
  connect: jest.fn(),
  signMessage: jest.fn(),
  signAndSendTransaction: jest.fn(),
  signTypedData: jest.fn(),
  disconnect: jest.fn(),
  getChainId: jest.fn(),
});

describe('signAuthorizationForWalletConnection', () => {
  it('delegates authorization signing to the connected external provider', async () => {
    const provider = createProvider();
    provider.signAuthorization = jest
      .fn()
      .mockResolvedValue(signedAuthorization);
    const registry = { getProvider: jest.fn().mockReturnValue(provider) };
    const socialSignAuthorization = jest.fn();

    await expect(
      signAuthorizationForWalletConnection(
        externalWallet,
        params,
        registry,
        socialSignAuthorization
      )
    ).resolves.toEqual(signedAuthorization);
    expect(registry.getProvider).toHaveBeenCalledWith(
      externalWallet.providerName
    );
    expect(provider.signAuthorization).toHaveBeenCalledWith(params);
    expect(socialSignAuthorization).not.toHaveBeenCalled();
  });

  it('throws a clear error for an unsupported external provider', async () => {
    const registry = {
      getProvider: jest.fn().mockReturnValue(createProvider()),
    };

    await expect(
      signAuthorizationForWalletConnection(
        externalWallet,
        params,
        registry,
        jest.fn()
      )
    ).rejects.toThrow(EIP_7702_UNSUPPORTED_ERROR);
  });
});
