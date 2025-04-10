import { CONSTANTS } from '../../src';
import { PushChain } from '../../src';
import { CHAIN, CHAIN_ID } from '../../src/lib/constants';
import { UniversalAccount } from '../../src/lib/signer/signer.types';
import { getRandomElement } from '../../src/lib/utils';

describe('getRandomElement', () => {
  it('should return a valid element (Small Array ~ 1k elements)', () => {
    const testArray = Array.from(
      { length: 1000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should return a valid element (Large Array ~ 10k elements)', () => {
    const testArray = Array.from(
      { length: 10000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should return a valid element (Large Array ~ 100k elements)', () => {
    const testArray = Array.from(
      { length: 100000 },
      (_, i) => `https://validator/${i}`
    );
    const element = getRandomElement(testArray);
    expect(testArray).toContain(element);
  });

  it('should throw an error if array length is 0', () => {
    expect(() => getRandomElement([])).toThrow('Array cannot be empty');
  });
});

describe('PushChain.utils.account.toChainAgnostic', () => {
  const evmAddress = '0x35B84d6848D16415177c64D64504663b998A6ab4';
  const pushAddress = 'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux';
  const solanaAddress = '69EUYJKr2NE8vHFphyRPSU2tqRbXhMu9gzNo96mjvFLv';

  //
  // 1. EVM Account Tests
  //
  it('should return chainAgnostic for an EVM account (Ethereum / Sepolia)', () => {
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.ETHEREUM,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
      address: evmAddress,
    };

    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    // Expected format: eip155:<chainId>:<address>
    //   e.g., "eip155:11155111:0x35B84d6848D16415177c64D64504663b998A6ab4"
    expect(result).toBe(
      `eip155:${CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA}:${evmAddress}`
    );
  });

  it('should return chainAgnostic for an EVM account (Ethereum / Mainnet)', () => {
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.ETHEREUM,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
      address: evmAddress,
    };

    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    // Expected format: eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4
    expect(result).toBe(
      `eip155:${CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET}:${evmAddress}`
    );
  });

  //
  // 2. Push Chain Tests
  //
  it('should return chainAgnostic for a Push chain account with a raw EVM address (Devnet)', () => {
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
      address: evmAddress, // Not yet in push format
    };

    // Internally, `toChainAgnostic` will call Address.evmToPush and convert it
    const result = PushChain.utils.account.toChainAgnostic(universalAccount);

    // We expect: "push:devnet:push1xkuy..."
    // Because it will convert the EVM address to a push address
    expect(result).toBe(
      `push:${CONSTANTS.CHAIN_ID.PUSH.DEVNET}:${pushAddress}`
    );
  });

  it('should return chainAgnostic for a Push chain account that already has a push-formatted address (Mainnet)', () => {
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.MAINNET,
      address: pushAddress, // Already in push format
    };

    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    // We expect: "push:mainnet:push1xkuy..."
    expect(result).toBe(
      `push:${CONSTANTS.CHAIN_ID.PUSH.MAINNET}:${pushAddress}`
    );
  });

  //
  // 3. Solana Tests
  //
  it('should return chainAgnostic for a Solana account', () => {
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
      address: solanaAddress,
    };

    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    // Expected format: "solana:<chainId>:<address>"
    // e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:69EUYJKr2NE8vHFphyRPSU2tqRbXhMu9gzNo96mjvFLv"
    expect(result).toBe(
      `solana:${CONSTANTS.CHAIN_ID.SOLANA.MAINNET}:${solanaAddress}`
    );
  });

  //
  // 4. Unknown / Custom Chain Tests
  //
  it('should handle a custom chain gracefully', () => {
    const universalAccount: UniversalAccount = {
      chain: 'UNKNOWN_CHAIN',
      chainId: '1234',
      address: 'someAddress',
    };

    // We'll see a console.log "Chain not in constants" but it should still return "unknown_chain:1234:someAddress"
    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    expect(result).toBe('unknown_chain:1234:someAddress');
  });

  //
  // 5. Edge Cases
  //
  it('should not modify an already-checksummed EVM address', () => {
    // getAddress (from viem) is used inside the function if chain === 'PUSH'
    // but for an EVM chain, we just return the address as-is.
    const checksummedAddress = '0x35B84d6848D16415177c64D64504663b998A6ab4';
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.ETHEREUM,
      chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
      address: checksummedAddress,
    };

    const result = PushChain.utils.account.toChainAgnostic(universalAccount);
    // "eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4"
    expect(result).toContain(checksummedAddress);
  });

  it('should handle an invalid EVM address when chain=PUSH gracefully (throw error)', () => {
    // If the function tries to convert an invalid address to push, it should throw
    const universalAccount: UniversalAccount = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
      address: '0xinvalid',
    };

    expect(() =>
      PushChain.utils.account.toChainAgnostic(universalAccount)
    ).toThrow('Invalid EVM address');
  });
});

