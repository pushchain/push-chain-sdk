import { hexToBytes } from 'viem';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { CONSTANTS, PushChain } from '../../src';
import { CHAIN, CHAIN_ID, ENV } from '../../src/lib/constants';
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
    chain: CONSTANTS.CHAIN.ETHEREUM,
    chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
    address: recipientAddresses[0],
  },
  {
    chain: CONSTANTS.CHAIN.ETHEREUM,
    chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
    address: recipientAddresses[1],
  },
  {
    chain: CONSTANTS.CHAIN.ETHEREUM,
    chainId: CONSTANTS.CHAIN_ID.ETHEREUM.SEPOLIA,
    address: recipientAddresses[2],
  },
];

export async function sendCustomTx(
  pushChain: PushChain,
  nonce: number
): Promise<string> {
  const category = ('CUSTOM:V' + nonce).substring(0, 21);
  const sampleData = intToArray(nonce);
  return (
    await pushChain.tx.send(recipients, {
      category,
      data: JSON.stringify({ sampleData }),
    })
  ).txHash;
}

describe('validator smoke test', () => {
  // NOTE: you can switch manually to CONSTANTS.ENV.LOCAL or CONSTANTS.ENV.DEV
  const env = config.ENV;
  let pushChain: PushChain;

  beforeEach(async () => {
    const senderPrivateKey = generatePrivateKey();
    const address = privateKeyToAccount(senderPrivateKey);
    const universalSigner: UniversalSigner = {
      chain: CONSTANTS.CHAIN.PUSH,
      chainId: CONSTANTS.CHAIN_ID.PUSH.DEVNET,
      address: address.address,
      signMessage: async (data: Uint8Array): Promise<Uint8Array> => {
        const signature = await address.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    pushChain = await PushChain.initialize(universalSigner, { network: env });
  });

  it('spam100 : spam 100 custom tx', async () => {
    await sleep(2000);
    const iterations = 50;
    const delay = 50;
    const arr: Promise<string>[] = [];
    for (let i = 0; i < iterations; i++) {
      arr.push(sendCustomTx(pushChain, i));
      await sleep(delay);
    }
    const allTxIds = await Promise.allSettled(arr);
    console.log('total sent txs %d', allTxIds.length);
    for (const res of allTxIds) {
      console.log('res %o', res);
    }
  });

  it.skip('wtr : write and read 10 custom', async () => {
    const iterations = 1;
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    // const senderInCaip = Address.toPushCAIP(address.address, ENV.DEVNET);
    const universalAccount: UniversalAccount = {
      chain: CHAIN.PUSH,
      chainId: CHAIN_ID.PUSH.DEVNET,
      address: account.address,
    };
    // const universalAddress = PushChain.utils.account.toUniversal(senderInCaip);
    const signer = {
      ...universalAccount,
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };

    const pushChain = await PushChain.initialize(signer, { network: env });
    const data = 'hello';
    for (let i = 0; i < iterations; i++) {
      const category = 'CUSTOM:NETWORK_BENCH';
      const res = await pushChain.tx.send(recipients, {
        category,
        data,
      });
      expect(typeof res.txHash).toEqual('string');

      await sleep(10000);

      // read
      for (const recipient of [
        PushChain.utils.account.toChainAgnostic(universalAccount),
        ...recipients.map((r) => PushChain.utils.account.toChainAgnostic(r)),
      ]) {
        console.log('checking %s', recipient);
        const res = await (pushChain.tx as any).getTransactionsFromVNode(
          recipient,
          category
        );
        expect(res.items).toBeInstanceOf(Array);
        const item0 = res.items[0];
        expect(item0.sender).toEqual(
          PushChain.utils.account.toChainAgnostic(signer)
        );
        item0.recipientsList.forEach((r: string, index: number) => {
          expect(r).toEqual(
            PushChain.utils.account.toChainAgnostic(recipients[index])
          );
        });
        expect(item0.data).toEqual(data);
        // const sampleDataBase16 = toHex(sampleTx.data).substring(2);
        // expect(item0.data).toEqual(sampleDataBase16);
        console.log('OK %o', res);
      }
    }
  });

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
