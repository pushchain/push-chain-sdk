import { CONSTANTS } from '../../src';
import {
  createUniversalAccount,
  createUniversalSigner,
} from '../../src/lib/signer/universalFactories';

const address = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5';

describe('createUniversalAccount', () => {
  it('should create a UniversalAccount with default chain and chainId', () => {
    const account = createUniversalAccount({ address });

    expect(account).toEqual({
      chain: CONSTANTS.CHAIN.ETHEREUM,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
      address,
    });
  });

  it('should override the default chain and chainId when provided', () => {
    const account = createUniversalAccount({
      address,
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
    });

    expect(account).toEqual({
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
      address,
    });
  });

  it('should handle partial overrides correctly', () => {
    const account = createUniversalAccount({
      address,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
    });

    expect(account).toEqual({
      chain: CONSTANTS.CHAIN.ETHEREUM, // Default value
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET, // Overridden value
      address,
    });
  });

  it('should work with completely custom chain and chainId', () => {
    const account = createUniversalAccount({
      address,
      chain: 'CUSTOM_CHAIN',
      chainId: 'CUSTOM_CHAIN_ID',
    });

    expect(account).toEqual({
      chain: 'CUSTOM_CHAIN',
      chainId: 'CUSTOM_CHAIN_ID',
      address,
    });
  });
});

describe('createUniversalSigner', () => {
  const address = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5';

  // Mock implementation for the signMessage function
  const mockSignMessage = jest
    .fn()
    .mockResolvedValue(new Uint8Array([1, 2, 3]));

  it('should create a UniversalSigner with default chain and chainId', async () => {
    const signer = createUniversalSigner({
      address,
      signMessage: mockSignMessage,
    });

    expect(signer.chain).toEqual(CONSTANTS.CHAIN.ETHEREUM);
    expect(signer.chainId).toEqual(CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA);
    expect(signer.address).toEqual(address);

    // Check that signMessage is attached and can be called
    const dataToSign = new Uint8Array([10, 20, 30]);
    const signature = await signer.signMessage(dataToSign);
    expect(signature).toEqual(new Uint8Array([1, 2, 3]));
    expect(mockSignMessage).toHaveBeenCalledWith(dataToSign);
  });

  it('should override the default chain and chainId when provided', () => {
    const signer = createUniversalSigner({
      address,
      signMessage: mockSignMessage,
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
    });

    expect(signer).toEqual({
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
      address,
      signMessage: mockSignMessage,
    });
  });

  it('should handle partial overrides correctly', () => {
    const signer = createUniversalSigner({
      address,
      signMessage: mockSignMessage,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
    });

    expect(signer).toEqual({
      chain: CONSTANTS.CHAIN.ETHEREUM, // Default value
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET, // Overridden value
      address,
      signMessage: mockSignMessage,
    });
  });

  it('should work with completely custom chain and chainId', () => {
    const signer = createUniversalSigner({
      address,
      signMessage: mockSignMessage,
      chain: 'CUSTOM_CHAIN',
      chainId: 'CUSTOM_CHAIN_ID',
    });

    expect(signer).toEqual({
      chain: 'CUSTOM_CHAIN',
      chainId: 'CUSTOM_CHAIN_ID',
      address,
      signMessage: mockSignMessage,
    });
  });
});
