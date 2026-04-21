/**
 * Regression test for Push Chain viem error formatting.
 *
 * Bug: when a PublicClient used against Push Chain's RPC is built without a
 * viem `Chain` (i.e. no `nativeCurrency.symbol`), viem's estimateGas error
 * formatter falls back to "ETH" — so a user with 0 PC sees "value: 1 ETH"
 * instead of "value: 1 PC". Repro'd on lastone.fun (Harsh, 2026-04-21).
 *
 * Fix: `EvmClient` now accepts a `chain` option and threads it into
 * `createPublicClient`; `PushClient` always passes the Push viem chain.
 */

import { createPublicClient, custom, parseEther } from 'viem';
import { EvmClient } from './evm-client';
import { CHAIN } from '../constants/enums';
import { CHAIN_INFO, getPushViemChain } from '../constants/chain';

// Minimal mock request function that simulates the RPC error shape observed
// at evm.donut.rpc.push.org when the sender has insufficient PC for gas.
function makeInsufficientFundsTransport(chainIdHex: string) {
  return custom({
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return chainIdHex;
      if (method === 'eth_gasPrice') return '0x1';
      if (method === 'eth_estimateGas') {
        const err: Error & { code?: number } = new Error(
          'err: insufficient funds for gas * price + value'
        );
        err.code = -32000;
        throw err;
      }
      if (method === 'eth_getBlockByNumber') {
        return { baseFeePerGas: '0x1', number: '0x1', timestamp: '0x1' };
      }
      return null;
    },
  });
}

describe('EvmClient — native currency symbol in error messages', () => {
  it('getPushViemChain(PUSH_TESTNET_DONUT) exposes a chain whose native symbol is "PC"', () => {
    const chain = getPushViemChain(CHAIN.PUSH_TESTNET_DONUT);
    expect(chain).toBeDefined();
    expect(chain?.nativeCurrency.symbol).toBe('PC');
    expect(chain?.nativeCurrency.decimals).toBe(18);
    expect(chain?.id).toBe(
      parseInt(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId)
    );
  });

  it('EvmClient built with a Push chain threads it into its PublicClient', () => {
    const pushChain = getPushViemChain(CHAIN.PUSH_TESTNET_DONUT);
    const client = new EvmClient({
      rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
      chain: pushChain,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attached = (client as any).publicClient.chain;
    expect(attached).toBeDefined();
    expect(attached.nativeCurrency.symbol).toBe('PC');
  });

  it('formats insufficient-funds error with "PC" when chain is Push', async () => {
    const pushChain = getPushViemChain(CHAIN.PUSH_TESTNET_DONUT)!;
    const client = createPublicClient({
      chain: pushChain,
      transport: makeInsufficientFundsTransport(
        `0x${pushChain.id.toString(16)}`
      ),
    });

    let captured: Error | undefined;
    try {
      await client.estimateGas({
        account: '0x01cde43FADF492691187dE21700000000000000F',
        to: '0xd52436767855d9B765F46EAb0000000000000000',
        value: parseEther('1'),
        data: '0x1998aeef',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    const msg = String(captured?.message ?? '');
    // Symbol should be PC (fixed behavior)
    expect(msg).toMatch(/\bPC\b/);
    // And must not leak the default "ETH" anywhere in the formatted value line
    expect(msg).not.toMatch(/\d+(\.\d+)?\s+ETH\b/);
  });

  // Mechanism check: viem falls back to "ETH" when no chain is passed.
  // Left in as a regression guard — if this ever stops showing "ETH", viem's
  // default formatter changed and our explicit `chain:` wiring matters even
  // more. The production fix is verified by the two tests above.
  it('mechanism: without a chain, viem formats value as "ETH"', async () => {
    const pushChainId = parseInt(
      CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId
    );
    const client = createPublicClient({
      transport: makeInsufficientFundsTransport(
        `0x${pushChainId.toString(16)}`
      ),
    });

    let captured: Error | undefined;
    try {
      await client.estimateGas({
        account: '0x01cde43FADF492691187dE21700000000000000F',
        to: '0xd52436767855d9B765F46EAb0000000000000000',
        value: parseEther('1'),
        data: '0x1998aeef',
      });
    } catch (err) {
      captured = err as Error;
    }
    const msg = String(captured?.message ?? '');
    expect(msg).toMatch(/\d+(\.\d+)?\s+ETH\b/);
  });
});
