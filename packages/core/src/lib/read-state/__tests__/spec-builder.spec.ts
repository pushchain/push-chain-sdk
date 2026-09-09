import { BaseError, decodeAbiParameters, decodeFunctionData, encodeFunctionData, erc20Abi, parseAbi, toFunctionSelector } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { CALLBACK_BUDGET_BUFFER, DEFAULT_EXPIRY_BLOCKS, WEB2_DESTINATION } from '../../constants/read-state';
import { resolveDestination } from '../destination';
import { InvalidReadQueryError, InvalidReadSpecError } from '../errors';
import type { ReadPreflight } from '../read-state.types';
import { buildReadSpecFromPreflight, prepareRead, simulateRead, toCallData, type PrepareReadDeps } from '../spec-builder';

const DEAD = '0x000000000000000000000000000000000000dEaD' as const;
const EOA = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf' as const;
const UEA = '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D' as const;
const SOL = '3nK8X1re4zLNrgz9Y3xKS4g2fKPJ6M3N9BhNuFfkjwAb';

function pf(over: Partial<ReadPreflight> = {}): ReadPreflight {
  return {
    destination: resolveDestination({ chain: CHAIN.ETHEREUM_SEPOLIA }),
    protocolFee: 0n,
    observedChainHeight: 11_667_924n,
    pushBlockNumber: 22_963_000n,
    pushGasPrice: 1_000_000_000n,
    universalCallback: '0x00000000000000000000000000000000000000c2',
    universalCore: '0x00000000000000000000000000000000000000C0',
    fetchedAt: Date.now(),
    ...over,
  };
}
const evmBal = { destination: { chain: CHAIN.ETHEREUM_SEPOLIA }, query: { type: 'accountBalance', target: DEAD } as const, callbackGasLimit: 200_000n };