describe('PushChain.utils.account.toUniversal', () => {
  //
  // 1. EIP155 (Ethereum) tests
  //
  it('should return Ethereum Mainnet for "eip155:1:<address>"', () => {
    const chainAgnosticAddr = `eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.ETHEREUM,
      chainId: CHAIN_ID.ETHEREUM.MAINNET,
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    });
  });

  it('should return Ethereum Sepolia for "eip155:11155111:<address>"', () => {
    const chainAgnosticAddr = `eip155:11155111:0x35B84d6848D16415177c64D64504663b998A6ab4`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.ETHEREUM,
      chainId: CHAIN_ID.ETHEREUM.SEPOLIA,
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    });
  });

  it('should return Ethereum custom chainId for "eip155:5:<address>" (Goerli or any other)', () => {
    const chainAgnosticAddr = `eip155:5:0x35B84d6848D16415177c64D64504663b998A6ab4`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.ETHEREUM,
      chainId: '5',
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
    });
  });

  //
  // 2. Push Chain tests
  //
  it('should return Push Mainnet for "push:mainnet:<address>"', () => {
    const chainAgnosticAddr = `push:mainnet:push1abc...`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.PUSH,
      chainId: CHAIN_ID.PUSH.MAINNET,
      address: 'push1abc...',
    });
  });

  it('should return Push Devnet for "push:devnet:<address>"', () => {
    const chainAgnosticAddr = `push:devnet:push1xyz...`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.PUSH,
      chainId: CHAIN_ID.PUSH.DEVNET,
      address: 'push1xyz...',
    });
  });

  it('should return custom chainId for "push:somechain:<address>"', () => {
    const chainAgnosticAddr = `push:somechain:push1custom...`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.PUSH,
      chainId: 'somechain',
      address: 'push1custom...',
    });
  });

  //
  // 3. Solana tests
  //
  it('should return Solana Mainnet for "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:<address>"', () => {
    // 5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp is your designated Mainnet chain ID
    const chainAgnosticAddr = `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:someSolanaAddress`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CONSTANTS.CHAIN.SOLANA,
      chainId: CONSTANTS.CHAIN_ID.SOLANA.MAINNET,
      address: 'someSolanaAddress',
    });
  });

  it('should return Solana Devnet for "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:<address>"', () => {
    const chainAgnosticAddr = `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:someSolanaDevnetAddress`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.SOLANA,
      chainId: CHAIN_ID.SOLANA.DEVNET,
      address: 'someSolanaDevnetAddress',
    });
  });

  it('should return Solana Testnet for "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:<address>"', () => {
    const chainAgnosticAddr = `solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:someSolanaTestnetAddress`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.SOLANA,
      chainId: CHAIN_ID.SOLANA.TESTNET,
      address: 'someSolanaTestnetAddress',
    });
  });

  it('should return custom Solana chainId for "solana:SomeChainId:<address>"', () => {
    const chainAgnosticAddr = `solana:SomeChainId:someAddress`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: CHAIN.SOLANA,
      chainId: 'SomeChainId',
      address: 'someAddress',
    });
  });

  //
  // 4. Unknown/Custom chain tests
  //
  it('should return a custom chain for "somechain:999:<address>"', () => {
    const chainAgnosticAddr = `somechain:999:myCustomAddress`;
    const result = PushChain.utils.account.toUniversal(chainAgnosticAddr);

    expect(result).toEqual<UniversalAccount>({
      chain: 'somechain',
      chainId: '999',
      address: 'myCustomAddress',
    });
  });
});
