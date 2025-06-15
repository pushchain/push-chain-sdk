import { EvmClient } from './evm-client';
import {
  createWalletClient,
  http,
  Hex,
  parseAbi,
  encodeFunctionData,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { UniversalSigner } from '../universal/universal.types';
import { CHAIN } from '../constants/enums';
import { CHAIN_INFO } from '../constants/chain';
import { sepolia } from 'viem/chains';
import { PushChain } from '../pushChain';

const ABI = parseAbi([
  'function greet() view returns (string)',
  'function setGreeting(string _greeting)',
]);

const CONTRACT = '0x2ba5873eF818BEE57645B7d674149041C44F42c6';
const RPC_URL = sepolia.rpcUrls.default.http[0];
const chain = CHAIN.ETHEREUM_SEPOLIA;

// const CONTRACT = '0x87D792696Fa0810eBC5f6947F79ba50CbD267E72';
// const RPC_URL = 'https://evm.pn1.dev.push.org';
// const chain = CHAIN.PUSH_LOCALNET;

describe('EvmClient', () => {
  let evmClient: EvmClient;
  let universalSigner: UniversalSigner;

  beforeAll(() => {
    evmClient = new EvmClient({ rpcUrls: CHAIN_INFO[chain].defaultRPC });
  });

  describe('getBalance', () => {
    it('handles invalid address', async () => {
      await expect(
        evmClient.getBalance('0xInvalidAddress' as `0x${string}`)
      ).rejects.toThrow();
    });

    it('returns zero balance for new address', async () => {
      const newAddress = privateKeyToAccount(generatePrivateKey()).address;
      const balance = await evmClient.getBalance(newAddress);
      expect(balance).toBe(BigInt(0));
    });
  });

  describe('readContract', () => {
    it('reads contract value', async () => {
      const result = await evmClient.readContract<string>({
        abi: ABI,
        address: CONTRACT,
        functionName: 'greet',
      });
      console.log(`Current Greeting: ${result}`);
      expect(typeof result).toBe('string');
    });

    it('throws error for invalid contract address', async () => {
      await expect(
        evmClient.readContract({
          abi: ABI,
          address: '0xInvalidAddress' as `0x${string}`,
          functionName: 'greet',
        })
      ).rejects.toThrow();
    });

    it('throws error for non-existent function', async () => {
      await expect(
        evmClient.readContract({
          abi: ABI,
          address: CONTRACT,
          functionName: 'nonExistentFunction',
        })
      ).rejects.toThrow();
    });

    it('handles empty args array', async () => {
      const result = await evmClient.readContract<string>({
        abi: ABI,
        address: CONTRACT,
        functionName: 'greet',
        args: [],
      });
      expect(typeof result).toBe('string');
    });
  });

  it.skip('writes contract value', async () => {
    const PRIVATE_KEY = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
    if (PRIVATE_KEY) {
      const account = privateKeyToAccount(PRIVATE_KEY);
      const walletClient = createWalletClient({
        account,
        transport: http(RPC_URL),
      });
      universalSigner = await PushChain.utils.signer.toUniversal(walletClient);
    } else {
      throw new Error('No Private key set');
    }

    const balance = await evmClient.getBalance(
      universalSigner.account.address as `0x${string}`
    );
    if (balance === BigInt(0)) {
      console.warn('Skipping Test - Account has no balance');
      return;
    }

    const newGreeting = `Gm Gm ${Date.now()}`;

    const txHash = await evmClient.writeContract({
      abi: ABI,
      address: CONTRACT,
      functionName: 'setGreeting',
      args: [newGreeting],
      signer: universalSigner,
    });
    console.log('Tx Hash:', txHash);
    expect(txHash).toMatch(/^0x/);
  });

  describe('estimateGas', () => {
    it('estimates gas for a simple transfer', async () => {
      const gas = await evmClient.estimateGas({
        to: privateKeyToAccount(generatePrivateKey()).address,
        value: BigInt(1e18),
        data: '0x' as Hex,
      });
      console.log(gas);
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });
    it('estimates gas for a contract call', async () => {
      const calldata = encodeFunctionData({
        abi: ABI,
        functionName: 'setGreeting',
        args: ['Hello Push!'],
      });

      // estimate for setGreeting
      const gas = await evmClient.estimateGas({
        to: CONTRACT,
        value: BigInt(0),
        data: calldata,
      });
      console.log(gas);
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });

    it('estimates gas from nmsc - contract call', async () => {
      const gas = await evmClient.estimateGas({
        from: '0xF5184CE4b1e3eC540401f3987DDDf5ab069d05F6',
        to: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
      });
      console.log(gas);
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });

    it('estimates gas from nmsc - transfer call', async () => {
      const gas = await evmClient.estimateGas({
        from: '0xF5184CE4b1e3eC540401f3987DDDf5ab069d05F6',
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(0),
        data: '0x',
      });
      console.log(gas);
      expect(typeof gas).toBe('bigint');
      expect(gas).toBeGreaterThan(0);
    });

    it('throws error for invalid from address', async () => {
      await expect(
        evmClient.estimateGas({
          from: '0xInvalidAddress' as `0x${string}`,
          to: privateKeyToAccount(generatePrivateKey()).address,
          value: BigInt(0),
        })
      ).rejects.toThrow();
    });
  });

  describe('getGasPrice', () => {
    it('gets the current gas price', async () => {
      const gasPrice = await evmClient.getGasPrice();
      expect(typeof gasPrice).toBe('bigint');
      expect(gasPrice).toBeGreaterThan(0);
    });
  });
});
