import { createUniversalAccount } from '../../src/lib/signer/createUniversalAccount';
import { CONSTANTS } from '../../src';

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
