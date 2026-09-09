import { PublicKey } from '@solana/web3.js';
import { CHAIN } from '../../constants/enums';
import { InvalidReadQueryError } from '../errors';
import { deriveAssociatedTokenAddress } from '../envelopes/svm';
import { ERC20_BALANCE_OF_ABI, READ_CHAIN_WEB2, toBuildReadSpecParams, toLifecycleOptions, toReadQuery, type ReadOptions } from '../read-params';

const USER = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf' as const;
const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const SOL_OWNER = '3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb';
const SOL_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const cb = { callback: { gasLimit: 200_000n } };
const ABI = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const;

describe('read(subject, options) grammar → ReadQuery', () => {
  it('derives Token-2022 ATAs using the selected program', () => {
    const owner = '11111111111111111111111111111111';
    const mint = 'So11111111111111111111111111111111111111112';
    expect(toReadQuery(owner, { chain: CHAIN.SOLANA_DEVNET, token: mint, tokenProgram: 'token-2022' })).toEqual({
      type: 'splTokenAccount', account: '2sZUUBGq1i6aE47ZoxCaCW89jmYm2EXLPPmNMgMDXHMS',
    });
    expect(() => toReadQuery(USER, { chain: CHAIN.ETHEREUM_SEPOLIA, token: TOKEN, tokenProgram: 'token-2022' })).toThrow(InvalidReadQueryError);
    expect(() => toReadQuery(owner, { chain: CHAIN.SOLANA_DEVNET, tokenProgram: 'token-2022' })).toThrow(InvalidReadQueryError);
  });
  it('EVM: no query key → native balance of subject', () => {
    expect(toReadQuery(USER, { chain: CHAIN.ETHEREUM_SEPOLIA })).toEqual({ type: 'accountBalance', target: USER });
  });
  it('EVM: token → balanceOf(subject) on the token, typed uint256', () => {
    expect(toReadQuery(USER, { chain: CHAIN.ETHEREUM_SEPOLIA, token: TOKEN })).toEqual({
      type: 'contractCall', target: TOKEN, abi: ERC20_BALANCE_OF_ABI, functionName: 'balanceOf', args: [USER],
    });
  });
  it('EVM: abi + functionName → typed call on subject', () => {
    expect(toReadQuery(TOKEN, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: ABI, functionName: 'totalSupply' })).toEqual({
      type: 'contractCall', target: TOKEN, abi: ABI, functionName: 'totalSupply', args: undefined,
    });
  });
  it('EVM: storageSlot', () => {
    expect(toReadQuery(TOKEN, { chain: CHAIN.ETHEREUM_SEPOLIA, storageSlot: 2n })).toEqual({ type: 'storageSlot', target: TOKEN, slot: 2n });
  });
  it('SVM: native → lamports of subject; token → the ATA derived offline', () => {
    expect(toReadQuery(SOL_OWNER, { chain: CHAIN.SOLANA_DEVNET })).toEqual({ type: 'lamportBalance', account: SOL_OWNER });
    const q = toReadQuery(SOL_OWNER, { chain: CHAIN.SOLANA_DEVNET, token: SOL_MINT });
    expect(q).toEqual({ type: 'splTokenAccount', account: deriveAssociatedTokenAddress(new PublicKey(SOL_OWNER), new PublicKey(SOL_MINT)).toBase58() });
  });
  it('web2: subject is the URL, options.web2 becomes the http query', () => {
    const web2 = { extract: [{ path: '$.id', valueType: 'uint256' as const }], headers: { accept: 'application/json' } };
    expect(toReadQuery('https://example.com/todos/1', { chain: READ_CHAIN_WEB2, web2 })).toEqual({ type: 'http', url: 'https://example.com/todos/1', ...web2 });
  });

  const bad: [string, string, ReadOptions][] = [
    ['two query keys', USER, { chain: CHAIN.ETHEREUM_SEPOLIA, token: TOKEN, storageSlot: 1n }],
    ['functionName without abi', USER, { chain: CHAIN.ETHEREUM_SEPOLIA, functionName: 'x' }],
    ['abi without functionName', USER, { chain: CHAIN.ETHEREUM_SEPOLIA, abi: ABI }],
    ['web2 key on a blockchain', USER, { chain: CHAIN.ETHEREUM_SEPOLIA, web2: { extract: [] } }],
    ['web2 chain without web2 key', 'https://x', { chain: READ_CHAIN_WEB2 }],
    ['web2 subject not https', 'http://x', { chain: READ_CHAIN_WEB2, web2: { extract: [] } }],
    ['EVM subject not an address', 'bob', { chain: CHAIN.ETHEREUM_SEPOLIA }],
    ['EVM token not an address', USER, { chain: CHAIN.ETHEREUM_SEPOLIA, token: 'usdc' }],
    ['SVM storageSlot', SOL_OWNER, { chain: CHAIN.SOLANA_DEVNET, storageSlot: 1n }],
    ['SVM abi call', SOL_OWNER, { chain: CHAIN.SOLANA_DEVNET, abi: ABI, functionName: 'totalSupply' }],
  ];
  it.each(bad)('rejects %s', (_n, subject, options) => {
    expect(() => toReadQuery(subject, options)).toThrow(InvalidReadQueryError);
  });
});

describe('toBuildReadSpecParams', () => {
  it('maps pinning / callback / refund options and the destination', () => {
    const p = toBuildReadSpecParams(USER, {
      chain: CHAIN.ETHEREUM_SEPOLIA, ...cb, refundTo: USER, blockNumber: 5n, minConfirmations: 3, expiryBlocks: 10n, maxFee: 7n,
    });
    expect(p).toEqual({
      callback: cb.callback,
      destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
      query: { type: 'accountBalance', target: USER },
      callbackGasLimit: 200_000n, refundTo: USER, blockNumber: 5n, minConfirmations: 3, expiryBlocks: 10n, maxFee: 7n,
    });
    expect(toBuildReadSpecParams('https://x/y', { chain: READ_CHAIN_WEB2, web2: { extract: [{ path: '$', valueType: 'string' }] }, ...cb }).destination)
      .toEqual({ chainNamespace: 'web2', chainId: 'https' });
  });
  it('callback.gasLimit is required while the registry is unbuilt', () => {
    expect(() => toBuildReadSpecParams(USER, { chain: CHAIN.ETHEREUM_SEPOLIA })).toThrow(/callback.gasLimit is required/);
  });
  it('lifecycle options map advanced.* to the tracker', () => {
    expect(toLifecycleOptions({ advanced: { pollingIntervalMs: 700, timeout: 9000 }, resultShape: { kind: 'raw' } }))
      .toEqual({ pollingIntervalMs: 700, timeoutMs: 9000, resultShape: { kind: 'raw' } });
    expect(toLifecycleOptions()).toEqual({ pollingIntervalMs: undefined, timeoutMs: undefined, resultShape: undefined });
  });
});
