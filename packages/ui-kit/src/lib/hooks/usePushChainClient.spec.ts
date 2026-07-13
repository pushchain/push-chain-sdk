import { PushChain } from '@pushchain/core';
import { CHAIN } from '@pushchain/core/src/lib/constants/enums';
import { constructPushChainSigner } from './constructPushChainSigner';

const handlers = {
  signMessage: jest.fn(),
  signAndSendTransaction: jest.fn(),
  signTypedData: jest.fn(),
  signAuthorization: jest.fn(),
};

describe('usePushChainClient signer construction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes signAuthorization into core for EVM accounts', () => {
    const account = {
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: '0x2222222222222222222222222222222222222222',
    };
    const construct = jest.spyOn(PushChain.utils.signer, 'construct');

    const signer = constructPushChainSigner(account, false, handlers);

    expect(construct).toHaveBeenCalledWith(
      account,
      expect.objectContaining({
        signAuthorization: handlers.signAuthorization,
      })
    );
    expect(signer.signAuthorization).toBe(handlers.signAuthorization);
  });

  it('does not pass signAuthorization into core for Solana accounts', () => {
    const account = {
      chain: CHAIN.SOLANA_DEVNET,
      address: '11111111111111111111111111111111',
    };
    const construct = jest.spyOn(PushChain.utils.signer, 'construct');

    const signer = constructPushChainSigner(account, true, handlers);

    expect(construct).toHaveBeenCalledWith(
      account,
      expect.objectContaining({
        signAuthorization: undefined,
      })
    );
    expect(signer.signAuthorization).toBeUndefined();
  });
});