describe('buildReadSpecFromPreflight — defaults', () => {
  it('pins blockNumber at observedChainHeight − minConfirmations and sets expiry from the Push head', () => {
    const p = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA });
    expect(p.spec.blockNumber).toBe(11_667_923n);
    expect(p.spec.minConfirmations).toBe(1);
    expect(p.spec.expiryPushChainHeight).toBe(22_963_000n + DEFAULT_EXPIRY_BLOCKS);
    expect(p.encodedQuery.blockRef).toBe(11_667_923n); // envelope mirrors the spec pin
  });

  it('backs off by a larger minConfirmations and clamps at 1', () => {
    expect(buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA, minConfirmations: 500 }).spec.blockNumber).toBe(11_667_424n);
    expect(buildReadSpecFromPreflight(pf({ observedChainHeight: 3n }), { ...evmBal, refundTo: EOA, minConfirmations: 10 }).spec.blockNumber).toBe(1n);
  });

  it('value = protocolFee + sized budget; maxFee = value by default, or value × (1 + bps)', () => {
    const p = buildReadSpecFromPreflight(pf({ protocolFee: 1_000n }), { ...evmBal, refundTo: EOA });
    expect(p.callbackBudget).toBe(200_000n * 1_000_000_000n * BigInt(CALLBACK_BUDGET_BUFFER));
    expect(p.value).toBe(1_000n + p.callbackBudget);
    expect(p.spec.maxFee).toBe(p.value);
    const q = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA, maxFeeBufferBps: 500 });
    expect(q.spec.maxFee).toBe(q.value + (q.value * 500n) / 10_000n);
  });

  it('honours explicit callbackBudget / maxFee / expiryPushChainHeight / blockNumber', () => {
    const p = buildReadSpecFromPreflight(pf(), {
      ...evmBal, refundTo: EOA, callbackBudget: 50_000_000_000_000_000n, maxFee: 100n * 10n ** 18n, expiryPushChainHeight: 22_964_308n, blockNumber: 11_667_000n,
    });
    expect(p.value).toBe(50_000_000_000_000_000n);
    expect(p.spec.maxFee).toBe(100n * 10n ** 18n);
    expect(p.spec.expiryPushChainHeight).toBe(22_964_308n);
    expect(p.spec.blockNumber).toBe(11_667_000n);
  });

  it('EVM owner defaults to refundTo (20 bytes) and can be overridden', () => {
    expect(buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA }).spec.account.owner).toBe(EOA.toLowerCase());
    expect(buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA, owner: '0xabcd' }).spec.account.owner).toBe('0xabcd');
  });

  it('SVM: owner is the raw 32-byte pubkey from the query; blockNumber doubles as minSlot; `owner` param rejected', () => {
    const solPf = pf({ destination: resolveDestination({ chain: CHAIN.SOLANA_DEVNET }), observedChainHeight: 495_626_670n });
    const params = { destination: { chain: CHAIN.SOLANA_DEVNET }, query: { type: 'lamportBalance', account: SOL } as const, callbackGasLimit: 200_000n, refundTo: EOA };
    const p = buildReadSpecFromPreflight(solPf, params);
    expect(p.spec.account.owner).toBe('0x2953026d328218b107268efe60f7d98635af1ff535a91731f75ca7cf8a859044');
    expect(p.spec.blockNumber).toBe(495_626_669n);
    expect(p.encodedQuery.blockRef).toBe(495_626_669n);
    expect(() => buildReadSpecFromPreflight(solPf, { ...params, owner: '0x01' })).toThrow(InvalidReadQueryError);
  });

  it('web2: blockNumber forced to 0; a non-zero pin is rejected', () => {
    const w2Pf = pf({ destination: resolveDestination(WEB2_DESTINATION), observedChainHeight: 0n });
    const params = { destination: WEB2_DESTINATION, query: { type: 'http', url: 'https://x.y/z', extract: [{ path: '$.a', valueType: 'bool' }] } as const, callbackGasLimit: 200_000n, refundTo: EOA };
    expect(buildReadSpecFromPreflight(w2Pf, params).spec.blockNumber).toBe(0n);
    expect(() => buildReadSpecFromPreflight(w2Pf, { ...params, blockNumber: 5n })).toThrow(InvalidReadQueryError);
  });

  it('throws ZERO_REVERT_RECIPIENT when neither refundTo nor a default is available', () => {
    expect(() => buildReadSpecFromPreflight(pf(), evmBal)).toThrow(InvalidReadSpecError);
    expect(buildReadSpecFromPreflight(pf(), evmBal, { refundTo: UEA }).spec.revertRecipient).toBe(UEA);
  });

  it('carries encoder warnings through', () => {
    const w2Pf = pf({ destination: resolveDestination(WEB2_DESTINATION), observedChainHeight: 0n });
    const p = buildReadSpecFromPreflight(w2Pf, {
      destination: WEB2_DESTINATION, callbackGasLimit: 1n, refundTo: EOA,
      query: { type: 'http', url: 'https://x.y/z', headers: { 'X-Api-Key': 'k' }, extract: [{ path: '$.a', valueType: 'bool' }] },
    });
    expect(p.warnings.join(' ')).toMatch(/X-Api-Key/);
  });

  it('encodedSpec round-trips and specTuple is positional', () => {
    const p = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA });
    const [decoded] = decodeAbiParameters(
      [{ type: 'tuple', components: [
        { name: 'account', type: 'tuple', components: [{ name: 'chainNamespace', type: 'string' }, { name: 'chainId', type: 'string' }, { name: 'owner', type: 'bytes' }] },
        { name: 'query', type: 'bytes' }, { name: 'minConfirmations', type: 'uint16' }, { name: 'blockNumber', type: 'uint64' },
        { name: 'expiryPushChainHeight', type: 'uint64' }, { name: 'maxFee', type: 'uint256' }, { name: 'revertRecipient', type: 'address' } ] }],
      p.encodedSpec,
    );
    expect(decoded.blockNumber).toBe(p.spec.blockNumber);
    expect(decoded.revertRecipient.toLowerCase()).toBe(EOA.toLowerCase());
    expect(p.specTuple[3]).toBe(p.spec.blockNumber);
    expect(p.specTuple[6]).toBe(EOA);
  });
});

describe('toCallData', () => {
  const appAbi = parseAbi([
    'function request(((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address) spec, uint64 gasLimit) payable returns (uint256)',
    'function borrow(uint256 amount, ((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address) spec, uint64 gasLimit) payable',
  ]);

  it('default arg order is (spec, callbackGasLimit) and value is the prepared msg.value', () => {
    const p = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA });
    const { data, value } = toCallData(p, { abi: appAbi, functionName: 'request' });
    expect(value).toBe(p.value);
    expect(data.slice(0, 10)).toBe(toFunctionSelector('request(((string,string,bytes),bytes,uint16,uint64,uint64,uint256,address),uint64)'));
    const { args } = decodeFunctionData({ abi: appAbi, data });
    expect(args?.[1]).toBe(200_000n);
  });

  it('args remaps into the app signature', () => {
    const p = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA });
    const { data } = toCallData(p, { abi: appAbi, functionName: 'borrow', args: (spec, gas) => [42n, spec, gas] });
    expect(data).toBe(encodeFunctionData({ abi: appAbi, functionName: 'borrow', args: [42n, p.specTuple as never, 200_000n] }));
  });
});

