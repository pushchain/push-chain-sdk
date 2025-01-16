import { hexToBytes } from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { PushChain, Tx } from '../../src';
import { CONSTANTS } from '../../src/lib/constants';
import { config } from '../config';
import { INIT_DID_TX_2 } from '../data';
import {
  UniversalAccount,
  UniversalSigner,
} from '../../src/lib/signer/signer.types';

// remove .skip to run
describe.skip('validator smoke test', () => {
  // switch to ENV.LOCAL or ENV.DEV
  const env = config.ENV;

  it('write :: itx :: send INIT_DID tx', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX_2.masterPrivateKey as `0x${string}`
    );
    const universalSigner: UniversalSigner = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
      account: account.address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const signer = PushChain.signer.create(universalSigner);
    const txInstance = await Tx.initialize(env, signer);
    const recipientAddresses = [
      privateKeyToAddress(generatePrivateKey()),
      privateKeyToAddress(generatePrivateKey()),
      privateKeyToAddress(generatePrivateKey()),
    ];

    const recipients: UniversalAccount[] = [
      {
        chain: CONSTANTS.CHAIN.ETHEREUM,
        chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
        account: recipientAddresses[0],
      },
      {
        chain: CONSTANTS.CHAIN.ETHEREUM,
        chainId: CONSTANTS.CHAIN_ID.ETHEREUM.MAINNET,
        account: recipientAddresses[1],
      },
      {
        chain: CONSTANTS.CHAIN.ETHEREUM,
        chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
        account: recipientAddresses[2],
      },
    ];

    const res = await txInstance.send(recipients, {
      category: 'INIT_DID',
      data: Buffer.from(INIT_DID_TX_2.unsignedInitDIDTx.data).toString(
        'base64'
      ),
    });
    expect(typeof res).toEqual('object');
    expect(res).toHaveProperty('txHash');
    expect(typeof res.txHash).toBe('string');
  });

  // it('write :: ctx :: write custom tx THEN read', async () => {
  //   const txInstance = await Tx.initialize(env);
  //   const recipients = [
  //     `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
  //     `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
  //     `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
  //   ];
  //   const sampleTx = txInstance.createUnsigned(
  //     'CUSTOM:CORE_SDK',
  //     recipients,
  //     new Uint8Array([1, 2, 3, 4, 5])
  //   );
  //
  //   const pk = generatePrivateKey();
  //   const address = privateKeyToAccount(pk);
  //   const signer = {
  //     address: Address.toPushCAIP(address.address, ENV.DEVNET),
  //     signMessage: async (data: Uint8Array) => {
  //       const signature = await address.signMessage({
  //         message: { raw: data },
  //       });
  //       return hexToBytes(signature);
  //     },
  //   };
  //   const res = await txInstance.send(sampleTx, signer);
  //   expect(typeof res).toEqual('string');
  //
  //   // read
  //   for (const recipient of recipients) {
  //     const res = await txInstance.getFromVNode(recipient, 'CUSTOM:CORE_SDK');
  //     expect(res.items).toBeInstanceOf(Array);
  //     const item0 = res.items[0];
  //     expect(item0.sender).toEqual(signer.address);
  //     expect(item0.recipientsList).toEqual(sampleTx.recipients);
  //     const sampleDataBase16 = toHex(sampleTx.data).substring(2);
  //     expect(item0.data).toEqual(sampleDataBase16);
  //     console.log('OK %o', res);
  //   }
  // });

  // it('read :: should get transactions with custom parameters', async () => {
  //   const txInstance = await Tx.initialize(env);
  //   const res = await txInstance.getFromVNode(
  //     'push:devnet:push1lrl2apatdv6l6q8lyarvc5p4j6uxfa65g8n3r9',
  //     'CUSTOM:CORE_SDK'
  //   );
  //   expect(res.items).toBeInstanceOf(Array);
  //   console.log('%o', res);
  // });
});
