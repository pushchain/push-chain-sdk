import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { WEB2_DESTINATION } from '../../constants/read-state';
import { ReadHeightUnavailableError, UnsupportedReadDestinationError } from '../errors';
import { preflightRead, type PreflightDeps } from '../preflight';

type Call = { address: string; functionName: string; args?: unknown[] };

/** A pushClient stub that records reads and answers from a table keyed by functionName. */
function makeDeps(answers: Record<string, unknown>, opts: { blockNumber?: bigint; gasPrice?: bigint } = {}) {
  const calls: Call[] = [];
  const deps: PreflightDeps = {
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    pushClient: {
      readContract: jest.fn(async (p: { address: string; functionName: string; args?: unknown[] }) => {
        calls.push({ address: p.address, functionName: p.functionName, args: p.args });
        if (!(p.functionName in answers)) throw new Error(`unexpected read ${p.functionName}`);
        return answers[p.functionName];
      }) as never,
      getGasPrice: jest.fn(async () => opts.gasPrice ?? 1_000_000_000n),
      publicClient: { getBlockNumber: jest.fn(async () => opts.blockNumber ?? 22_963_000n) } as never,
    },
  };
  return { deps, calls };
}

const HAPPY = { chainHeightByChainNamespace: 11_667_924n, estimateFee: 0n, blockedDomains: false };

describe('preflightRead', () => {
  it('keys the oracle height by the FULL CAIP-2 id and the fee/blocklist by the split pair', async () => {
    const { deps, calls } = makeDeps(HAPPY);
    const pf = await preflightRead(deps, { chain: CHAIN.ETHEREUM_SEPOLIA });

    const height = calls.find((c) => c.functionName === 'chainHeightByChainNamespace');
    expect(height?.args).toEqual(['eip155:11155111']); // joined — not "eip155"
    expect(height?.address.toLowerCase()).toBe('0x00000000000000000000000000000000000000c0');
    const fee = calls.find((c) => c.functionName === 'estimateFee');
    expect(fee?.args).toEqual(['eip155', '11155111']); // split
    expect(fee?.address.toLowerCase()).toBe('0x00000000000000000000000000000000000000c2');
    expect(calls.find((c) => c.functionName === 'blockedDomains')?.args).toEqual(['eip155', '11155111']);

    expect(pf.destination.caip2).toBe('eip155:11155111');
    expect(pf.observedChainHeight).toBe(11_667_924n);
    expect(pf.protocolFee).toBe(0n);
    expect(pf.pushBlockNumber).toBe(22_963_000n);
    expect(pf.pushGasPrice).toBe(1_000_000_000n);
    expect(pf.fetchedAt).toBeLessThanOrEqual(Date.now());
  });

  it('accepts the explicit { chainNamespace, chainId } form', async () => {
    const { deps, calls } = makeDeps({ ...HAPPY, chainHeightByChainNamespace: 495_626_670n });
    const pf = await preflightRead(deps, { chainNamespace: 'solana', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1' });
    expect(calls.find((c) => c.functionName === 'chainHeightByChainNamespace')?.args).toEqual([
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ]);
    expect(pf.destination.namespace).toBe('solana');
  });

  it('web2 is heightless: a 0 oracle height is NOT an error', async () => {
    const { deps } = makeDeps({ ...HAPPY, chainHeightByChainNamespace: 0n });
    const pf = await preflightRead(deps, WEB2_DESTINATION);
    expect(pf.observedChainHeight).toBe(0n);
    expect(pf.destination.caip2).toBe('web2:https');
  });

  it('a blockchain with a 0 oracle height is unreadable → ReadHeightUnavailableError', async () => {
    const { deps } = makeDeps({ ...HAPPY, chainHeightByChainNamespace: 0n });
    await expect(preflightRead(deps, { chain: CHAIN.ETHEREUM_MAINNET })).rejects.toBeInstanceOf(ReadHeightUnavailableError);
  });

  it('a blocklisted domain fails fast', async () => {
    const { deps } = makeDeps({ ...HAPPY, blockedDomains: true });
    await expect(preflightRead(deps, { chain: CHAIN.ETHEREUM_SEPOLIA })).rejects.toBeInstanceOf(UnsupportedReadDestinationError);
  });

  it('rejects a CAIP-2 string smuggled in as the namespace (would route as eip155:1:1 on the node)', async () => {
    const { deps } = makeDeps(HAPPY);
    await expect(preflightRead(deps, { chainNamespace: 'eip155:1', chainId: '1' })).rejects.toBeInstanceOf(
      UnsupportedReadDestinationError,
    );
  });

  it('rejects an unknown namespace before touching the chain', async () => {
    const { deps, calls } = makeDeps(HAPPY);
    await expect(preflightRead(deps, { chainNamespace: 'cosmos', chainId: 'foo' })).rejects.toBeInstanceOf(
      UnsupportedReadDestinationError,
    );
    expect(calls).toHaveLength(0);
  });
});
