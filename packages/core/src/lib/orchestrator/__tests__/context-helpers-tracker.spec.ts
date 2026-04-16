/**
 * Unit tests for context.ts, helpers.ts, and outbound-tracker.ts
 */
import { CHAIN, PUSH_NETWORK } from '../../constants/enums';
import { CHAIN_INFO, VM_NAMESPACE, SYNTHETIC_PUSH_ERC20 } from '../../constants/chain';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import type { OrchestratorContext } from '../internals/context';
import { printLog, fireProgressHook } from '../internals/context';
import {
  isPushChain,
  getPushChainForNetwork,
  getChainNamespace,
  chainFromNamespace,
  getNativePRC20ForChain,
  getUniversalGatewayPCAddress,
  validateMainnetConnection,
  bigintReplacer,
  toExecuteParams,
  SUPPORTED_GATEWAY_CHAINS,
} from '../internals/helpers';
import {
  computeUniversalTxId,
  extractUniversalSubTxIdFromTx,
  extractAllUniversalSubTxIds,
} from '../internals/outbound-tracker';
import type { UniversalExecuteParams, ChainTarget } from '../orchestrator.types';

jest.setTimeout(30000);

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

function makeMockCtx(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    pushClient: { getCosmosTx: jest.fn() } as any,
    universalSigner: {
      account: { chain: CHAIN.ETHEREUM_SEPOLIA, address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' },
    } as any,
    pushNetwork: PUSH_NETWORK.TESTNET,
    rpcUrls: {},
    printTraces: false,
    progressHook: undefined,
    accountStatusCache: null,
    ...overrides,
  } as unknown as OrchestratorContext;
}

// ============================================================================
// context.ts
// ============================================================================

describe('context', () => {
  // ---------- printLog ----------
  describe('printLog', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log when printTraces is true', () => {
      const ctx = makeMockCtx({ printTraces: true });
      printLog(ctx, 'hello world');
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('[Orchestrator] hello world');
    });

    it('should NOT log when printTraces is false', () => {
      const ctx = makeMockCtx({ printTraces: false });
      printLog(ctx, 'should not appear');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('should handle empty message', () => {
      const ctx = makeMockCtx({ printTraces: true });
      printLog(ctx, '');
      expect(consoleSpy).toHaveBeenCalledWith('[Orchestrator] ');
    });
  });

  // ---------- fireProgressHook ----------
  describe('fireProgressHook', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should call progressHook callback when provided', () => {
      const hookCb = jest.fn();
      const ctx = makeMockCtx({ progressHook: hookCb, printTraces: false });

      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);

      expect(hookCb).toHaveBeenCalledTimes(1);
      const payload = hookCb.mock.calls[0][0];
      expect(payload).toHaveProperty('id', PROGRESS_HOOK.SEND_TX_107);
      expect(payload).toHaveProperty('message');
      expect(payload).toHaveProperty('timestamp');
    });

    it('should NOT call progressHook when callback is undefined', () => {
      const ctx = makeMockCtx({ progressHook: undefined, printTraces: false });
      // Should not throw
      expect(() => fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107)).not.toThrow();
    });

    it('should also print the message via printLog when printTraces is true', () => {
      const ctx = makeMockCtx({ printTraces: true });
      fireProgressHook(ctx, PROGRESS_HOOK.SEND_TX_107);
      expect(consoleSpy).toHaveBeenCalled();
      const loggedMsg = consoleSpy.mock.calls[0][0] as string;
      expect(loggedMsg).toContain('[Orchestrator]');
    });

    it('should forward extra arguments to the hook factory', () => {
      const hookCb = jest.fn();
      const ctx = makeMockCtx({ progressHook: hookCb, printTraces: false });

      fireProgressHook(
        ctx,
        PROGRESS_HOOK.SEND_TX_101,
        'eip155:11155111',
        '0xABC'
      );

      const payload = hookCb.mock.calls[0][0];
      expect(payload.id).toBe(PROGRESS_HOOK.SEND_TX_101);
      expect(payload.message).toContain('0xABC');
    });
  });

  // ---------- OrchestratorContext interface shape ----------
  describe('OrchestratorContext interface', () => {
    it('should accept the minimal mock shape without errors', () => {
      const ctx = makeMockCtx();
      expect(ctx.pushNetwork).toBe(PUSH_NETWORK.TESTNET);
      expect(ctx.printTraces).toBe(false);
      expect(ctx.accountStatusCache).toBeNull();
      expect(ctx.progressHook).toBeUndefined();
    });

    it('should allow mutable caches to be set', () => {
      const ctx = makeMockCtx();
      ctx.ueaVersionCache = '1.0.2';
      expect(ctx.ueaVersionCache).toBe('1.0.2');

      ctx.accountStatusCache = {
        mode: 'signer',
        uea: {
          loaded: true,
          deployed: true,
          version: '1.0.0',
          minRequiredVersion: '1.0.2',
          requiresUpgrade: true,
        },
      };
      expect(ctx.accountStatusCache!.mode).toBe('signer');
    });
  });
});

