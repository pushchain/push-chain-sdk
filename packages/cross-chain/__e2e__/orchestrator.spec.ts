import { Orchestrator } from '../src/lib/orchestrator/orchestrator';
import { privateKeyToAccount } from 'viem/accounts';
import { NETWORK, CHAIN, VM } from '../src/lib/constants/enums';
import { toBech32, fromBase64 } from '@cosmjs/encoding';
import { Hex, hexToBytes } from 'viem';
import { Keypair } from '@solana/web3.js';
import * as nacl from 'tweetnacl';

describe('Orchestrator (e2e)', () => {
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
        signTransaction: async () => {
          throw new Error('tx signing not needed in this test');
        },
      };

      orchestrator = new Orchestrator(universalSigner, pushNetwork);
    });

    it('computes and deploys NMSC if not deployed', async () => {
      const nmsc = await orchestrator.getNMSCAddress();
      console.log('💬 NMSC :', nmsc.address, '| Deployed:', nmsc.deployed);

      if (nmsc.deployed) {
        console.log('✅ Already deployed. Skipping.');
        return;
      }

      //   const txHash = await orchestrator.sendCrossChainPushTx(false, '0x1234');
      //   console.log('📝 Deployment Tx:', txHash);

      //   const after = await orchestrator.getNMSCAddress();
      //   expect(after.deployed).toBe(true);
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

      if (nmsc.deployed) {
        console.log('✅ Already deployed. Skipping.');
        return;
      }

      //   const txHash = await orchestrator.sendCrossChainPushTx(false, '0x1234');
      //   console.log('📝 Deployment Tx:', txHash);

      //   const after = await orchestrator.getNMSCAddress();
      //   expect(after.deployed).toBe(true);
    }, 30000);
  });
});