describe('prepareRead — refundTo default and the UEA-aware contract warning', () => {
  function deps(o: { code?: Record<string, string>; isUEA?: Record<string, boolean>; defaultRefundTo?: `0x${string}` } = {}): PrepareReadDeps {
    const reads: Record<string, unknown> = { chainHeightByChainNamespace: 11_667_924n, estimateFee: 0n, blockedDomains: false };
    return {
      pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
      defaultRefundTo: o.defaultRefundTo,
      pushClient: {
        readContract: jest.fn(async (p: { functionName: string; args?: unknown[] }) => {
          if (p.functionName === 'getOriginForUEA') return [{}, o.isUEA?.[String(p.args?.[0]).toLowerCase()] ?? false];
          return reads[p.functionName];
        }) as never,
        getGasPrice: jest.fn(async () => 1_000_000_000n),
        publicClient: {
          getBlockNumber: jest.fn(async () => 22_963_000n),
          getCode: jest.fn(async ({ address }: { address: string }) => o.code?.[address.toLowerCase()] ?? undefined),
        } as never,
      },
    };
  }

  it('defaults refundTo to the sending account', async () => {
    const p = await prepareRead(deps({ defaultRefundTo: EOA }), evmBal);
    expect(p.spec.revertRecipient).toBe(EOA);
    expect(p.warnings).toEqual([]);
  });

  it('a UEA refundTo (contract with code, isUEA=true) does NOT warn', async () => {
    const d = deps({ code: { [UEA.toLowerCase()]: '0x6080' }, isUEA: { [UEA.toLowerCase()]: true } });
    const p = await prepareRead(d, { ...evmBal, refundTo: UEA });
    expect(p.warnings).toEqual([]);
  });

  it('a non-UEA contract refundTo warns about a possibly forfeited refund', async () => {
    const d = deps({ code: { [DEAD.toLowerCase()]: '0x6080' } });
    const p = await prepareRead(d, { ...evmBal, refundTo: DEAD });
    expect(p.warnings.join(' ')).toMatch(/not a UEA/);
  });

  it('an EIP-7702-delegated EOA (code 0xef0100…) is treated as an EOA — no warning', async () => {
    const d = deps({ code: { [EOA.toLowerCase()]: '0xef0100' + '11'.repeat(20) } });
    const p = await prepareRead(d, { ...evmBal, refundTo: EOA });
    expect(p.warnings).toEqual([]);
    expect((d.pushClient.readContract as jest.Mock).mock.calls.some((c) => c[0]?.functionName === 'getOriginForUEA')).toBe(false);
  });

  it('throws when no refundTo can be resolved (read-only client without an account)', async () => {
    await expect(prepareRead(deps(), evmBal)).rejects.toBeInstanceOf(InvalidReadSpecError);
  });
});

describe('simulateRead', () => {
  const mk = (simulateContract: jest.Mock) =>
    ({ pushNetwork: PUSH_NETWORK.TESTNET_DONUT, pushClient: { readContract: jest.fn(), getGasPrice: jest.fn(), publicClient: { simulateContract } as never } }) as PrepareReadDeps;
  const prepared = buildReadSpecFromPreflight(pf(), { ...evmBal, refundTo: EOA });
  const opts = { appContract: DEAD, callbackSelector: '0x650c4b84' as const };

  it('ok when the call does not revert', async () => {
    expect(await simulateRead(mk(jest.fn(async () => ({}))), prepared, opts)).toEqual({ ok: true });
  });

  it('reports a generic revert with viem short message', async () => {
    const err = new BaseError('execution reverted');
    expect(await simulateRead(mk(jest.fn(async () => { throw err; })), prepared, opts)).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it('flags a stale preflight', async () => {
    const stale = { ...prepared, preflight: { ...prepared.preflight, fetchedAt: Date.now() - 120_000 }, warnings: [] };
    await simulateRead(mk(jest.fn(async () => ({}))), stale, opts);
    expect(stale.warnings.join(' ')).toMatch(/preflight is/);
  });

  it('is not tripped by an unrelated ERC-20 abi passed as the app abi', () => {
    // guard against accidental misuse: toCallData needs the APP abi, which must contain the function
    expect(() => toCallData(prepared, { abi: erc20Abi, functionName: 'request' })).toThrow();
  });
});