// ============================================================================
// helpers.ts
// ============================================================================

describe('helpers', () => {
  // ---------- isPushChain ----------
  describe('isPushChain', () => {
    it('should return true for PUSH_MAINNET', () => {
      expect(isPushChain(CHAIN.PUSH_MAINNET)).toBe(true);
    });

    it('should return true for PUSH_TESTNET_DONUT', () => {
      expect(isPushChain(CHAIN.PUSH_TESTNET_DONUT)).toBe(true);
    });

    it('should return true for PUSH_LOCALNET', () => {
      expect(isPushChain(CHAIN.PUSH_LOCALNET)).toBe(true);
    });

    it('should return false for EVM external chains', () => {
      expect(isPushChain(CHAIN.ETHEREUM_SEPOLIA)).toBe(false);
      expect(isPushChain(CHAIN.ETHEREUM_MAINNET)).toBe(false);
      expect(isPushChain(CHAIN.ARBITRUM_SEPOLIA)).toBe(false);
      expect(isPushChain(CHAIN.BASE_SEPOLIA)).toBe(false);
      expect(isPushChain(CHAIN.BNB_TESTNET)).toBe(false);
    });

    it('should return false for SVM chains', () => {
      expect(isPushChain(CHAIN.SOLANA_DEVNET)).toBe(false);
      expect(isPushChain(CHAIN.SOLANA_TESTNET)).toBe(false);
      expect(isPushChain(CHAIN.SOLANA_MAINNET)).toBe(false);
    });
  });

  // ---------- getPushChainForNetwork ----------
  describe('getPushChainForNetwork', () => {
    it('should return PUSH_MAINNET for MAINNET', () => {
      expect(getPushChainForNetwork(PUSH_NETWORK.MAINNET)).toBe(CHAIN.PUSH_MAINNET);
    });

    it('should return PUSH_TESTNET_DONUT for TESTNET_DONUT', () => {
      expect(getPushChainForNetwork(PUSH_NETWORK.TESTNET_DONUT)).toBe(CHAIN.PUSH_TESTNET_DONUT);
    });

    it('should return PUSH_TESTNET_DONUT for TESTNET', () => {
      expect(getPushChainForNetwork(PUSH_NETWORK.TESTNET)).toBe(CHAIN.PUSH_TESTNET_DONUT);
    });

    it('should return PUSH_LOCALNET for LOCALNET', () => {
      expect(getPushChainForNetwork(PUSH_NETWORK.LOCALNET)).toBe(CHAIN.PUSH_LOCALNET);
    });
  });

  // ---------- getChainNamespace ----------
  describe('getChainNamespace', () => {
    it('should return correct CAIP-2 namespace for Ethereum Sepolia', () => {
      const ns = getChainNamespace(CHAIN.ETHEREUM_SEPOLIA);
      expect(ns).toBe('eip155:11155111');
    });

    it('should return correct CAIP-2 namespace for Solana Devnet', () => {
      const ns = getChainNamespace(CHAIN.SOLANA_DEVNET);
      expect(ns).toBe(`solana:${CHAIN_INFO[CHAIN.SOLANA_DEVNET].chainId}`);
    });

    it('should return correct namespace for Push Testnet Donut', () => {
      const ns = getChainNamespace(CHAIN.PUSH_TESTNET_DONUT);
      expect(ns).toBe('eip155:42101');
    });

    it('should return correct namespace for BNB Testnet', () => {
      const ns = getChainNamespace(CHAIN.BNB_TESTNET);
      expect(ns).toBe('eip155:97');
    });

    it('should match VM_NAMESPACE prefix for every chain', () => {
      for (const chain of Object.values(CHAIN)) {
        const info = CHAIN_INFO[chain as CHAIN];
        if (!info) continue;
        const ns = getChainNamespace(chain as CHAIN);
        const prefix = VM_NAMESPACE[info.vm];
        expect(ns.startsWith(prefix + ':')).toBe(true);
      }
    });
  });

  // ---------- chainFromNamespace ----------
  describe('chainFromNamespace', () => {
    it('should resolve Ethereum Sepolia from its CAIP-2 namespace', () => {
      expect(chainFromNamespace('eip155:11155111')).toBe(CHAIN.ETHEREUM_SEPOLIA);
    });

    it('should resolve Solana Devnet from its namespace', () => {
      const ns = `solana:${CHAIN_INFO[CHAIN.SOLANA_DEVNET].chainId}`;
      expect(chainFromNamespace(ns)).toBe(CHAIN.SOLANA_DEVNET);
    });

    it('should resolve Push Testnet Donut', () => {
      expect(chainFromNamespace('eip155:42101')).toBe(CHAIN.PUSH_TESTNET_DONUT);
    });

    it('should return null for unknown namespace', () => {
      expect(chainFromNamespace('unknown:999999')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(chainFromNamespace('')).toBeNull();
    });

    it('should be the inverse of getChainNamespace', () => {
      const chain = CHAIN.ARBITRUM_SEPOLIA;
      const ns = getChainNamespace(chain);
      expect(chainFromNamespace(ns)).toBe(chain);
    });
  });

  // ---------- getNativePRC20ForChain ----------
  describe('getNativePRC20ForChain', () => {
    const network = PUSH_NETWORK.TESTNET;
    const synthetics = SYNTHETIC_PUSH_ERC20[network];

    it('should return pETH for Ethereum Sepolia', () => {
      expect(getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, network)).toBe(synthetics.pETH);
    });

    it('should return pETH for Ethereum Mainnet', () => {
      expect(getNativePRC20ForChain(CHAIN.ETHEREUM_MAINNET, network)).toBe(synthetics.pETH);
    });

    it('should return pETH_ARB for Arbitrum Sepolia', () => {
      expect(getNativePRC20ForChain(CHAIN.ARBITRUM_SEPOLIA, network)).toBe(synthetics.pETH_ARB);
    });

    it('should return pETH_BASE for Base Sepolia', () => {
      expect(getNativePRC20ForChain(CHAIN.BASE_SEPOLIA, network)).toBe(synthetics.pETH_BASE);
    });

    it('should return pETH_BNB for BNB Testnet', () => {
      expect(getNativePRC20ForChain(CHAIN.BNB_TESTNET, network)).toBe(synthetics.pETH_BNB);
    });

    it('should return pSOL for Solana Devnet', () => {
      expect(getNativePRC20ForChain(CHAIN.SOLANA_DEVNET, network)).toBe(synthetics.pSOL);
    });

    it('should return pSOL for Solana Testnet', () => {
      expect(getNativePRC20ForChain(CHAIN.SOLANA_TESTNET, network)).toBe(synthetics.pSOL);
    });

    it('should return pSOL for Solana Mainnet', () => {
      expect(getNativePRC20ForChain(CHAIN.SOLANA_MAINNET, network)).toBe(synthetics.pSOL);
    });

    it('should throw for Push Chain chains', () => {
      expect(() => getNativePRC20ForChain(CHAIN.PUSH_TESTNET_DONUT, network)).toThrow(
        /No native PRC-20 token mapping/
      );
    });

    it('should throw for Push Localnet', () => {
      expect(() => getNativePRC20ForChain(CHAIN.PUSH_LOCALNET, network)).toThrow(
        /No native PRC-20 token mapping/
      );
    });
  });

  // ---------- getUniversalGatewayPCAddress ----------
  describe('getUniversalGatewayPCAddress', () => {
    it('should return the fixed precompile address', () => {
      const addr = getUniversalGatewayPCAddress();
      expect(addr).toBe('0x00000000000000000000000000000000000000C1');
    });

    it('should be 0x-prefixed', () => {
      expect(getUniversalGatewayPCAddress().startsWith('0x')).toBe(true);
    });
  });

  // ---------- validateMainnetConnection ----------
  describe('validateMainnetConnection', () => {
    it('should throw when Ethereum Mainnet is used with non-mainnet Push Chain', () => {
      // Push Testnet Donut chainId is "42101", not the mainnet chainId
      const testnetChainId = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId;
      expect(() =>
        validateMainnetConnection(CHAIN.ETHEREUM_MAINNET, testnetChainId)
      ).toThrow('Mainnet chains can only interact with Push Mainnet');
    });

    it('should throw when Solana Mainnet is used with non-mainnet Push Chain', () => {
      const testnetChainId = CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].chainId;
      expect(() =>
        validateMainnetConnection(CHAIN.SOLANA_MAINNET, testnetChainId)
      ).toThrow('Mainnet chains can only interact with Push Mainnet');
    });

    it('should NOT throw for Ethereum Mainnet with Push Mainnet chainId', () => {
      const mainnetChainId = CHAIN_INFO[CHAIN.PUSH_MAINNET].chainId;
      expect(() =>
        validateMainnetConnection(CHAIN.ETHEREUM_MAINNET, mainnetChainId)
      ).not.toThrow();
    });

    it('should NOT throw for non-mainnet chains regardless of Push chainId', () => {
      expect(() =>
        validateMainnetConnection(CHAIN.ETHEREUM_SEPOLIA, 'anything')
      ).not.toThrow();
      expect(() =>
        validateMainnetConnection(CHAIN.ARBITRUM_SEPOLIA, 'anything')
      ).not.toThrow();
      expect(() =>
        validateMainnetConnection(CHAIN.SOLANA_DEVNET, 'anything')
      ).not.toThrow();
    });
  });

  // ---------- bigintReplacer ----------
  describe('bigintReplacer', () => {
    it('should convert bigint to string', () => {
      expect(bigintReplacer('key', BigInt(123))).toBe('123');
    });

    it('should convert BigInt(0) to "0"', () => {
      expect(bigintReplacer('key', BigInt(0))).toBe('0');
    });

    it('should pass through strings unchanged', () => {
      expect(bigintReplacer('key', 'hello')).toBe('hello');
    });

    it('should pass through numbers unchanged', () => {
      expect(bigintReplacer('key', 42)).toBe(42);
    });

    it('should pass through null unchanged', () => {
      expect(bigintReplacer('key', null)).toBeNull();
    });

    it('should pass through objects unchanged', () => {
      const obj = { a: 1 };
      expect(bigintReplacer('key', obj)).toBe(obj);
    });

    it('should work as a JSON.stringify replacer', () => {
      const data = { amount: BigInt('1000000000000000000'), name: 'test' };
      const json = JSON.stringify(data, bigintReplacer);
      expect(JSON.parse(json)).toEqual({ amount: '1000000000000000000', name: 'test' });
    });
  });

  // ---------- toExecuteParams ----------
  describe('toExecuteParams', () => {
    it('should extract address from string `to`', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
      };
      const result = toExecuteParams(params);
      expect(result.to).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should extract address from ChainTarget `to`', () => {
      const target: ChainTarget = {
        address: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
        chain: CHAIN.ETHEREUM_SEPOLIA,
      };
      const params: UniversalExecuteParams = { to: target };
      const result = toExecuteParams(params);
      expect(result.to).toBe('0xABCDEF0123456789ABCDEF0123456789ABCDEF01');
    });

    it('should forward value, data, funds, gasLimit, and deadline', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        value: BigInt(100),
        data: '0xdeadbeef',
        gasLimit: BigInt(21000),
        deadline: BigInt(999),
        maxFeePerGas: BigInt(50),
        maxPriorityFeePerGas: BigInt(2),
      };
      const result = toExecuteParams(params);
      expect(result.value).toBe(BigInt(100));
      expect(result.data).toBe('0xdeadbeef');
      expect(result.gasLimit).toBe(BigInt(21000));
      expect(result.deadline).toBe(BigInt(999));
      expect(result.maxFeePerGas).toBe(BigInt(50));
      expect(result.maxPriorityFeePerGas).toBe(BigInt(2));
    });

    it('should forward feeLockTxHash when present', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        feeLockTxHash: '0xhash123',
      };
      const result = toExecuteParams(params);
      expect(result.feeLockTxHash).toBe('0xhash123');
    });

    it('should leave optional fields as undefined when not provided', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
      };
      const result = toExecuteParams(params);
      expect(result.value).toBeUndefined();
      expect(result.data).toBeUndefined();
      expect(result.funds).toBeUndefined();
      expect(result.gasLimit).toBeUndefined();
      expect(result.feeLockTxHash).toBeUndefined();
    });

    it('should forward funds parameter', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        funds: { amount: BigInt(500) },
      };
      const result = toExecuteParams(params);
      expect(result.funds).toEqual({ amount: BigInt(500) });
    });

    it('should NOT include `from` or `svmExecute` in the result', () => {
      const params: UniversalExecuteParams = {
        to: '0x1234567890123456789012345678901234567890',
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
      };
      const result = toExecuteParams(params);
      expect(result).not.toHaveProperty('from');
      expect(result).not.toHaveProperty('svmExecute');
    });
  });

  // ---------- SUPPORTED_GATEWAY_CHAINS ----------
  describe('SUPPORTED_GATEWAY_CHAINS', () => {
    it('should be an array', () => {
      expect(Array.isArray(SUPPORTED_GATEWAY_CHAINS)).toBe(true);
    });

    it('should contain known chains', () => {
      expect(SUPPORTED_GATEWAY_CHAINS).toContain(CHAIN.ETHEREUM_SEPOLIA);
      expect(SUPPORTED_GATEWAY_CHAINS).toContain(CHAIN.ARBITRUM_SEPOLIA);
      expect(SUPPORTED_GATEWAY_CHAINS).toContain(CHAIN.BASE_SEPOLIA);
      expect(SUPPORTED_GATEWAY_CHAINS).toContain(CHAIN.BNB_TESTNET);
      expect(SUPPORTED_GATEWAY_CHAINS).toContain(CHAIN.SOLANA_DEVNET);
    });

    it('should NOT contain Push Chain variants', () => {
      expect(SUPPORTED_GATEWAY_CHAINS).not.toContain(CHAIN.PUSH_MAINNET);
      expect(SUPPORTED_GATEWAY_CHAINS).not.toContain(CHAIN.PUSH_TESTNET_DONUT);
      expect(SUPPORTED_GATEWAY_CHAINS).not.toContain(CHAIN.PUSH_LOCALNET);
    });
  });
});

