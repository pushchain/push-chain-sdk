import { decodeFunctionData, parseAbi, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { REGISTRY_CALLBACK_GAS } from '../../constants/read-state';
import { UNIVERSAL_READ_REGISTRY_EVM } from '../../constants/abi/universalReadRegistry.evm';
import { getReadQueryKey, toBuildReadSpecParams } from '../read-params';
import { getReadRegistryAddress, getRegistryReadResult, getLatestRegistryReadResult } from '../registry';
import { buildReadSpecFromPreflight, toCallData } from '../spec-builder';
import { resolveDestination } from '../destination';
import { assertRequestEntrypoint, executeReads, type ReadExecutorDeps } from '../read-executor';
import type { ReadPreflight } from '../read-state.types';

const user = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const chain = CHAIN.ETHEREUM_SEPOLIA;
const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const pf: ReadPreflight = {
  destination: resolveDestination({ chain }), protocolFee: 10n, observedChainHeight: 100n,
  pushBlockNumber: 100n, pushGasPrice: 1_000_000_000n, universalCallback: user,
  universalCore: user, fetchedAt: 0,
};
function prepare(over: Partial<Parameters<typeof toBuildReadSpecParams>[1]> = {}) {
  const params = toBuildReadSpecParams(user, { chain, ...over });
  return buildReadSpecFromPreflight(pf, params, { refundTo: user });
}

describe('canonical registry integration', () => {
  it('rejects entrypoint fields without a custom target and rejects the removed nesting', () => {
    expect(() => prepare({ callback: { abi, functionName: 'request' } })).toThrow(/require callback.target/);
    expect(() => prepare({ callback: { request: { abi, functionName: 'request' } } as never })).toThrow(/was removed/);
  });
  it('encodes the deployed three-argument entrypoint with default gas, key and unchanged refund', () => {
    const p = prepare();
    const call = toCallData(p, assertRequestEntrypoint(p.callback));
    const decoded = decodeFunctionData({ abi: UNIVERSAL_READ_REGISTRY_EVM, data: call.data });
    expect(decoded.functionName).toBe('read');
    expect(decoded.args).toEqual([p.spec, p.queryKey, REGISTRY_CALLBACK_GAS]);
    expect(p.callback?.target).toBe(getReadRegistryAddress(PUSH_NETWORK.TESTNET_DONUT));
    expect(p.fees.total).toBe(10n + 500_000n * pf.pushGasPrice * 3n);
    expect(call.value).toBe(p.fees.total);
    expect(p.queryKey).toBe(getReadQueryKey(user, { chain }));
    expect(p.queryKey).toBe('0x962adcb6ecfd641636346646039316499a1990d5a6ab83b5169379d2d86c33e6');
  });

  it('keeps keys stable across pinning, payment and callback options', () => {
    const a = prepare({ blockNumber: 50n, expiryBlocks: 300n });
    const b = prepare({ blockNumber: 60n, minConfirmations: 2, expiryBlocks: 500n,
      refundTo: token, maxFee: 10n ** 18n, callback: { gasLimit: 1_000_000n } });
    expect(a.spec.query).not.toBe(b.spec.query);
    expect(a.queryKey).toBe(b.queryKey);
    expect(b.callbackGasLimit).toBe(1_000_000n);
    expect(b.spec.revertRecipient).toBe(token);
    expect(() => prepare({ callback: { gasLimit: 1_000_001n } })).toThrow();
  });

  it('separates query identity but treats ERC20 shorthand and explicit balanceOf equivalently', () => {
    const key = getReadQueryKey(user, { chain, token });
    expect(key).toBe(getReadQueryKey(token, { chain, abi, functionName: 'balanceOf', args: [user] }));
    expect(key).not.toBe(getReadQueryKey(user, { chain }));
    expect(key).not.toBe(getReadQueryKey(token, { chain, token }));
    expect(key).not.toBe(getReadQueryKey(user, { chain: CHAIN.BASE_SEPOLIA, token }));
    expect(getReadQueryKey(user, { chain, storageSlot: 0n })).not.toBe(getReadQueryKey(user, { chain, storageSlot: 1n }));
  });

  it('includes Solana account, mint and token program in identity', () => {
    const owner = '11111111111111111111111111111111';
    const mint = 'So11111111111111111111111111111111111111112';
    const chain = CHAIN.SOLANA_DEVNET;
    expect(getReadQueryKey(owner, { chain })).not.toBe(getReadQueryKey(mint, { chain }));
    expect(getReadQueryKey(owner, { chain, token: mint })).not.toBe(getReadQueryKey(owner, { chain, token: mint, tokenProgram: 'token-2022' }));
  });

  it('canonicalizes Web2 headers and excludes timeout while retaining extraction identity', () => {
    const extract = [{ path: '$.price', valueType: 'uint256' }] as const;
    const chain = CHAIN.WEB2;
    const a = getReadQueryKey('https://example.com', { chain, web2: { extract, headers: { a: '1', b: '2' } } });
    expect(a).toBe(getReadQueryKey('https://example.com', { chain, web2: { extract, headers: { b: '2', a: '1' }, timeoutMs: 9_000 } }));
    expect(a).not.toBe(getReadQueryKey('https://example.com', { chain, web2: { extract: [{ path: '$.other', valueType: 'uint256' }], headers: { a: '1', b: '2' } } }));
  });

  it('does not assume this deployment exists on other networks; custom receivers still work', () => {
    for (const network of [PUSH_NETWORK.MAINNET, PUSH_NETWORK.TESTNET, PUSH_NETWORK.LOCALNET]) {
      expect(() => toBuildReadSpecParams(user, { chain }, network)).toThrow(/not deployed on this network/);
      const callback = { target: token, gasLimit: 200_000n, abi, functionName: 'request' } as const;
      expect(toBuildReadSpecParams(user, { chain, callback }, network).callback).toEqual(callback);
    }
  });

  it('executes a prepared registry request through the existing batch tracker', async () => {
    const p = prepare();
    const hash = `0x${'aa'.repeat(32)}` as Hex;
    const record = { requestId: hash, txHash: hash, request: { spec: p.spec, callbackTarget: p.callback!.target,
      callbackGasLimit: p.callbackGasLimit, logIndex: 0 }, wait: jest.fn(), refresh: jest.fn() };
    const execute = jest.fn().mockResolvedValue({ hash, atomic: true, wait: async () => ({ status: 1 }) });
    const deps = { execute, revalidateRead: jest.fn(), trackRead: jest.fn(async (ref) => 'txHash' in ref ? [record] : record) } as unknown as ReadExecutorDeps;
    const batch = await executeReads(deps, [p], { waitForCompletion: false });
    expect(batch.reads[0].requestId).toBe(hash);
    expect(execute.mock.calls[0][0].to).toBe(p.callback!.target);
    expect(decodeFunctionData({ abi: UNIVERSAL_READ_REGISTRY_EVM, data: execute.mock.calls[0][0].data }).args).toEqual([p.spec, p.queryKey, 500_000n]);
  });

  it('exposes the supplied ABI lookup shapes without inventing consensus status', async () => {
    const stored = { requestId: 1n, resultData: '0x', updatedAtBlock: 5n };
    const client = { readContract: jest.fn().mockResolvedValue(stored) };
    expect(await getRegistryReadResult(client, PUSH_NETWORK.TESTNET_DONUT, 1n)).toBe(stored);
    expect(await getLatestRegistryReadResult(client, PUSH_NETWORK.TESTNET_DONUT, user, prepare().queryKey)).toBe(stored);
    expect(client.readContract.mock.calls[1][0].functionName).toBe('latestResult');
  });
});
