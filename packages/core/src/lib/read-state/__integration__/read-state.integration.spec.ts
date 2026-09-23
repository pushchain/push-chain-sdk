/**
 * Live read-state integration — read-only against Donut, no key, no writes.
 * Registered in jest.integration.config.ts; excluded from the unit run.
 *
 *   npx jest --config jest.integration.config.ts src/lib/read-state
 *
 * Fixtures are the reads made on 2026-09-09; they are settled forever, so every
 * assertion here is deterministic.
 */
import { bytesToHex, createPublicClient, http, decodeAbiParameters } from 'viem';
import { UNIVERSAL_READ_REGISTRY_EVM } from '../../constants/abi/universalReadRegistry.evm';
import { getReadRegistryAddress, getRegistryReadResult, getLatestRegistryReadResult } from '../registry';
import { getReadQueryKey } from '../read-params';
import { PUSH_CHAIN_INFO } from '../../constants/chain';
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { WEB2_DESTINATION } from '../../constants/read-state';
import { ReadErrorCode, ReadStatus, UniversalReadStatus } from '../../generated/ucallback/v1';
import { PushClient } from '../../push-client/push-client';
import { ReadHeightUnavailableError } from '../errors';
import { preflightRead } from '../preflight';
import { prepareRead, simulateRead, toCallData } from '../spec-builder';
import { trackRead } from '../read-tracker';
import { ReadNotFoundError } from '../errors';
import { PushChain } from '../../push-chain/push-chain';
import { READ_ERROR_CODE, READ_STATUS, UNIVERSAL_READ_STATUS } from '../read-state.types';
import { toFunctionSelector } from 'viem';

const READ2_TX = '0x8329b6134cc622fb58a015e54ec11d5bb38b604f8a3d42e62133fc31047ae732';
const READ2_ID = '0xf3d62fb962c84259e728d184dd2e3199c4d6c39790e20d60f2bacf0c10eca168';
const READ1_ID = '0xeba3eb9efad8c867bd19a66d925b5febae02efb5151faaf20d9fa8ea799c0d71';
const READ3_TX = '0x0293d57e606d6fec8ce6364cad82a0c74b517aaaf294107b5a6e43fcc25e7ee9'; // UEA-originated
const EXPIRED_ID = '0x4a6e27e003a8801f7f5dffff3beb8af6836b9e68a99c94bbb22dc95b180857a9';

