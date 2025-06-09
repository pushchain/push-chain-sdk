import { privateKeyToAccount } from 'viem/accounts';
import { PUSH_NETWORK, CHAIN } from '../src/lib/constants/enums';
import { Hex, isAddress, PublicClient } from 'viem';
import { Keypair } from '@solana/web3.js';
import { PushChain } from '../src';

/** CLI COMMANDS
 
TO GENERATE UNSIGNED TX
  pchaind tx bank send acc1 push1f5th78lzntc2h0krzqn5yldvwg43lcrgkqxtsv 1000npush \
  --generate-only --output json > unsigned.json

TO SIGN THE TX & GENERATE SIGNED TX ( VIA ACC 1 )
  pchaind tx sign unsigned.json \
  --from acc1 --chain-id localchain_9000-1 \
  --keyring-backend test \
  --output-document signed.json

TO ENCODE TX
  pchaind tx encode signed.json

TO DECODE TX
  pchaind tx decode base64EncodedString

 */
describe.skip('PushChain (e2e)', () => {
  const pushNetwork = PUSH_NETWORK.LOCALNET;

  describe('EVM signer', () => {
    describe(`ORIGIN CHAIN: ${CHAIN.ETHEREUM_SEPOLIA}`, () => {
      const originChain = CHAIN.ETHEREUM_SEPOLIA;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

        const account = privateKeyToAccount(privateKey);

        const universalSigner =
          await PushChain.utils.signer.toUniversalFromKeyPair(account, {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          });

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should getNMSCAddress', async () => {
        const result = await pushClient.universal.account;
        expect(isAddress(result.address)).toBe(true);
        expect(typeof result.deployed).toBe('boolean');
      });

      it('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);
        expect(isAddress(uoa.address)).toBe(true);
      });

      // TODO: ADD EXAMPLE ON GENERATING DATA PROPERTY.
      it('should sendTransaction', async () => {
        await pushClient.universal.sendTransaction({
          target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
          value: BigInt(0),
          data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: BigInt(50000000000000000),
          maxFeePerGas: BigInt(50000000000000000),
          maxPriorityFeePerGas: BigInt(200000000),
          deadline: BigInt(9999999999),
        });
        const after = await pushClient.universal.account;
        expect(after.deployed).toBe(true);
      }, 30000);
    });

    describe(`ORIGIN CHAIN: ${CHAIN.PUSH_LOCALNET}`, () => {
      const originChain = CHAIN.PUSH_LOCALNET;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
        if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

        const account = privateKeyToAccount(privateKey);

        const universalSigner =
          await PushChain.utils.signer.toUniversalFromKeyPair(account, {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
          });

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should getNMSCAddress', async () => {
        await expect(pushClient.universal.account).rejects.toThrow(
          'NMSC address cannot be computed for a Push Chain Address'
        );
      });

      it.only('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);
        expect(isAddress(uoa.address)).toBe(true);
      });

      it('should sendTransaction', async () => {
        await pushClient.universal.sendTransaction({
          target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
          value: BigInt(0),
          data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: BigInt(50000000000000000),
          maxFeePerGas: BigInt(50000000000000000),
          maxPriorityFeePerGas: BigInt(200000000),
        });
        const after = await pushClient.universal.account;
        expect(after.deployed).toBe(true);
      }, 30000);
    });
  });

  describe('SVM signer', () => {
    describe(`ORIGIN CHAIN: ${CHAIN.SOLANA_DEVNET}`, () => {
      const originChain = CHAIN.SOLANA_DEVNET;
      let pushClient: PushChain;

      beforeAll(async () => {
        const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
        if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

        const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

        const account = Keypair.fromSecretKey(privateKey);

        const universalSigner =
          await PushChain.utils.signer.toUniversalFromKeyPair(account, {
            chain: originChain,
            library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
          });

        pushClient = await PushChain.initialize(universalSigner, {
          network: pushNetwork,
          printTraces: true,
        });
      });

      it('should getNMSCAddress', async () => {
        const result = await pushClient.universal.account;
        expect(isAddress(result.address)).toBe(true);
        expect(typeof result.deployed).toBe('boolean');
      });

      it('should getUOA', () => {
        const uoa = pushClient.universal.origin;
        expect(uoa).toBeDefined();
        expect(uoa.chain).toBe(originChain);
        expect(isAddress(uoa.address)).toBe(true);
      });

      it('should sendTransaction', async () => {
        await pushClient.universal.sendTransaction({
          target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
          value: BigInt(0),
          data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
          gasLimit: BigInt(50000000000000000),
          maxFeePerGas: BigInt(50000000000000000),
          maxPriorityFeePerGas: BigInt(200000000),
          deadline: BigInt(9999999999),
        });
        const after = await pushClient.universal.account;
        expect(after.deployed).toBe(true);
      }, 30000);
    });
  });
});

describe('viem', () => {
  let viemClient: PublicClient;

  beforeAll(() => {
    viemClient = PushChain.viem.createPublicClient({
      chain: PushChain.CONSTANTS.VIEM_PUSH_TESTNET_DONUT,
      transport: PushChain.viem.http(),
    });
  });

  it('creates a viem client', async () => {
    expect(viemClient).toBeDefined();
    expect(typeof viemClient.getBlock).toBe('function');
  });

  it('gets a block', async () => {
    const block = await viemClient.getBlock();
    expect(block).toBeDefined();

    // Check essential block properties
    expect(typeof block.number).toBe('bigint');
    expect(typeof block.hash).toBe('string');
    expect(block.hash).toMatch(/^0x[a-fA-F0-9]{64}$/); // Valid hex hash
    expect(typeof block.timestamp).toBe('bigint');
    expect(Array.isArray(block.transactions)).toBe(true);
    expect(typeof block.gasLimit).toBe('bigint');
    expect(typeof block.gasUsed).toBe('bigint');
    expect(block.number).toBeGreaterThan(0);
    expect(block.timestamp).toBeGreaterThan(0);
  });
});
