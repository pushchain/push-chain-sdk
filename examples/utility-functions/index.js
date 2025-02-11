// Import Push Chain SDK
import { CONSTANTS, PushChain } from '@pushchain/devnet';

// From CAIP-10 to UniversalAccount
const account = PushChain.utils.account.toUniversal(
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4'
);
console.log('From CAIP-10 to UniversalAccount:', account);

// From UniversalAccount to CAIP-10
const universalAccount = {
  chain: CONSTANTS.CHAIN.ETHEREUM,
  chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
  address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
};

const caip10 = PushChain.utils.account.toChainAgnostic(universalAccount);
console.log('From UniversalAccount to CAIP-10:', caip10);

// Converts an EVM (Ethereum) address to a Push (bech32m) address
const pushAddr = PushChain.utils.account.evmToPushAddress(
  '0x35B84d6848D16415177c64D64504663b998A6ab4'
);
console.log('From EVM (Ethereum) address to Push (bech32m) address:', pushAddr);

// Converts a Push (bech32m) address to an EVM (Ethereum) address
const evmAddr = PushChain.utils.account.pushToEvmAddress(
  'push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux'
);
console.log('From Push (bech32m) address to EVM (Ethereum) address:', evmAddr);
