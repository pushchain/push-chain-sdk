import { Orchestrator } from '../src/lib/orchestrator/orchestrator';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK, CHAIN, VM } from '../src/lib/constants/enums';
import {
  bytesToHex,
  Hex,
  hexToBytes,
  parseTransaction,
  PrivateKeyAccount,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import * as nacl from 'tweetnacl';

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
describe.skip('Orchestrator (e2e)', () => {
  const pushNetwork = NETWORK.LOCALNET;

  describe('with EVM signer', () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    let orchestrator: Orchestrator;

    beforeAll(() => {
      const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
      if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

      const account = privateKeyToAccount(privateKey);
      const universalSigner = {
        chain: originChain,
        address: account.address,
        signMessage: async (data: Uint8Array) => {
          const hexSig = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(hexSig);
        },
        signTypedData: async ({
          domain,
          types,
          primaryType,
          message,
        }: {
          domain: any;
          types: any;
          primaryType: string;
          message: any;
        }) => {
          const hexSig = await account.signTypedData({
            domain,
            types,
            primaryType,
            message,
          });
          return hexToBytes(hexSig);
        },
        signTransaction: async (unsignedTx: Uint8Array) => {
          const tx = parseTransaction(bytesToHex(unsignedTx));
          const signature = await account.signTransaction(tx as never);
          return hexToBytes(signature);
        },
      };

      orchestrator = new Orchestrator(universalSigner, pushNetwork);
    });

    it('execute cross chain payload', async () => {
      const nmsc = await orchestrator.getNMSCAddress();
      console.log('💬 NMSC :', nmsc.address, '| Deployed:', nmsc.deployed);

      const txHash = await orchestrator.execute({
        target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
        gasLimit: BigInt(50000000000000000),
        maxFeePerGas: BigInt(50000000000000000),
        maxPriorityFeePerGas: BigInt(200000000),
        deadline: BigInt(9999999999),
      });
      console.log('TxHash:', txHash);

      const after = await orchestrator.getNMSCAddress();
      expect(after.deployed).toBe(true);
    }, 30000);
  });

  describe('with SVM signer', () => {
    const originChain = CHAIN.SOLANA_DEVNET;
    let orchestrator: Orchestrator;

    beforeAll(() => {
      const privateKeyHex = process.env['SOLANA_PRIVATE_KEY'];
      if (!privateKeyHex) throw new Error('SOLANA_PRIVATE_KEY not set');

      const privateKey = Uint8Array.from(Buffer.from(privateKeyHex, 'hex'));

      // Generate a keypair from the private key in .env
      const testAccount = Keypair.fromSecretKey(privateKey);

      // Create the object first with any required properties
      const universalSigner = {
        address: testAccount.publicKey.toBase58(),
        chain: originChain,
        signMessage: async (data: Uint8Array) => {
          return nacl.sign.detached(data, testAccount.secretKey);
        },
        signTransaction: async function (unsignedTx: Uint8Array) {
          return nacl.sign.detached(unsignedTx, testAccount.secretKey);
        },
      };

      orchestrator = new Orchestrator(universalSigner, pushNetwork);
    });

    it('computes and deploys NMSC if not deployed', async () => {
      const nmsc = await orchestrator.getNMSCAddress();
      console.log('💬 NMSC :', nmsc.address, '| Deployed:', nmsc.deployed);

      const txHash = await orchestrator.execute({
        target: '0x2FE70447492307108Bdc7Ff6BaB33Ff37Dacc479',
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
        gasLimit: BigInt(50000000000000000),
        maxFeePerGas: BigInt(50000000000000000),
        maxPriorityFeePerGas: BigInt(200000000),
        deadline: BigInt(9999999999),
      });
      console.log('TxHash:', txHash);

      const after = await orchestrator.getNMSCAddress();
      expect(after.deployed).toBe(true);
    }, 30000);
  });
});
