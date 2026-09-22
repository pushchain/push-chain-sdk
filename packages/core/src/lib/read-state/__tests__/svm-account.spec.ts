import { BorshAccountsCoder, BN, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { bytesToHex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { resolveReadSpecParams, toReadQuery } from '../read-params';
import { decodeReadResult } from '../result-decoder';
import { encodeSvmQueryEnvelope, deriveAssociatedTokenAddress, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '../envelopes/svm';
import { computeReadQueryKey } from '../registry';
import { buildReadSpecFromPreflight } from '../spec-builder';
import { resolveDestination } from '../destination';

const account = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';
const idl: Idl = {
  address: account, metadata: { name: 'example', version: '1.0.0', spec: '0.1.0' }, instructions: [],
  accounts: [{ name: 'counter', discriminator: [1, 2, 3, 4, 5, 6, 7, 8] }],
  types: [{ name: 'counter', type: { kind: 'struct', fields: [{ name: 'count', type: 'u64' }] } }],
};
afterEach(() => jest.restoreAllMocks());

it.each([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])('detects mint owner %s and derives its ATA', async program => {
  const data = Buffer.alloc(82); data[45] = 1;
  const lookup = jest.spyOn(Connection.prototype, 'getAccountInfo').mockResolvedValue({ data, owner: program, executable: false, lamports: 1, rentEpoch: 0 });
  const result = await resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, token: mint }, PUSH_NETWORK.TESTNET_DONUT, { [CHAIN.SOLANA_DEVNET]: ['http://localhost:8899'] });
  expect(result.query).toEqual({ type: 'splTokenAccount', account: deriveAssociatedTokenAddress(account, mint, program).toBase58() });
  expect(lookup).toHaveBeenCalledWith(new PublicKey(mint), 'finalized');
  expect((lookup.mock.contexts[0] as unknown as Connection).rpcEndpoint).toBe('http://localhost:8899');
});

it('rejects missing mints, wrong owners and token accounts instead of guessing', async () => {
  const lookup = jest.spyOn(Connection.prototype, 'getAccountInfo');
  const resolve = () => resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, token: mint }, PUSH_NETWORK.TESTNET_DONUT, {});
  lookup.mockResolvedValueOnce(null);
  await expect(resolve()).rejects.toThrow(/does not exist/);
  lookup.mockResolvedValueOnce({ owner: new PublicKey(account), data: Buffer.alloc(82), executable: false, lamports: 1, rentEpoch: 0 });
  await expect(resolve()).rejects.toThrow(/not owned/);
  const data = Buffer.alloc(165); data[45] = 1;
  lookup.mockResolvedValueOnce({ owner: TOKEN_PROGRAM_ID, data, executable: false, lamports: 1, rentEpoch: 0 });
  await expect(resolve()).rejects.toThrow(/initialized mint/);
  lookup.mockResolvedValueOnce({ owner: TOKEN_2022_PROGRAM_ID, data: Buffer.alloc(82), executable: false, lamports: 1, rentEpoch: 0 });
  await expect(resolve()).rejects.toThrow(/initialized mint/);
});

it('falls back on RPC failure but never defaults the token program', async () => {
  const data = Buffer.alloc(166); data[45] = 1; data[165] = 1;
  const lookup = jest.spyOn(Connection.prototype, 'getAccountInfo').mockRejectedValueOnce(new Error('rpc down')).mockResolvedValueOnce({ owner: TOKEN_2022_PROGRAM_ID, data, executable: false, lamports: 1, rentEpoch: 0 });
  await resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, token: mint }, PUSH_NETWORK.TESTNET_DONUT, { [CHAIN.SOLANA_DEVNET]: ['http://localhost:8899', 'http://localhost:8900'] });
  expect(lookup).toHaveBeenCalledTimes(2);
  lookup.mockRejectedValue(new Error('all RPCs unavailable'));
  await expect(resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, token: mint }, PUSH_NETWORK.TESTNET_DONUT, { [CHAIN.SOLANA_DEVNET]: ['http://localhost:8899'] })).rejects.toThrow('all RPCs unavailable');
});

it('uses unchanged raw-account wire bytes while retaining IDL decoding metadata', async () => {
  const query = toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl, accountName: 'counter' });
  const encoded = encodeSvmQueryEnvelope(query as never);
  const raw = { type: 'rawAccountData', account } as const;
  expect(encoded.encoded).toBe(encodeSvmQueryEnvelope(raw).encoded);
  expect(computeReadQueryKey({ chain: CHAIN.SOLANA_DEVNET }, query)).toBe(computeReadQueryKey({ chain: CHAIN.SOLANA_DEVNET }, raw));
  expect(encoded.resultShape).toEqual({ kind: 'svmAccount', idl, accountName: 'counter' });
  const data = await new BorshAccountsCoder(idl).encode('counter', { count: new BN('9007199254740993') });
  const decoded = decodeReadResult(bytesToHex(data), encoded.resultShape);
  expect((decoded as { value: { count: BN } }).value.count.toString()).toBe('9007199254740993');
  data[0] = 99;
  expect(() => decodeReadResult(bytesToHex(data), encoded.resultShape)).toThrow(/discriminator/);
  expect(() => decodeReadResult('0x', encoded.resultShape)).toThrow();
});

it('carries account decoding through async public preparation without a destination query', async () => {
  const lookup = jest.spyOn(Connection.prototype, 'getAccountInfo');
  const params = await resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, idl, accountName: 'counter' }, PUSH_NETWORK.TESTNET_DONUT, {});
  const address = '0x1111111111111111111111111111111111111111';
  const prepared = buildReadSpecFromPreflight({ destination: resolveDestination(params.destination), protocolFee: 0n, observedChainHeight: 100n, pushBlockNumber: 200n, pushGasPrice: 1n, universalCallback: address, universalCore: address, fetchedAt: 0 }, params, { refundTo: address });
  expect(prepared.resultShape).toEqual({ kind: 'svmAccount', idl, accountName: 'counter' });
  expect(prepared.spec.account.owner).toBe('0x' + '00'.repeat(32));
  expect(lookup).not.toHaveBeenCalled();
});

it('rejects invalid IDLs and incompatible public options', () => {
  for (const extra of [{ accountName: 'missing' }, { abi: [] }, { functionName: 'getCounter', args: [] }, { chain: CHAIN.ETHEREUM_SEPOLIA }]) {
    expect(() => toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl, accountName: 'counter', ...extra })).toThrow();
  }
});
