import {
  createUniversalAccount,
  toChainAgnostic,
  convertOriginToExecutor,
  fromChainAgnostic,
} from './account';
import { CHAIN, LIBRARY, PUSH_NETWORK } from '../../constants/enums';
import { PushChain } from '../../pushChain';
import { Orchestrator } from '../../orchestrator/orchestrator';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toUniversalFromKeyPair } from '../signer';

const EVM_ADDRESS = '0xeCba9a32A9823f1cb00cdD8344Bf2D1d87a8dd97';

describe('Universal Account Utilities', () => {
  describe('createUniversalAccount()', () => {
    it('returns a checksummed address for EVM chains', () => {
      const account = createUniversalAccount({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: EVM_ADDRESS.toLowerCase(), // simulate unchecksummed input
      });

      expect(account.address).toBe(EVM_ADDRESS);
      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    });

    it('returns the address as-is for non-EVM chains', () => {
      const account = createUniversalAccount({
        chain: CHAIN.SOLANA_TESTNET,
        address: 'solanaAddress123',
      });

      expect(account.address).toBe('solanaAddress123');
      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
    });

    it('throws an error on invalid EVM address format', () => {
      expect(() =>
        createUniversalAccount({
          chain: CHAIN.ETHEREUM_SEPOLIA,
          address: 'not-an-eth-address',
        })
      ).toThrow('Invalid EVM address format');
    });
  });

  describe('toChainAgnostic()', () => {
    it('converts a UniversalAccount to a CAIP-10 string for EVM', () => {
      const caip = toChainAgnostic({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        address: EVM_ADDRESS,
      });

      expect(caip).toBe(`eip155:11155111:${EVM_ADDRESS}`);
    });

    it('converts a UniversalAccount to a CAIP-10 string for Solana', () => {
      const caip = toChainAgnostic({
        chain: CHAIN.SOLANA_TESTNET,
        address: 'solanaAddress123',
      });

      expect(caip).toBe(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );
    });
  });

  describe('fromChainAgnostic()', () => {
    it('converts a CAIP-10 string to a UniversalAccount (EVM)', () => {
      const account = fromChainAgnostic(`eip155:11155111:${EVM_ADDRESS}`);

      expect(account.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
      expect(account.address).toBe(EVM_ADDRESS);
    });

    it('converts a CAIP-10 string to a UniversalAccount (Solana)', () => {
      const account = fromChainAgnostic(
        'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z:solanaAddress123'
      );

      expect(account.chain).toBe(CHAIN.SOLANA_TESTNET);
      expect(account.address).toBe('solanaAddress123');
    });

    it('throws an error if the CAIP string is unsupported', () => {
      expect(() => fromChainAgnostic('foo:999:bar')).toThrow(
        'Unsupported or unknown CAIP address: foo:999:bar'
      );
    });
  });

  describe('convertOriginToExecutor() - Not Mocked', () => {
    it('should return same address and pushChainClient.universal.account', async () => {
      const account = privateKeyToAccount(generatePrivateKey());
      const signer = await toUniversalFromKeyPair(account, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: LIBRARY.ETHEREUM_VIEM,
      });

      const orchestrator = new Orchestrator(signer, PUSH_NETWORK.TESTNET_DONUT);
      const address = orchestrator.calculateUEAOffchain();
      const address2 = await orchestrator.getNMSCAddress();
      const result = await convertOriginToExecutor(signer.account, {
        status: true,
      });

      expect(address).toBe(result.address);
      expect(address2.address).toBe(result.address);

      const address3 = await PushChain.utils.account.convertOriginToExecutor(
        signer.account,
        {
          status: true,
        }
      );
      expect(address3.address).toBe(address2.address);
    });
  });
});
