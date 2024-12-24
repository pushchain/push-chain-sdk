import { hexToBytes } from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { CONSTANTS, PushChain, Tx } from '../../src';
import {
  UniversalAccount,
  UniversalSigner,
} from '../../src/lib/signer/signer.types';
import { config } from '../config';

const recipientAddresses = [
  privateKeyToAddress(generatePrivateKey()),
  privateKeyToAddress(generatePrivateKey()),
  privateKeyToAddress(generatePrivateKey()),
];

const recipients: UniversalAccount[] = [
  {
    chain: CONSTANTS.Chain.EVM.sepolia.name,
    chainId: CONSTANTS.Chain.EVM.sepolia.chainId,
    account: recipientAddresses[0],
  },
  {
    chain: CONSTANTS.Chain.EVM.mainnet.name,
    chainId: CONSTANTS.Chain.EVM.mainnet.chainId,
    account: recipientAddresses[1],
  },
  {
    chain: CONSTANTS.Chain.EVM.sepolia.name,
    chainId: CONSTANTS.Chain.EVM.sepolia.chainId,
    account: recipientAddresses[2],
  },
];

async function sendCustomTx(
  txInstance: Tx,
  nonce: number
): Promise<{ txHash: string }> {
  const category = ('CUSTOM:V' + nonce).substring(0, 21);
  const sampleData = intToArray(nonce);

  return await txInstance.send(recipients, {
    category,
    data: sampleData,
  });
}

describe('validator smoke test', () => {
  // NOTE: you can switch manually to CONSTANTS.ENV.LOCAL or CONSTANTS.ENV.DEV
  const env = config.ENV;
  let txInstance: Tx;

  beforeEach(async () => {
    const senderPrivateKey = generatePrivateKey();
    const account = privateKeyToAccount(senderPrivateKey);
    const universalSigner: UniversalSigner = {
      chain: CONSTANTS.Chain.Push.devnet.name,
      chainId: CONSTANTS.Chain.Push.devnet.chainId,
      account: account.address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const signer = PushChain.signer.create(universalSigner);
    txInstance = await Tx.initialize(env, signer);
  });

  it('spam100 : spam 100 custom tx', async () => {
    await sleep(2000);
    const iterations = 50;
    const delay = 50;
    const arr: Promise<{ txHash: string }>[] = [];
    for (let i = 0; i < iterations; i++) {
      arr.push(sendCustomTx(txInstance, i));
      await sleep(delay);
    }
    const allTxIds = await Promise.allSettled(arr);
    console.log('total sent txs %d', allTxIds.length);
    for (const res of allTxIds) {
      console.log('res %o', res);
    }
  });

  // it('wtr : write and read 10 custom', async () => {
  //   const iterations = 1;
  //   const txInstance = await Tx.initialize(env);
  //   for (let i = 0; i < iterations; i++) {
  //     const category = 'CUSTOM:NETWORK_BENCH';
  //     const sampleTx = txInstance.createUnsigned(
  //       category,
  //       recipients,
  //       new Uint8Array(randomBytes(20))
  //     );
  //
  //     const pk = generatePrivateKey();
  //     const account = privateKeyToAccount(pk);
  //     const senderInCaip = Address.toPushCAIP(account.address, ENV.DEV);
  //     const signer = {
  //       account: senderInCaip,
  //       signMessage: async (data: Uint8Array) => {
  //         const signature = await account.signMessage({
  //           message: { raw: data },
  //         });
  //         return hexToBytes(signature);
  //       },
  //     };
  //     const res = await txInstance.send(sampleTx, signer);
  //     expect(typeof res).toEqual('string');
  //
  //     await sleep(10000);
  //
  //     // read
  //     for (const recipient of [senderInCaip, ...recipients]) {
  //       console.log('checking %s', recipient);
  //       const res = await txInstance.getTransactionsFromVNode(
  //         recipient,
  //         category
  //       );
  //       expect(res.items).toBeInstanceOf(Array);
  //       const item0 = res.items[0];
  //       expect(item0.sender).toEqual(signer.account);
  //       expect(item0.recipientsList).toEqual(sampleTx.recipients);
  //       const sampleDataBase16 = toHex(sampleTx.data).substring(2);
  //       expect(item0.data).toEqual(sampleDataBase16);
  //       console.log('OK %o', res);
  //     }
  //   }
  // });

  // it('read :: should get transactions with custom parameters', async () => {
  //   const txInstance = await Tx.initialize(env);
  //   const res = await txInstance.getTransactionsFromVNode(
  //     'eip155:1:0x76cfb79DA0f91b2C162cA2a23f7f0117bD8cDB2c',
  //     'CUSTOM:CORE_SDK'
  //   );
  //   expect(res.items).toBeInstanceOf(Array);
  //   console.log('%o', res);
  // });

  // it('read :: should get transactions with custom parameters2', async () => {
  //   const txInstance = await Tx.initialize(env);
  //   const res = await txInstance.getTransactionsFromVNode(
  //     'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  //     'CUSTOM:NETWORK_BENCH'
  //   );
  //   expect(res.items).toBeInstanceOf(Array);
  //   console.log('%o', res);
  // });
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function intToArray(i: number) {
  return Uint8Array.of(
    (i & 0xff000000) >> 24,
    (i & 0x00ff0000) >> 16,
    (i & 0x0000ff00) >> 8,
    (i & 0x000000ff) >> 0
  );
}
