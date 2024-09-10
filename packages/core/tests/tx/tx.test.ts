import { Tx } from '../../src';
import { TxCategory } from '../../src/lib/tx/tx.types';
import { InitDid } from '../../src/lib/generated/txData/init_did';
import { config } from '../config';

// Mock data for testing
const mockInitDidTxData: InitDid = {
  did: 'did:example:123',
  masterPubKey: 'master_pub_key',
  derivedKeyIndex: 0,
  derivedPubKey: 'derived_pub_key',
  walletToEncDerivedKey: {
    push10222n3232mwdeicej3: 'stringified_encrypted_pk',
  },
};
const mockRecipients = [
  'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
  'eip155:97:0xD8634C39BBFd4033c0d3289C4515275102423681',
];

describe('Tx', () => {
  const env = config.ENV;
  it('should create an unsigned transaction', async () => {
    const txInstance = await Tx.initialize(env);
    const tx = await txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    // console.log(tx);
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
    const transactions = await txInstance.get();
    expect(transactions).toBeInstanceOf(Array);
  });
  it('should get transactions with custom parameters', async () => {
    const txInstance = await Tx.initialize(env);
    const transactions = await txInstance.get(
      Math.floor(Date.now() / 1000),
      'DESC',
      10,
      2
    );
    expect(transactions).toBeInstanceOf(Array);
  });
  it('should search for a tx by hash', async () => {
    const txInstance = await Tx.initialize(env);
    const txHash = 'sample-tx-hash';
    const tx = await txInstance.search(txHash);
    expect(tx).toBeInstanceOf(Object);
  });
  it('should send for a tx with sessionKey', async () => {
    const txInstance = await Tx.initialize(env);
    const tx = txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    await txInstance.send(tx, {
      sender: 'eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4',
      privKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    });
  });
  it('should send for a tx by connecting to Push Wallet', async () => {
    const txInstance = await Tx.initialize(env);
    const tx = txInstance.createUnsigned(
      TxCategory.INIT_DID,
      mockRecipients,
      Tx.serializeData(mockInitDidTxData, TxCategory.INIT_DID)
    );
    await txInstance.send(tx);
  });
});
