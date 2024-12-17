import { hexToBytes, toHex } from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { Address, Tx } from '../../src';
import { PushChainEnvironment } from '../../src/lib/constants';
import { InitDid } from '../../src/lib/generated/txData/init_did';
import { config } from '../config';
import { INIT_DID_TX_2 } from '../data';

const test_pk = generatePrivateKey();
const test_account = privateKeyToAccount(test_pk);
// Mock data for testing
const mockInitDidTxData: InitDid = {
  masterPubKey: test_account.publicKey.slice(2), // remove 0x
  derivedKeyIndex: 0,
  derivedPubKey: '00000',
  walletToEncDerivedKey: {
    'push:devnet:push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux': {
      encDerivedPrivKey: {
        ciphertext: 'sample_ciphertext',
        salt: 'sample_salt',
        nonce: 'sample_nonce',
        version: 'push:v5',
        preKey: 'sample_prekey',
      },
      signature: new Uint8Array([1, 2, 3]),
    },
  },
};
const mockRecipients = [
  `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
  `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
  `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
];

// remove .skip to run
describe.skip('validator smoke test', () => {
  // switch to ENV.LOCAL or ENV.DEV
  const env = config.ENV;

  it('write :: itx :: send INIT_DID tx', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX_2.masterPrivateKey as `0x${string}`
    );
    const signer = {
      account: Address.toPushCAIP(account.address, PushChainEnvironment.devnet),
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.send(INIT_DID_TX_2.unsignedInitDIDTx, signer);
    expect(typeof res).toEqual('string');
  });

  it('write :: ctx :: write custom tx THEN read', async () => {
    const txInstance = await Tx.initialize(env);
    const recipients = [
      `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
    ];
    const sampleTx = txInstance.createUnsigned(
      'CUSTOM:CORE_SDK',
      recipients,
      new Uint8Array([1, 2, 3, 4, 5])
    );

    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const signer = {
      account: Address.toPushCAIP(account.address, PushChainEnvironment.devnet),
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const res = await txInstance.send(sampleTx, signer);
    expect(typeof res).toEqual('string');

    // read
    for (const recipient of recipients) {
      const res = await txInstance.getFromVNode(recipient, 'CUSTOM:CORE_SDK');
      expect(res.items).toBeInstanceOf(Array);
      const item0 = res.items[0];
      expect(item0.sender).toEqual(signer.account);
      expect(item0.recipientsList).toEqual(sampleTx.recipients);
      const sampleDataBase16 = toHex(sampleTx.data).substring(2);
      expect(item0.data).toEqual(sampleDataBase16);
      console.log('OK %o', res);
    }
  });

  it('read :: should get transactions with custom parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getFromVNode(
      'push:devnet:push1lrl2apatdv6l6q8lyarvc5p4j6uxfa65g8n3r9',
      'CUSTOM:CORE_SDK'
    );
    expect(res.items).toBeInstanceOf(Array);
    console.log('%o', res);
  });
});
