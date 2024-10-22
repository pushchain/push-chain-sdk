import { Address, Tx } from '../../src';
import { TxCategory } from '../../src/lib/tx/tx.types';
import { InitDid } from '../../src/lib/generated/txData/init_did';
import { config } from '../config';
import { TxResponse } from '../../src/lib/tx/tx.types';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { hexToBytes, toHex, verifyMessage } from 'viem';
import { ENV } from '../../src/lib/constants';
import { sha256 } from '@noble/hashes/sha256';

// Mock data for testing
const mockInitDidTxData: InitDid = {
  masterPubKey: 'efdgakce',
  derivedKeyIndex: 0,
  derivedPubKey: 'jdwdwowfn',
  walletToEncDerivedKey: {
    'push:devnet:push1xkuy66zg69jp29muvnty2prx8wvc5645f9y5ux': {
      encDerivedPrivKey: {
        ciphertext: 'qwe',
        salt: 'qaz',
        nonce: '',
        version: 'push:v5',
        preKey: '',
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

describe('Tx', () => {
  const env = config.ENV;
  const txChecker = (tx: TxResponse) => {
    expect(tx).toHaveProperty('txnHash');
    expect(tx).toHaveProperty('ts');
    expect(tx).toHaveProperty('blockHash');
    expect(tx).toHaveProperty('category');
    expect(tx).toHaveProperty('sender');
    expect(tx).toHaveProperty('status');
    expect(tx).toHaveProperty('recipients');
    expect(tx).toHaveProperty('txnData');
    expect(tx).toHaveProperty('sig');
  };
  it('should create an unsigned transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const tx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    expect(tx).toEqual({
      type: 0,
      category: TxCategory.INIT_DID,
      sender: '',
      recipients: mockRecipients,
      data: Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID),
      salt: tx.salt,
      apiToken: tx.apiToken,
      signature: new Uint8Array(0),
      fee: '0',
    });
  });
  it('should serialize an unsigned transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const unsignedTx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    const serializedTx = Tx.serialize(unsignedTx);
    expect(serializedTx).toBeInstanceOf(Uint8Array);
    expect(unsignedTx).toEqual(Tx.deserialize(serializedTx));
  });
  it('should serialize a signed transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const unsignedTx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    const signedTx = {
      ...unsignedTx,
      signature: new Uint8Array([6, 7, 8, 9, 10]),
      sender: 'eip155:1:0xabcc',
    };
    const serializedTx = Tx.serialize(signedTx);
    expect(serializedTx).toBeInstanceOf(Uint8Array);
    expect(signedTx).toEqual(Tx.deserialize(serializedTx));
  });
  it('should serialize a Tx data into a Uint8Array', () => {
    const serializedTxData = Tx.serializeData(
      mockInitDidTxData,
      TxCategory.INIT_DID
    );
    expect(serializedTxData).toBeInstanceOf(Uint8Array);
    expect(serializedTxData.length).toBeGreaterThan(0);
  });
  it('should deserialize a Uint8Array into a Tx Data object', () => {
    const serializedTxData = Tx.serializeData(
      mockInitDidTxData,
      TxCategory.INIT_DID
    );
    const deserializedTxData = Tx.deserializeData(
      serializedTxData,
      TxCategory.INIT_DID
    );
    expect(deserializedTxData).toEqual(mockInitDidTxData);
  });
  it('should get transactions with default parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get();
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with custom parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now() / 1000),
      'DESC',
      10,
      2
    );
    expect(res.blocks).toBeInstanceOf(Array);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions for a specific user', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4'
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Category', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.get(
      Math.floor(Date.now()),
      'DESC',
      10,
      1,
      undefined,
      'CUSTOM:PUSH_MAIL'
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Sender', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getBySender(
      'push:devnet:push18zc5t7jjnzyvzjs0707gy5axtntzqgv5w6lnuh',
      Math.floor(Date.now()),
      'DESC',
      10,
      1
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should get transactions with a specific Recipient', async () => {
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.getByRecipient(
      'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      Math.floor(Date.now()),
      'DESC',
      10,
      1
    );
    expect(res.blocks).toBeInstanceOf(Array);
    expect(res.blocks.length).toBeGreaterThan(0);
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should search for a tx by hash', async () => {
    const txInstance = await Tx.initialize(env);
    const txHash = '9f636ac0faa040a74ae49410528c5634';
    const res = await txInstance.search(txHash);
    if (res.blocks.length > 0) {
      expect(res.blocks.length).toEqual(1);
      expect(res.blocks[0].transactions.length).toEqual(1);
    }
    res.blocks.forEach((block) => {
      block.transactions.forEach((tx) => txChecker(tx));
    });
  });
  it('should send for a tx', async () => {
    const txInstance = await Tx.initialize(env);
    for (let i = 0; i < 1; i++) {
      const recipients = [
        `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
        `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
      ];
      const tx = txInstance.createUnsigned(
        TxCategory.INIT_DID,
        recipients,
        Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
      );

      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      const signer = {
        account: Address.toPushCAIP(account.address, ENV.DEV),
        signMessage: async (data: Uint8Array) => {
          const signature = await account.signMessage({
            message: { raw: data },
          });
          return hexToBytes(signature);
        },
      };
      const res = await txInstance.send(tx, signer);
      expect(typeof res).toEqual('string');
    }
  });

  it('should verify a tx', async () => {
    // signed by `eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4`
    const sentTx =
      '1210435553544f4d3a505553485f4d41494c1a336569703135353a313a30783335423834643638343844313634313531373763363444363435303436363362393938413661623422336569703135353a313a3078443836333443333942424664343033336330643332383943343531353237353130323432333638312a740a0e446576636f6e205469636b65747312500a4e4465617220557365720a436f6e67726174756c6174696f6e73206f6e206265696e672073656c656374656420666f722067657474696e67207469636b65747320746f20446576636f6e203230323422100a085072696f72697479120448696768321027d5c07d7d5b4e719db21915169efb573a9f0f56543165794a756232526c6379493657337369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794f4441774e544973496e4a68626d52766255686c65434936496a6b32596a63345a6a646d4e7a4e694d546733596a4d784e6a51794e3259314f47497a595755785a545a685a4745794d6d55304d5445694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794e5441784f545573496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5449334d5449314d4445304e797769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42345a546b7a4e54517a4e7a686d4f4759344d57566d4e6a6b32597a5a6d4e4451305a574532596a4d794e6d55774d6a4e685932566b597a46695a6a55774d6d52694d54526d596a4934596a45344d6a4e6d596a686b4d44566b5a546c6b597a51324e7a466a5a44526a4e6d4d7a596a67784e4751305a6a493259544e6d4e574d3459574931593256684f5449354e6a55345a5455324e544e694d5463314f544e695a4755305a5455344d54517859694a394c487369626d396b5a556c6b496a6f694d4867354f45593552446b784d45466c5a6a6c434d304935515451314d544d3359575978513045334e6a63315a5551354d4745314d7a55314969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794f4441774e545973496e4a68626d52766255686c65434936496d55784d475268596a51784e546c695a4467304d6a67304e5463354e7a59354e6a55314e32566a4f446b334d5463304e7a466d4d544d694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794e5441784e544973496e4e3059585231637949364d58307365794a756232526c535751694f69497765475a45515556685a6a64685a6b4e47596d49305a54526b4d545a45517a5932596b51794d444d355a6d51324d44413051305a6a5a5467694c434a306330317062477870637949364d5463794f5449334d5449314d44457a4d437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42344e6a426c4d546c6b5a54426d4e6d4d325a575a694f5449304d6a45354e5749344d446379597a6c695a5451314d7a45324d546b314d4455314e5452684e7a68694f444a6b4d5467354d7a566d4e57526b5a4455345a6a4a6b5a6d56685a4464685a6d59315a574a684f5441354e4751794e6a4a694e5446684e6a64684e6a4d344e7a4a6a4e6d59344e7a6b344e47557a4d6a67354d7a4d3359574d304e444e694e5467784e44646b4f44597859794a394c487369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794f4441774e6a5573496e4a68626d52766255686c65434936496d59314e474d324f5451314e4467325a4755354e6a4d78596a4e6c4e575a694e57526a4e5441304f47497a4e5749334d6a426d596d45694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45794e5441774f544573496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5449334d5449314d4445784d697769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42345a6a59305a5464685a445978595451354d7a41344e44497a597a59794d6d49354d6a4a6b4d54566b5954526d597a63324d6a6b794d546c6d596a6c684e6a63324e44646d59574d775a6d5a695a6d4d775a6a4a6a4e4459304d6d457a4e6a4531597a45304f5745324e6a566c4f5455344f444934596d4a694f44597759574d334e6d59334f5441344d7a686a5a5441344f47457a597a4579597a45324d7a55345954637a4d7a4e6b5a47557859794a395858303d424152ffaa59451eb11fca4770f5d8f958603deb189359ab3fbb9cf30793095573b87dfb8ba4d979d0a69ed48bc6a145d58ea5783b59a40ba758168ffb8961fdde391b4a0130';

    const deserializedTx = Tx.deserialize(hexToBytes(`0x${sentTx}`));

    const serializedUnsignedTx = Tx.serialize({
      ...deserializedTx,
      signature: new Uint8Array(0),
    });

    const dataToBeSigned = new TextEncoder().encode(
      toHex(sha256(serializedUnsignedTx))
    );

    console.log(new TextDecoder().decode(dataToBeSigned));

    const sigVerification = await verifyMessage({
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
      message: { raw: dataToBeSigned },
      signature: deserializedTx.signature,
    });
    expect(sigVerification).toBe(true);
  });
});
