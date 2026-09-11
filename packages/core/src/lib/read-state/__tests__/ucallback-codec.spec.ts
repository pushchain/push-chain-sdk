import { readFileSync } from 'fs';
import { join } from 'path';
import { bytesToHex } from 'viem';
import { BinaryWriter } from '@bufbuild/protobuf/wire';
import { ReadRequest } from '../../generated/ucallback/v1';
import {
  QueryReadsByTxRequest,
  QueryReadsByTxResponse,
  QueryUniversalReadRequest,
  QueryUniversalReadResponse,
  ReadErrorCode,
  ReadStatus,
  UniversalRead,
  UniversalReadStatus,
} from '../../generated/ucallback/v1';

const fixture = (name: string) =>
  new Uint8Array(Buffer.from(readFileSync(join(__dirname, 'fixtures', 'node', name), 'utf8').trim(), 'base64'));

/** Real abci_query responses captured from Donut on 2026-09-09 — the regression guard for the hand-authored codec. */
describe('ucallback.v1 codecs against real Donut responses', () => {
  it('skips future unknown fields while preserving known record bytes', () => {
    const bytes = fixture('universal-read.success-evm.b64');
    const future = new BinaryWriter().uint32((99 << 3) | 2).string('future field').finish();
    expect(QueryUniversalReadResponse.decode(new Uint8Array([...bytes, ...future]))).toEqual(QueryUniversalReadResponse.decode(bytes));
  });

  it('rejects uint64 heights that cannot be represented safely instead of rounding', () => {
    const bytes = new BinaryWriter().uint32(56).uint64(9007199254740993n).finish();
    expect(() => ReadRequest.decode(bytes)).toThrow(/MAX_SAFE_INTEGER/);
  });
  it('SUCCESS EVM read 0xf3d62fb9… — every field', () => {
    const { read } = QueryUniversalReadResponse.decode(fixture('universal-read.success-evm.b64'));
    expect(read).toBeDefined();
    const r = read!;
    expect(r.id).toBe('0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168');
    expect(r.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
    expect(r.request?.destinationChain).toBe('eip155:11155111');
    expect(r.request?.callbackTarget.toLowerCase()).toBe('0x5f7221d31a01a71662cabeec2567c55ad03e2fb7');
    expect(r.request?.callbackBudget).toBe('50000000000000000');
    expect(r.request?.protocolFee).toBe('0');
    expect(r.request?.destinationBlockHeight).toBe(11667326);
    expect(r.request?.createdAtHeight).toBe(22957752);
    expect(r.request?.expiryBlockHeight).toBe(22958748);
    expect(r.request?.minConfirmations).toBe(1);
    expect(r.request?.callbackGasLimit).toBe(200000);
    expect(r.request?.owner.length).toBe(20);
    expect(r.request?.query.length).toBeGreaterThan(0);
    expect(r.result?.status).toBe(ReadStatus.READ_STATUS_SUCCESS);
    expect(r.result?.errorCode).toBe(ReadErrorCode.READ_ERROR_UNSPECIFIED);
    expect(bytesToHex(r.result!.resultData)).toBe('0x000000000000000000000000000000000000000000000092b406e140cc2c8871');
    expect(r.pcTx).toHaveLength(2);
    expect(r.pcTx[0].txHash).toBe('0x1d241ed89c868aa7d032ecb82aaf9608d7a8822def82dbd704ce5d2dd59899d2');
    expect(r.pcTx[0].gasUsed).toBe(118289);
    expect(r.pcTx[1].gasUsed).toBe(52459);
    expect(r.ballotKey).toHaveLength(64);
    expect(r.expiryAttempts).toBe(0);
  });

  it('ERROR read 0xeba3eb9e… — INVALID_QUERY with empty result_data', () => {
    const { read } = QueryUniversalReadResponse.decode(fixture('universal-read.error-invalid-query.b64'));
    expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
    expect(read?.result?.status).toBe(ReadStatus.READ_STATUS_ERROR);
    expect(read?.result?.errorCode).toBe(ReadErrorCode.READ_ERROR_INVALID_QUERY);
    expect(read?.result?.resultData.length).toBe(0);
  });

  it('EXPIRED read 0x4a6e27e0… — one pc_tx, expiry_attempts 1, no result', () => {
    const { read } = QueryUniversalReadResponse.decode(fixture('universal-read.expired.b64'));
    expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_EXPIRED);
    expect(read?.expiryAttempts).toBe(1);
    expect(read?.pcTx).toHaveLength(1);
    expect(read?.pcTx[0].txHash).toBe('0x4a909d5d6fe5b808969ae6367b9362275b94457acc9ad5317302e2d9f0ecc860');
    expect(read?.request?.minConfirmations).toBe(500);
  });

  it('callback-reverted read 0x9f0466e2… — node still says FULFILLED with SUCCESS (documented semantics)', () => {
    const { read } = QueryUniversalReadResponse.decode(fixture('universal-read.callback-reverted.b64'));
    expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
    expect(read?.result?.status).toBe(ReadStatus.READ_STATUS_SUCCESS);
  });

  it('SVM and web2 reads decode with their namespaces and result bytes', () => {
    const svm = QueryUniversalReadResponse.decode(fixture('universal-read.svm.b64')).read!;
    expect(svm.request?.destinationChain).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(svm.request?.owner.length).toBe(32);
    expect(bytesToHex(svm.result!.resultData)).toBe('0x000000000000000000000000000000000000000000000000000000002b5786fd');
    const web2 = QueryUniversalReadResponse.decode(fixture('universal-read.web2.b64')).read!;
    expect(web2.request?.destinationChain).toBe('web2:https');
    expect(web2.request?.destinationBlockHeight).toBe(0);
    expect(bytesToHex(web2.result!.resultData)).toBe(
      '0x00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000',
    );
  });

  it('ReadsByTx keyed on the SDK tx hash — the UEA-originated read', () => {
    const { reads } = QueryReadsByTxResponse.decode(fixture('reads-by-tx.uea-originated.b64'));
    expect(reads).toHaveLength(1);
    expect(reads[0].id).toBe('0xdc0a66ba9d265c84f06ac97f49a20135a65df308c19cc9ab7b6f716e383e73cb');
    expect(reads[0].request?.requestedTxHash).toBe('0x0293d57e606d6fec8ce6364cad82a0c74b517aaaf294107b5a6e43fcc25e7ee9');
    expect(reads[0].request?.revertRecipient.toLowerCase()).toBe('0x5c70c864cf1adfb04a0e107ffa248ba3600eab8d');
  });

  it('request encoders produce the exact bytes the node expects (field 1, wire type 2)', () => {
    const id = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168';
    const bytes = QueryUniversalReadRequest.encode(QueryUniversalReadRequest.fromPartial({ requestId: id })).finish();
    expect(bytes[0]).toBe(0x0a);
    expect(bytes[1]).toBe(id.length);
    expect(Buffer.from(bytes.slice(2)).toString('utf8')).toBe(id);
    const tx = QueryReadsByTxRequest.encode(QueryReadsByTxRequest.fromPartial({ txHash: id })).finish();
    expect(tx).toEqual(bytes); // same shape: field 1, string
    expect(QueryReadsByTxRequest.decode(tx).txHash).toBe(id);
  });

  it('UniversalRead round-trips through encode/decode', () => {
    const original = QueryUniversalReadResponse.decode(fixture('universal-read.success-evm.b64')).read!;
    const again = UniversalRead.decode(UniversalRead.encode(original).finish());
    expect(again).toEqual(original);
  });

  it('empty response → no record, no throw', () => {
    expect(QueryReadsByTxResponse.decode(new Uint8Array(0)).reads).toEqual([]);
    expect(QueryUniversalReadResponse.decode(new Uint8Array(0)).read).toBeUndefined();
  });
});
