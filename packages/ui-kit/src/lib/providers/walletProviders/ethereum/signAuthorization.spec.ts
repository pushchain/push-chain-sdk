import type { SignAuthorizationParams } from '@pushchain/core';
import {
  EIP_7702_UNSUPPORTED_ERROR,
  signAuthorizationWithEthersSigner,
} from './signAuthorization';

const params: SignAuthorizationParams = {
  contractAddress: '0x1111111111111111111111111111111111111111',
  chainId: 11155111,
  nonce: 7,
};

describe('signAuthorizationWithEthersSigner', () => {
  it('normalizes an ethers v6 authorization', async () => {
    const authorize = jest.fn().mockResolvedValue({
      chainId: BigInt(11155111),
      nonce: BigInt(7),
      signature: {
        r: '0x01',
        s: '0x02',
        yParity: 1,
      },
    });

    await expect(
      signAuthorizationWithEthersSigner({ authorize }, params)
    ).resolves.toEqual({
      address: params.contractAddress,
      chainId: 11155111,
      nonce: 7,
      r: '0x01',
      s: '0x02',
      yParity: 1,
    });
    expect(authorize).toHaveBeenCalledWith({
      address: params.contractAddress,
      chainId: params.chainId,
      nonce: params.nonce,
    });
  });

  it('throws a clear error when authorize is unavailable', async () => {
    await expect(signAuthorizationWithEthersSigner({}, params)).rejects.toThrow(
      EIP_7702_UNSUPPORTED_ERROR
    );
  });

  it('normalizes the ethers default unsupported-operation error', async () => {
    const unsupported = Object.assign(
      new Error('authorization not implemented for this signer'),
      { code: 'UNSUPPORTED_OPERATION' }
    );

    await expect(
      signAuthorizationWithEthersSigner(
        { authorize: jest.fn().mockRejectedValue(unsupported) },
        params
      )
    ).rejects.toThrow(EIP_7702_UNSUPPORTED_ERROR);
  });
});
