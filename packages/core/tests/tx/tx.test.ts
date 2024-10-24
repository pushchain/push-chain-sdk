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
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import { INIT_DID_TX } from '../data';

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
  it('should send for a INIT_DID tx', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX.masterPrivateKey as `0x${string}`
    );
    const signer = {
      account: Address.toPushCAIP(account.address, ENV.DEV),
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const txInstance = await Tx.initialize(env);
    const res = await txInstance.send(INIT_DID_TX.unsignedInitDIDTx, signer);
    expect(typeof res).toEqual('string');
  });
  it('should reject for a INIT_DID tx with different signer', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX.masterPrivateKey as `0x${string}`
    );
    const randomPk = generatePrivateKey();
    const randomAccount = privateKeyToAccount(randomPk);
    // Account is correct but signer is different
    const signer = {
      account: Address.toPushCAIP(account.address, ENV.DEV),

      signMessage: async (data: Uint8Array) => {
        const signature = await randomAccount.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const txInstance = await Tx.initialize(env);
    await expect(
      txInstance.send(INIT_DID_TX.unsignedInitDIDTx, signer)
    ).rejects.toThrow();
  });
  it('should reject for a INIT_DID tx with different sender Address', async () => {
    const account = privateKeyToAccount(
      INIT_DID_TX.masterPrivateKey as `0x${string}`
    );
    const randomPk = generatePrivateKey();
    const randomAccount = privateKeyToAccount(randomPk);
    // Signer is correct but account is different
    const signer = {
      account: Address.toPushCAIP(randomAccount.address, ENV.DEV),

      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    const txInstance = await Tx.initialize(env);
    await expect(
      txInstance.send(INIT_DID_TX.unsignedInitDIDTx, signer)
    ).rejects.toThrow();
  });
  // TODO: Should reject INIT_DID tx with wrong signature in walletToEncDerivedKey mapping
  it('should send for a custom tx', async () => {
    const txInstance = await Tx.initialize(env);
    const recipients = [
      `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
    ];
    const tx = txInstance.createUnsigned(
      'CUSTOM:CORE_SDK',
      recipients,
      new Uint8Array([1, 2, 3, 4, 5])
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
  });
  it('should reject custom tx with wrong signer', async () => {
    const txInstance = await Tx.initialize(env);
    const recipients = [
      `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
    ];
    const tx = txInstance.createUnsigned(
      'CUSTOM:CORE_SDK',
      recipients,
      new Uint8Array([1, 2, 3, 4, 5])
    );

    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const signer = {
      // Random signer address
      account: Address.toPushCAIP(privateKeyToAddress(generatePrivateKey())),
      signMessage: async (data: Uint8Array) => {
        const signature = await account.signMessage({
          message: { raw: data },
        });
        return hexToBytes(signature);
      },
    };
    await expect(txInstance.send(tx, signer)).rejects.toThrow();
  });
  it('should reject custom tx with wrong signature', async () => {
    const txInstance = await Tx.initialize(env);
    const recipients = [
      `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
      `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
    ];
    const tx = txInstance.createUnsigned(
      'CUSTOM:CORE_SDK',
      recipients,
      new Uint8Array([1, 2, 3, 4, 5])
    );

    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const signer = {
      // Random signer address
      account: Address.toPushCAIP(privateKeyToAddress(generatePrivateKey())),
      signMessage: async (data: Uint8Array) => {
        const signature = '0x000';
        return hexToBytes(signature);
      },
    };
    await expect(txInstance.send(tx, signer)).rejects.toThrow();
  });
  it('should verify a tx sign by evm address', async () => {
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

    const sigVerification = await verifyMessage({
      address: '0x35B84d6848D16415177c64D64504663b998A6ab4',
      message: { raw: dataToBeSigned },
      signature: deserializedTx.signature,
    });
    expect(sigVerification).toBe(true);
  });
  it('should verify a tx signed by sol addeess', async () => {
    // signed by `69EUYJKr2NE8vHFphyRPSU2tqRbXhMu9gzNo96mjvFLv`
    const sentTx =
      '1210435553544f4d3a505553485f4d41494c1a54736f6c616e613a3565796b7434557346763850384e4a64545245705931767a714b715a4b7664703a36394555594a4b72324e453876484670687952505355327471526258684d7539677a4e6f39366d6a76464c7622336569703135353a313a3078443836333443333942424664343033336330643332383943343531353237353130323432333638312a6d0a0f57656c636f6d6520546f205075736812480a46436f6e67726174756c6174696f6e73206f6e206265696e672073656c656374656420666f722050757368204164766f636174650a0a52656761726473205465616d205075736822100a085072696f726974791204486967683210b51e8e7ac9ea40858c022304b38b6d723a9f0f56543165794a756232526c6379493657337369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304e6a41774f444173496e4a68626d52766255686c65434936496d593259544977593259785a6a4d314d44526d596d45784e7a4a6b593249794d4441324e6a55304d324d344f5449795a5449304d3245694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304e6a41774e544973496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5449334d5451324d4441314f437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a4234597a5131597a63775a574d79596d4d784f5459324d6a6c684d5463304d47466a4f474d784d44686b4d6d466b5a6d51314d6d493159545979595445795a6a6b35595755784d474d354d57497a4e4459314d4459785a444e694d325977596d557a4d6a4e684e7a41774e4751324d4449355a446b354d4456684e6d4a6a5a6a51325a47466b5a6a51334f5749324d6a4a6d4f5441304d3259334e7a42684e32566a4d3256694e324d325932517859794a394c487369626d396b5a556c6b496a6f694d4867354f45593552446b784d45466c5a6a6c434d304935515451314d544d3359575978513045334e6a63315a5551354d4745314d7a55314969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304e6a41774e6a4173496e4a68626d52766255686c65434936496d4d794f54466a595745344f44597a4e444a6d593255784d57526d4e6a6b344f446331597a566a5a5755354d32497a4d546779596a63694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304d7a41774e6a5973496e4e3059585231637949364d58307365794a756232526c535751694f69497765475a45515556685a6a64685a6b4e47596d49305a54526b4d545a45517a5932596b51794d444d355a6d51324d44413051305a6a5a5467694c434a306330317062477870637949364d5463794f5449334d54517a4d4441334f437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a4234596a426b4d6a4e6c4d7a526b4e6a4d304d4445774e5441305a5449334d5749314e7a4d34596a6c695a6a566d59324d784d5463344d6d566a4d4445305a6d59334e6d5934593255334d7a55314e57526a5a6d49775a544d7a4e574a684f444135595756695a574d334d5459325a6a4d334d57526b4d446c6b4f4745344d544d334d7a59325a574d32597a6c6a4e7a67774e575930595751345a6d5a695a4751795a4759334f5449784d32597859794a394c487369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304e6a41774f445173496e4a68626d52766255686c65434936496d5a6a4f574d794d6d4a6d5a4759314d6a46684e446c6b4d5755314f474e6c5a5467334e6a63774e574a6b596a52684d6a6869596d4d694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b794e7a45304e6a41774e7a6373496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5449334d5451324d4441334d437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42344d5755795a474e694e544a6a4e7a45325a544d345957526d5932457a595749794d7a55795a6d59794e444978595449314d446b324d44646a5a4467304e444a684f5467774e6a41335a444134596a6b344f475a684d6a4d355a544933596a49784d3245305a6d5a6d4d7a566a4f5755334d6a6c695a54413259324d795a44597a4e6a4e6b5a6a4d34596d5a6b4e4468684d7a526d595759784e5441324d4759774d7a55344d54526a4d47457859794a395858303d42408db49a8d88ea0b5a0cea8a0bf90fc51fdc870cf6a6eccc428150fbbff51a691b3a1fa19d29bc0f60bc061ad4768c5f73f602e245047629b320c96c08229ea3014a0130';

    const deserializedTx = Tx.deserialize(hexToBytes(`0x${sentTx}`));

    const serializedUnsignedTx = Tx.serialize({
      ...deserializedTx,
      signature: new Uint8Array(0),
    });

    const dataToBeSigned = new TextEncoder().encode(
      toHex(sha256(serializedUnsignedTx))
    );

    const sigVerification = nacl.sign.detached.verify(
      dataToBeSigned,
      deserializedTx.signature,
      bs58.decode('69EUYJKr2NE8vHFphyRPSU2tqRbXhMu9gzNo96mjvFLv')
    );

    expect(sigVerification).toBe(true);
  });
  it('should verify a tx sign by push address', async () => {
    // signed by `push:devnet:pushconsumer1ulpxwud78ctaar5zgeuhmju5k8gpz8najcvxkn`
    const sentTx =
      '1210435553544f4d3a505553485f4d41494c1a3f707573683a6465766e65743a70757368636f6e73756d657231756c707877756437386374616172357a676575686d6a75356b3867707a386e616a6376786b6e2a200a047465737412060a047465737422100a085072696f72697479120448696768321083f01bffe4ff45f6acb525a54dc7277e3a9f0f56543165794a756232526c6379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b324e7a45324d4441774e7a4173496e4a68626d52766255686c65434936496d45324d6a41324f5459314e7a51314d4445324e4449794e47526a4d444e6b4f545a6c5a5467774d4459304f54686b4d7a45304d6a45694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b324e7a45314e7a41774f446773496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5459334d5455334d4441324e437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42345a57566d4f445a694d5759314d4759324f574d794e4445314f57457a5a4449794f474d795a6a4e6c4d324579597a417a4d4749784f5449785a544a6a4e6a426b5a6a5179595745334f5467775a6a4d355a4463354e6a517a4d32566a4e324e6a4e6d49344e57497a597a64684d6a51345a6d4d7a4e7a426b5a6a67784e6a646a4e4463774f5468694d7a517a4e4751324e4745784d6d5530596a526b595745355a4749344e6a55334f44677859794a394c487369626d396b5a556c6b496a6f694d48686d524546465957593359575a44526d4a694e4755305a44453252454d324e6d4a454d6a417a4f575a6b4e6a41774e454e47593255344969776964484e4e6157787361584d694f6a45334d6a6b324e7a45324d4441774e546373496e4a68626d52766255686c65434936496a6b794d5455334d5468684e324d7a4e6d49304d6d5a6d4e325530593259334e325977593256684e6d49344e7a526b4e6a49355a6d55694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b324e7a45314e7a41774e6a4d73496e4e3059585231637949364d58307365794a756232526c535751694f69497765446b34526a6c454f5445775157566d4f55497a516a6c424e4455784d7a64685a6a4644515463324e7a566c52446b775954557a4e5455694c434a306330317062477870637949364d5463794f5459334d5455334d4441304e437769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42344e545a6a4e7a466b5a44426c4d4751315a47466d4d54557a5a44686d596a686b596a646b4f5459325a6a4d355a44466c4f4467334f445a6a4e6a4178596d49794d446b785a44497759574a6c4f5755324d3246695a54426a5a44413359324a6a4e6d46694e57466a4e6d4d7a596d5a6a4d445534596a566a59324a6a4e6a67784e7a5977597a566b4d4749324e544e684f4442684d6a55304d54497a4e4746694f5751325a54517a597a557859794a394c487369626d396b5a556c6b496a6f694d4867354f45593552446b784d45466c5a6a6c434d304935515451314d544d3359575978513045334e6a63315a5551354d4745314d7a55314969776964484e4e6157787361584d694f6a45334d6a6b324e7a45324d4441774f446773496e4a68626d52766255686c65434936496a45314f474d31597a41325a4459334e5751304d44417a4e546b774f4445774e6a686a597a5130596a457a4d444e6c4d54566c4e6d51694c434a776157356e556d567a645778306379493657337369626d396b5a556c6b496a6f694d4867345a5445795a4555784d6b4d7a4e575642516d597a4e5749314e6d49774e4555314d304d30525451324f4755304e6a63794e3055344969776964484e4e6157787361584d694f6a45334d6a6b324e7a45314e7a41774e7a4173496e4e3059585231637949364d58307365794a756232526c535751694f69497765475a45515556685a6a64685a6b4e47596d49305a54526b4d545a45517a5932596b51794d444d355a6d51324d44413051305a6a5a5467694c434a306330317062477870637949364d5463794f5459334d5455334d4441314d797769633352686448567a496a6f7866563073496e4e705a323568644856795a534936496a42344e4455324d47526a4d5459774d7a5132597a457a4e54526a4f444d344f54686a4e7a63314d324a6a4d546378595459794d4455775a546379597a466a4d5456684f5455784d6a63785a6a56694d444d78596a426c597a5133596d59324e325a684e6a5577596a426c4d7a4a68596a4d774d6d5535597a6b344d546b775a444a6a597a55795a474a6b4e44566d5a4445324d3245335954646c4f574e6d596a6c6a59546b354d7a63345a47517859794a395858303d424129e393b87724b2d2b677d94a6b574f811b053b4033c3a81cac80f1f19cc9f1f723b0901d1327d2418c33a6b8647f80ee850f8c2ee477caaafb34e28c45ee13c01b4a0130';

    const deserializedTx = Tx.deserialize(hexToBytes(`0x${sentTx}`));

    const serializedUnsignedTx = Tx.serialize({
      ...deserializedTx,
      signature: new Uint8Array(0),
    });

    const dataToBeSigned = new TextEncoder().encode(
      toHex(sha256(serializedUnsignedTx))
    );

    const sigVerification = await verifyMessage({
      address: Address.pushToEvm(
        'pushconsumer1ulpxwud78ctaar5zgeuhmju5k8gpz8najcvxkn'
      ) as `0x${string}`,
      message: { raw: dataToBeSigned },
      signature: deserializedTx.signature,
    });
    expect(sigVerification).toBe(true);
  });
});
