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
import counterIdlJson from '../../orchestrator/svm-idl/__fixtures__/test_counter.idl.json';

const account = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';
const idl: Idl = {
  address: 'SysvarRent111111111111111111111111111111111', metadata: { name: 'example', version: '1.0.0', spec: '0.1.0' }, instructions: [],
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
  const query = toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl, functionName: 'counter' });
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
  const params = await resolveReadSpecParams(account, { chain: CHAIN.SOLANA_DEVNET, idl }, PUSH_NETWORK.TESTNET_DONUT, {});
  const address = '0x1111111111111111111111111111111111111111';
  const prepared = buildReadSpecFromPreflight({ destination: resolveDestination(params.destination), protocolFee: 0n, observedChainHeight: 100n, pushBlockNumber: 200n, pushGasPrice: 1n, universalCallback: address, universalCore: address, fetchedAt: 0 }, params, { refundTo: address });
  expect(prepared.resultShape).toEqual({ kind: 'svmAccount', idl });
  expect(prepared.spec.account.owner).toBe('0x' + '00'.repeat(32));
  expect(lookup).not.toHaveBeenCalled();
});

it('rejects invalid IDLs and incompatible public options', () => {
  for (const extra of [{ functionName: 'missing' }, { abi: [] }, { args: [] }, { chain: CHAIN.ETHEREUM_SEPOLIA }, { storageSlot: 0n }]) {
    expect(() => toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl, ...extra } as never)).toThrow();
  }
  expect(() => toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl, accountName: 'counter' } as never)).toThrow(/accountName was removed/);
  expect(() => toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl: { ...idl, accounts: [] } })).toThrow(/no accounts/);
  expect(() => toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl: { ...idl, address: 'nope' } })).toThrow(/invalid Solana account IDL/);
  expect(() => toReadQuery('not-a-key', { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl })).toThrow(/base58/);
});

// ── discriminator-based decoding (no accountName) ──

const counterIdl = counterIdlJson as Idl;
const COUNTER_PROGRAM = new PublicKey(counterIdl.address);

describe('idl without functionName: the layout comes from the discriminator', () => {
  const coder = new BorshAccountsCoder(counterIdl);
  const authority = new PublicKey('6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg');

  it('decodes each account type with the layout its 8-byte discriminator names', async () => {
    const shape = encodeSvmQueryEnvelope(toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl }) as never).resultShape;
    expect(shape).toEqual({ kind: 'svmAccount', idl: counterIdl });
    const counterName = counterIdl.accounts!.find(a => a.name === 'Counter')!.name;
    const stakeName = counterIdl.accounts!.find(a => a.name === 'Stake')!.name;
    const counterFields = counterIdl.types!.find(t => t.name === counterName)!;
    const stakeFields = counterIdl.types!.find(t => t.name === stakeName)!;
    const sample = (fields: typeof counterFields) => Object.fromEntries((fields.type as { fields: { name: string; type: unknown }[] }).fields.map(f => [f.name, f.type === 'pubkey' ? authority : f.type === 'u8' ? 1 : new BN(7)]));
    for (const [name, fields] of [[counterName, counterFields], [stakeName, stakeFields]] as const) {
      const data = await coder.encode(name, sample(fields));
      const decoded = decodeReadResult(bytesToHex(data), shape) as { accountName: string; value: Record<string, unknown> };
      expect(decoded.accountName).toBe(name);
      expect(JSON.stringify(decoded.value)).toBe(JSON.stringify(coder.decode(name, data)));
    }
  });

  it('names the discriminator when nothing matches', () => {
    const shape = { kind: 'svmAccount', idl: counterIdl } as const;
    expect(() => decodeReadResult(`0x${'ab'.repeat(40)}`, shape)).toThrow(/no IDL account discriminator matches .*0xabababab/);
  });

  it('accepts functionName in snake, camel or Pascal case and pins the layout', () => {
    for (const functionName of ['Counter', 'counter']) {
      const q = toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName });
      expect(q).toMatchObject({ type: 'rawAccountData', account, accountName: 'Counter' });
    }
    const multi: Idl = { ...idl, accounts: [{ name: 'StakeVault', discriminator: [9, 9, 9, 9, 9, 9, 9, 9] }], types: [{ name: 'StakeVault', type: { kind: 'struct', fields: [{ name: 'n', type: 'u8' }] } }] };
    for (const functionName of ['stake_vault', 'stakeVault', 'StakeVault']) {
      expect(toReadQuery(account, { chain: CHAIN.SOLANA_DEVNET, idl: multi, functionName })).toMatchObject({ accountName: 'StakeVault' });
    }
  });
});

describe('idl with the program id as subject: args are the PDA seeds', () => {
  const authority = new PublicKey('6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg');
  const counterPda = PublicKey.findProgramAddressSync([Buffer.from('counter')], COUNTER_PROGRAM)[0];
  const stakePda = PublicKey.findProgramAddressSync([Buffer.from('stake'), authority.toBuffer()], COUNTER_PROGRAM)[0];
  const read = (functionName: string | undefined, args?: unknown[], subject = counterIdl.address) =>
    toReadQuery(subject, { chain: CHAIN.SOLANA_DEVNET, idl: counterIdl, functionName, args } as never);

  it('derives a constant-seed PDA with no args', () => {
    expect(read('counter')).toMatchObject({ type: 'rawAccountData', account: counterPda.toBase58(), accountName: 'Counter' });
    expect(read('Counter', [])).toMatchObject({ account: counterPda.toBase58() });
  });

  it('fills an account seed from base58, 0x-hex or a PublicKey', () => {
    for (const a of [authority.toBase58(), bytesToHex(authority.toBytes()), authority]) {
      expect(read('stake', [a])).toMatchObject({ account: stakePda.toBase58(), accountName: 'Stake' });
    }
  });

  it('accepts the program id in 0x-hex form too', () => {
    expect(read('counter', [], bytesToHex(COUNTER_PROGRAM.toBytes()))).toMatchObject({ account: counterPda.toBase58() });
  });

  it('refuses to guess: wrong seed count, bad pubkey, missing functionName, args on a non-program subject', () => {
    expect(() => read('stake', [])).toThrow(/expected 1 args, got 0/);
    expect(() => read('stake', ['not-a-key'])).toThrow(/pubkey/);
    expect(() => read(undefined)).toThrow(/pass functionName/);
    expect(() => read('stake', [authority.toBase58()], account)).toThrow(/args are PDA seeds/);
  });

  it('refuses layouts the IDL gives no seeds for, and conflicting seed templates', () => {
    const noSeeds: Idl = { ...counterIdl, instructions: [] };
    expect(() => toReadQuery(counterIdl.address, { chain: CHAIN.SOLANA_DEVNET, idl: noSeeds, functionName: 'counter' })).toThrow(/no PDA seeds/);
    const [ix] = counterIdl.instructions;
    const conflicting: Idl = {
      ...counterIdl,
      instructions: [...counterIdl.instructions, { ...ix, name: 'other', accounts: [{ name: 'counter', pda: { seeds: [{ kind: 'const', value: [1] }] } }] } as never],
    };
    expect(() => toReadQuery(counterIdl.address, { chain: CHAIN.SOLANA_DEVNET, idl: conflicting, functionName: 'counter' })).toThrow(/different seeds/);
  });
});
