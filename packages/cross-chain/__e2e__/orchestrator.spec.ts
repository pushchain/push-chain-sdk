import { Orchestrator } from '../src/lib/orchestrator/orchestrator';
import { privateKeyToAccount, signTypedData } from 'viem/accounts';
import { NETWORK, CHAIN, VM } from '../src/lib/constants/enums';
import { toBech32, fromBase64 } from '@cosmjs/encoding';
import { Hex, hexToBytes } from 'viem';
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
describe('Orchestrator (e2e)', () => {
  const pushNetwork = NETWORK.LOCALNET;

  describe('with EVM signer', () => {
    const originChain = CHAIN.ETHEREUM_SEPOLIA;
    let orchestrator: Orchestrator;

    beforeAll(() => {
      // const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
      const privateKey =
        '0x730b326679b7b7ee74d0611d5b4c4cfc276957fe810deb8d013261f6331483f5';
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

      const txHash = await orchestrator.execute({
        target: '0x527F3692F5C53CfA83F7689885995606F93b6164',
        value: BigInt(0),
        data: '0x2ba2ed980000000000000000000000000000000000000000000000000000000000000312',
        gasLimit: BigInt(21000000),
        maxFeePerGas: BigInt(1000000000),
        maxPriorityFeePerGas: BigInt(200000000),
        deadline: BigInt(9999999999),
      });
      console.log('📝 Deployment Tx:', txHash);

      // some timeout maybe

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