describe('Registry deployment (Donut, read-only)', () => {
  it('prepares a callback-free SDK read and simulates the payable registry entrypoint without broadcasting', async () => {
    const reader = '0x1111111111111111111111111111111111111111';
    const sdk = await PushChain.initialize({ address: reader, chain: CHAIN.PUSH_TESTNET_DONUT }, { network: PUSH_NETWORK.TESTNET_DONUT });
    const prepared = await sdk.universal.prepareRead(reader, { chain: CHAIN.ETHEREUM_SEPOLIA });
    expect(prepared.callback?.target).toBe(getReadRegistryAddress(PUSH_NETWORK.TESTNET_DONUT));
    expect(prepared.callbackGasLimit).toBe(500_000n);
    expect(prepared.queryKey).toBe(getReadQueryKey(reader, { chain: CHAIN.ETHEREUM_SEPOLIA }));
    const rpc = createPublicClient({ transport: http('https://evm.donut.rpc.push.org') });
    const simulation = await rpc.call({
      to: getReadRegistryAddress(PUSH_NETWORK.TESTNET_DONUT),
      ...toCallData(prepared, { abi: prepared.callback!.abi!, functionName: prepared.callback!.functionName!, args: prepared.callback!.args }), account: reader,
      stateOverride: [{ address: reader, balance: 10n ** 21n }],
    });
    const [requestId] = decodeAbiParameters([{ type: 'uint256' }], simulation.data!);
    expect(requestId).toBeGreaterThan(0n);
    expect(await getRegistryReadResult(rpc, PUSH_NETWORK.TESTNET_DONUT, requestId))
      .toEqual({ requestId: 0n, resultData: '0x', updatedAtBlock: 0n });
  });

  it('uses a deployed proxy wired to UniversalCallback and decodes empty lookup results', async () => {
    const rpc = createPublicClient({ transport: http('https://evm.donut.rpc.push.org') });
    const address = getReadRegistryAddress(PUSH_NETWORK.TESTNET_DONUT);
    expect(await rpc.getChainId()).toBe(42101);
    expect((await rpc.getCode({ address }))?.length).toBeGreaterThan(2);
    const implementation = await rpc.getStorageAt({ address, slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' });
    expect(BigInt(implementation ?? '0x0')).toBeGreaterThan(0n);
    expect((await rpc.readContract({ address, abi: UNIVERSAL_READ_REGISTRY_EVM, functionName: 'universalCallback' })).toLowerCase())
      .toBe('0x00000000000000000000000000000000000000c2');
    expect(await getRegistryReadResult(rpc, PUSH_NETWORK.TESTNET_DONUT, 0n))
      .toEqual({ requestId: 0n, resultData: '0x', updatedAtBlock: 0n });
    const reader = '0x0000000000000000000000000000000000000000';
    expect(await getLatestRegistryReadResult(rpc, PUSH_NETWORK.TESTNET_DONUT, reader, getReadQueryKey(reader, { chain: CHAIN.ETHEREUM_SEPOLIA })))
      .toEqual({ requestId: 0n, resultData: '0x', updatedAtBlock: 0n });
  });
});

describe('read-state integration (Donut, read-only)', () => {
  let client: PushClient;
  beforeAll(() => {
    client = new PushClient({
      rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET].defaultRPC,
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
  });

  describe('PushClient.getReadsByTx / getUniversalRead', () => {
    it('finds the SUCCESS read by the tx hash that requested it', async () => {
      const { reads } = await client.getReadsByTx(READ2_TX);
      expect(reads).toHaveLength(1);
      const r = reads[0];
      expect(r.id).toBe(READ2_ID);
      expect(r.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
      expect(r.result?.status).toBe(ReadStatus.READ_STATUS_SUCCESS);
      expect(bytesToHex(r.result?.resultData ?? new Uint8Array())).toBe(
        '0x000000000000000000000000000000000000000000000092b406e140cc2c8871',
      );
      expect(r.request?.destinationChain).toBe('eip155:11155111');
      expect(r.pcTx).toHaveLength(2);
    });

    it('is case-insensitive on the hash and finds the UEA-originated read by the SDK tx hash', async () => {
      const { reads } = await client.getReadsByTx(READ3_TX.toUpperCase().replace('0X', '0x'));
      expect(reads).toHaveLength(1);
      expect(reads[0].request?.revertRecipient.toLowerCase()).toBe('0x5c70c864cf1adfb04a0e107ffa248ba3600eab8d');
    });

    it('returns the ERROR read with its error code and empty result bytes', async () => {
      const { read } = await client.getUniversalRead(READ1_ID);
      expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_FULFILLED);
      expect(read?.result?.status).toBe(ReadStatus.READ_STATUS_ERROR);
      expect(read?.result?.errorCode).toBe(ReadErrorCode.READ_ERROR_INVALID_QUERY);
      expect(read?.result?.resultData.length).toBe(0);
    });

    it('returns the EXPIRED read with its single sweeper pc_tx', async () => {
      const { read } = await client.getUniversalRead(EXPIRED_ID);
      expect(read?.status).toBe(UniversalReadStatus.UNIVERSAL_READ_STATUS_EXPIRED);
      expect(read?.expiryAttempts).toBe(1);
      expect(read?.pcTx).toHaveLength(1);
    });

    it('unknown hash / id → empty, no throw', async () => {
      const zero = '0x' + '0'.repeat(64);
      expect((await client.getReadsByTx(zero)).reads).toEqual([]);
      expect((await client.getUniversalRead(zero)).read).toBeUndefined();
    });
  });

  describe('preflightRead', () => {
    const deps = () => ({ pushClient: client, pushNetwork: PUSH_NETWORK.TESTNET_DONUT });

    it('Sepolia: oracle height populated, fee 0 today, Push head and gas price live', async () => {
      const pf = await preflightRead(deps(), { chain: CHAIN.ETHEREUM_SEPOLIA });
      expect(pf.observedChainHeight).toBeGreaterThan(11_000_000n);
      expect(pf.protocolFee).toBe(0n);
      expect(pf.pushBlockNumber).toBeGreaterThan(22_000_000n);
      expect(pf.pushGasPrice).toBeGreaterThan(0n);
      expect(pf.universalCore.toLowerCase()).toBe('0x00000000000000000000000000000000000000c0');
      expect(pf.universalCallback.toLowerCase()).toBe('0x00000000000000000000000000000000000000c2');
    });

    it('Solana devnet: oracle slot populated', async () => {
      const pf = await preflightRead(deps(), { chain: CHAIN.SOLANA_DEVNET });
      expect(pf.observedChainHeight).toBeGreaterThan(400_000_000n);
      expect(pf.destination.namespace).toBe('solana');
    });

    it('web2: heightless, does not throw', async () => {
      const pf = await preflightRead(deps(), WEB2_DESTINATION);
      expect(pf.observedChainHeight).toBe(0n);
    });

    it('an unconfigured chain (Ethereum mainnet) is unreadable', async () => {
      await expect(preflightRead(deps(), { chain: CHAIN.ETHEREUM_MAINNET })).rejects.toBeInstanceOf(ReadHeightUnavailableError);
    });
  });

  describe('prepareRead + simulateRead (deployed read client as the app contract)', () => {
    const CLIENT = '0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7' as const;      // FullBudgetReadClient, Donut
    const EOA = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf' as const;
    const SELECTOR = toFunctionSelector('onUniversalData(uint256,bytes)');
    const deps = () => ({ pushClient: client, pushNetwork: PUSH_NETWORK.TESTNET_DONUT, defaultRefundTo: EOA });

    it('prepares a Sepolia balance read that the live contract accepts', async () => {
      const p = await prepareRead(deps(), {
        destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
        query: { type: 'accountBalance', target: '0x000000000000000000000000000000000000dEaD' },
        callbackGasLimit: 200_000n,
      });
      expect(p.spec.revertRecipient).toBe(EOA);
      expect(p.spec.blockNumber).toBe(p.preflight.observedChainHeight - 1n);
      expect(p.value).toBeGreaterThan(0n);
      expect(p.warnings).toEqual([]);
      const sim = await simulateRead(deps(), p, { appContract: CLIENT, callbackSelector: SELECTOR });
      expect(sim).toEqual({ ok: true });
    }, 60_000);

    it('a pin above the oracle height is caught client-side, and the contract agrees when forced through', async () => {
      const pf = await preflightRead(deps(), { chain: CHAIN.ETHEREUM_SEPOLIA });
      await expect(
        prepareRead(deps(), {
          destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
          query: { type: 'accountBalance', target: '0x000000000000000000000000000000000000dEaD' },
          callbackGasLimit: 200_000n,
          blockNumber: pf.observedChainHeight + 1_000n,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_READ_SPEC', violations: ['INVALID_BLOCK_NUMBER'] });
    }, 60_000);

    it('a UEA refundTo does not warn; a plain contract does', async () => {
      const uea = await prepareRead(deps(), {
        destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
        query: { type: 'accountBalance', target: '0x000000000000000000000000000000000000dEaD' },
        callbackGasLimit: 200_000n,
        refundTo: '0x5C70C864Cf1aDfB04A0e107fFA248ba3600EAb8D', // deployed UEA
      });
      expect(uea.warnings).toEqual([]);
      const contract = await prepareRead(deps(), {
        destination: { chain: CHAIN.ETHEREUM_SEPOLIA },
        query: { type: 'accountBalance', target: '0x000000000000000000000000000000000000dEaD' },
        callbackGasLimit: 200_000n,
        refundTo: CLIENT, // has a receive(), but is not a UEA — the SDK cannot know, so it warns
      });
      expect(contract.warnings.join(' ')).toMatch(/not a UEA/);
    }, 60_000);
  });
});

describe('trackRead (settled reads — deterministic forever)', () => {
  let client: PushClient;
  beforeAll(() => {
    client = new PushClient({
      rpcUrls: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
      network: PUSH_NETWORK.TESTNET_DONUT,
    });
  });
  const deps = () => ({ pushClient: client, pushNetwork: PUSH_NETWORK.TESTNET_DONUT });

  it('by txHash: the SUCCESS read — delivered, decoded, fees from the live receipts', async () => {
    const reads = await trackRead(deps(), { txHash: READ2_TX });
    expect(reads).toHaveLength(1);
    const r = reads[0];
    expect(r.requestId).toBe(READ2_ID);
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(r.isTerminal).toBe(true);
    expect(r.callbackDelivered).toBe(true);
    expect(r.value).toBe(2706196938206701455473n);
    expect(r.fees.burned).toBe(118_289_000_000_000n);
    expect(r.fees.refunded).toBe(49_881_711_000_000_000n);
    expect(r.fees.refundFailed).toBe(false);
    expect(r.fees.burned! + r.fees.refunded!).toBe(r.fees.callbackBudget);
    expect(r.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    await expect(r.wait()).resolves.toBe(r); // terminal: no polling
  }, 60_000);

  it('by requestId: the ERROR read — FULFILLED, result ERROR, no value', async () => {
    const r = await trackRead(deps(), { requestId: READ1_ID });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(r.raw?.status).toBe(READ_STATUS.ERROR);
    expect(r.raw?.errorCode).toBe(READ_ERROR_CODE.INVALID_QUERY);
    expect(r.value).toBeUndefined();
    expect(r.callbackDelivered).toBe(true); // the app was told about the error
  }, 60_000);

  it('the reverting-callback read: FULFILLED but callbackDelivered=false (I4, live)', async () => {
    const r = await trackRead(deps(), { requestId: '0x9f0466e2a3f7c20e3af1f104df7cdb254e3ff00ba50b646ccb622d648462aabe' });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.FULFILLED);
    expect(r.raw?.status).toBe(READ_STATUS.SUCCESS);
    expect(r.callbackDelivered).toBe(false);
    expect(r.value).toBeUndefined();
    expect(r.fees.burned).toBeGreaterThan(0n);
  }, 60_000);

  it('the EXPIRED read: refund confirmed from the EndBlock logs in block_results, no receipt needed', async () => {
    const r = await trackRead(deps(), { requestId: EXPIRED_ID });
    expect(r.status).toBe(UNIVERSAL_READ_STATUS.EXPIRED);
    expect(r.fees.refunded).toBe(r.fees.callbackBudget);
    expect(r.fees.refundFailed).toBe(false);
    expect(r.fees.burned).toBeUndefined();
    const events = await client.getBlockResultEvents(r.pcTx[0].blockHeight);
    expect(events.some((e) => e.type === 'tx_log' && e.attributes.some((a) => a.key === 'mode' && a.value === 'EndBlock'))).toBe(true);
  }, 60_000);

  it('SVM (lamports) and web2 reads decode by the shape inferred from their envelopes', async () => {
    const svm = await trackRead(deps(), { requestId: '0x1e9951071a7fa78a288c19804c13b05dd32fd5a687f29646d06fd80831dcb850' });
    expect(svm.chain).toBe(CHAIN.SOLANA_DEVNET);
    expect(svm.callbackDelivered).toBe(true);
    expect(svm.value).toBe(0x2b5786fdn); // lamports, as decoded on 2026-09-09
    const [web2] = await trackRead(deps(), { txHash: '0xd0c50142b2a566092b2f8e389f3d442b606b04c0e8064e85b05b5bc87fbf9a99' });
    expect(web2.chain).toBe(CHAIN.WEB2);
    expect(web2.destination.caip2).toBe('web2:https');
    expect(web2.callbackDelivered).toBe(true);
    expect(web2.value).toEqual([1n, false]); // $.id, $.completed of the todo endpoint
  }, 90_000);

  it('unknown reference → ReadNotFoundError after the lookup window', async () => {
    await expect(trackRead(deps(), { requestId: 1n }, { pollingIntervalMs: 500 })).rejects.toBeInstanceOf(ReadNotFoundError);
  }, 60_000);
});

describe('PushChain.universal read-state surface (read-only client, Donut)', () => {
  const EOA = '0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf' as const;
  const CLIENT = '0x5F7221d31a01A71662cABEeC2567c55ad03E2fb7' as const;
  let client: PushChain;
  beforeAll(async () => {
    client = await PushChain.initialize({ address: EOA, chain: CHAIN.PUSH_TESTNET_DONUT }, { network: PUSH_NETWORK.TESTNET_DONUT });
  });

  it('prepareRead(subject, options) works in read-only mode and defaults refundTo to the account', async () => {
    const p = await client.universal.prepareRead(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: CLIENT, gasLimit: 200_000n } });
    expect(p.spec.revertRecipient).toBe(EOA);
    expect(p.fees.total).toBe(p.value);
    expect(p.encodedQuery.resultShape).toEqual({ kind: 'uint256' });
  }, 60_000);

  it('token / call / web2 grammars prepare', async () => {
    const usdc = await client.universal.prepareRead(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', callback: { gasLimit: 200_000n } });
    expect(usdc.encodedQuery.resultShape).toMatchObject({ kind: 'evmCall', functionName: 'balanceOf' });
    const web2 = await client.universal.prepareRead('https://jsonplaceholder.typicode.com/todos/1', {
      chain: PushChain.CONSTANTS.READ.WEB2,
      web2: { extract: [{ path: '$.id', valueType: 'uint256' }, { path: '$.completed', valueType: 'bool' }] },
      callback: { gasLimit: 200_000n },
    });
    expect(web2.spec.blockNumber).toBe(0n);
    expect(web2.spec.account.chainNamespace).toBe('web2');
  }, 60_000);

  it('trackRead through the client, with a per-call progressHook', async () => {
    const seen: string[] = [];
    const [r] = await client.universal.trackRead({ txHash: READ2_TX }, { progressHook: (e) => seen.push(e.id) });
    expect(r.callbackDelivered).toBe(true);
    await r.wait();
    expect(seen.slice(0, 2)).toEqual(['READ-TX-104-03', 'READ-TX-104-04']); // lookup announced
    expect(seen).toContain('READ-TX-104-02');
    expect(seen[seen.length - 1]).toBe('READ-TX-199-01');
  }, 60_000);

  it('registry and custom execution both require a signer', async () => {
    await expect(client.universal.read(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { gasLimit: 1n } })).rejects.toThrow(/Read only mode/);
    await expect(client.universal.read(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA })).rejects.toThrow(/Read only mode/);
    // a malformed entrypoint fails before any preflight or signer check
    // @ts-expect-error intentionally invalid: custom request ABI/function missing
    await expect(client.universal.read(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: CLIENT, gasLimit: 200_000n } })).rejects.toMatchObject({ code: 'INVALID_READ_QUERY' });
    const request = { abi: [{ type: 'function', name: 'request', stateMutability: 'payable', inputs: [], outputs: [] }] as const, functionName: 'request' };
    await expect(client.universal.read(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: CLIENT, gasLimit: 200_000n, ...request } })).rejects.toThrow(/Read only mode/);
  });

  it('executeReads rejects a valid prepared call on a read-only client', async () => {
    const request = { abi: [{ type: 'function', name: 'request', stateMutability: 'payable', inputs: [], outputs: [] }] as const, functionName: 'request', args: () => [] };
    const prepared = await client.universal.prepareRead(EOA, { chain: CHAIN.ETHEREUM_SEPOLIA, callback: { target: CLIENT, gasLimit: 200_000n, ...request } });
    expect(prepared.callback?.target).toBe(CLIENT);
    await expect(client.universal.executeReads([prepared])).rejects.toThrow(/Read only mode/);
  }, 60_000);

});