// ============================================================================
// outbound-tracker.ts
// ============================================================================

describe('outbound-tracker', () => {
  // ---------- computeUniversalTxId ----------
  describe('computeUniversalTxId', () => {
    it('should return a 0x-prefixed keccak256 hash', () => {
      const id = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xabc123');
      expect(id.startsWith('0x')).toBe(true);
      expect(id.length).toBe(66); // 0x + 64 hex chars
    });

    it('should produce deterministic output for same inputs', () => {
      const id1 = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xdeadbeef');
      const id2 = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xdeadbeef');
      expect(id1).toBe(id2);
    });

    it('should produce different output for different tx hashes', () => {
      const id1 = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xaaa');
      const id2 = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xbbb');
      expect(id1).not.toBe(id2);
    });

    it('should produce different output for different networks', () => {
      const id1 = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xsame');
      const id2 = computeUniversalTxId(PUSH_NETWORK.LOCALNET, '0xsame');
      expect(id1).not.toBe(id2);
    });

    it('should incorporate the push chain chainId in the hash input', () => {
      // For TESTNET, the push chain is PUSH_TESTNET_DONUT with chainId "42101"
      // The input format is `eip155:{chainId}:{txHash}`
      // We verify by checking that the same tx hash + different network = different result
      const idTestnet = computeUniversalTxId(PUSH_NETWORK.TESTNET, '0xtest');
      const idMainnet = computeUniversalTxId(PUSH_NETWORK.MAINNET, '0xtest');
      expect(idTestnet).not.toBe(idMainnet);
    });

    it('should handle empty tx hash', () => {
      const id = computeUniversalTxId(PUSH_NETWORK.TESTNET, '');
      expect(id.startsWith('0x')).toBe(true);
      expect(id.length).toBe(66);
    });
  });

  // ---------- extractAllUniversalSubTxIds ----------
  describe('extractAllUniversalSubTxIds', () => {
    it('should return sub-tx IDs from outbound_created events', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xabc123' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual(['0xabc123']);
    });

    it('should prefix values that lack 0x', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: 'deadbeef' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual(['0xdeadbeef']);
    });

    it('should collect multiple sub-tx IDs from multiple events', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xfirst' }],
          },
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xsecond' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual(['0xfirst', '0xsecond']);
    });

    it('should ignore events that are not outbound_created', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'transfer',
            attributes: [{ key: 'utx_id', value: '0xignored' }],
          },
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xkept' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual(['0xkept']);
    });

    it('should skip outbound_created events without utx_id attribute', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'other_key', value: '0xnope' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });

    it('should return empty array when Cosmos tx has no events', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: undefined,
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });

    it('should return empty array when Cosmos tx is null', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue(null);

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });

    it('should return empty array when getCosmosTx throws', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockRejectedValue(
        new Error('RPC error')
      );

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });

    it('should skip utx_id attributes with empty value', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '' }],
          },
        ],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });

    it('should return empty array when events array is empty', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [],
      });

      const ids = await extractAllUniversalSubTxIds(ctx, '0xtxhash');
      expect(ids).toEqual([]);
    });
  });

  // ---------- extractUniversalSubTxIdFromTx ----------
  describe('extractUniversalSubTxIdFromTx', () => {
    it('should return the first sub-tx ID', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xfirst' }],
          },
          {
            type: 'outbound_created',
            attributes: [{ key: 'utx_id', value: '0xsecond' }],
          },
        ],
      });

      const id = await extractUniversalSubTxIdFromTx(ctx, '0xtxhash');
      expect(id).toBe('0xfirst');
    });

    it('should return null when no sub-tx IDs are found', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockResolvedValue({
        events: [],
      });

      const id = await extractUniversalSubTxIdFromTx(ctx, '0xtxhash');
      expect(id).toBeNull();
    });

    it('should return null when getCosmosTx throws', async () => {
      const ctx = makeMockCtx();
      (ctx.pushClient.getCosmosTx as jest.Mock).mockRejectedValue(
        new Error('network error')
      );

      const id = await extractUniversalSubTxIdFromTx(ctx, '0xtxhash');
      expect(id).toBeNull();
    });
  });
});
