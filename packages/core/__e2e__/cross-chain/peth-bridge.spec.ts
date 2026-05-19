/**
 * Repro for Riyanshu's report:
 *   "Unsupported moveable token for current client and route:
 *    token=PUSH_TESTNET.pETH
 *    clientChain=ETHEREUM_SEPOLIA
 *    destination=ETHEREUM_SEPOLIA"
 *
 * Mirrors the exact payload shape:
 *   to:    { address, chain: ETHEREUM_SEPOLIA }
 *   funds: { amount, token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pEth }
 *
 * Goal: prove the SDK validation/payload builder handles Push-side PRC-20
 * bridge-back tokens, including native destination assets such as pETH_BASE.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { createPublicClient, decodeAbiParameters, Hex, http } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { CHAIN_INFO, PUSH_CHAIN_INFO } from '../../src/lib/constants/chain';
import { UEA_MULTICALL_SELECTOR } from '../../src/lib/constants/selectors';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import type { OrchestratorContext } from '../../src/lib/orchestrator/internals/context';
import { buildPayloadForRoute } from '../../src/lib/orchestrator/internals/route-handlers';
import {
  detectRoute,
  validateRouteParams,
  TransactionRoute,
} from '../../src/lib/orchestrator/route-detector';
import type {
  UniversalExecuteParams,
  UniversalOutboundTxRequest,
} from '../../src/lib/orchestrator/orchestrator.types';

const RECIPIENT = '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108' as `0x${string}`;
const PUSH_EOA = '0xBa8F52487b31d3c212373da7C44bf855DeBf2283' as `0x${string}`;

function makePayloadCtx(): OrchestratorContext {
  return {
    rpcUrls: {
      [CHAIN.BASE_SEPOLIA]: CHAIN_INFO[CHAIN.BASE_SEPOLIA].defaultRPC,
      [CHAIN.ETHEREUM_SEPOLIA]: CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC,
    },
    printTraces: false,
    progressHook: () => undefined,
    pushClient: {
      pushChainInfo: PUSH_CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT],
    } as never,
    universalSigner: {
      account: {
        address: PUSH_EOA,
        chain: CHAIN.ETHEREUM_SEPOLIA,
      },
    } as never,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

function decodeCeaCalls(payload: `0x${string}`): Array<{
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
}> {
  expect(payload.startsWith(UEA_MULTICALL_SELECTOR)).toBe(true);
  const encoded = `0x${payload.slice(UEA_MULTICALL_SELECTOR.length)}` as `0x${string}`;
  const [calls] = decodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    encoded
  );
  return calls as unknown as Array<{
    to: `0x${string}`;
    value: bigint;
    data: `0x${string}`;
  }>;
}

describe('Route 2: PRC-20 bridge-back to external chains', () => {
  describe('Static validation (no signer needed)', () => {
    it('detects UOA_TO_CEA and passes validation with canonical pEth constant', () => {
      const params: UniversalExecuteParams = {
        to: { address: RECIPIENT, chain: CHAIN.ETHEREUM_SEPOLIA },
        funds: {
          amount: BigInt(1_000_000_000_000_000), // 0.001 pETH
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pEth,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      expect(() =>
        validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
      ).not.toThrow();
    });

    it('passes validation for tokens[0] from PushChain.utils.tokens.getMoveableTokens', () => {
      const tokens = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.PUSH_TESTNET_DONUT
      ).tokens;
      // The first entry is pETH (sourceChain = ETHEREUM_SEPOLIA).
      expect(tokens[0].symbol).toBe('pETH');
      expect(tokens[0].sourceChain).toBe(CHAIN.ETHEREUM_SEPOLIA);

      const params: UniversalExecuteParams = {
        to: { address: RECIPIENT, chain: CHAIN.ETHEREUM_SEPOLIA },
        funds: { amount: BigInt(1_000_000_000_000_000), token: tokens[0] as any },
      };
      expect(() =>
        validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
      ).not.toThrow();
    });

    it('still passes when caller hands in a token clone missing sourceChain (validator falls back to registry)', () => {
      const canonical = PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pEth;
      const stripped = {
        symbol: canonical.symbol,
        decimals: canonical.decimals,
        address: canonical.address,
        mechanism: canonical.mechanism,
      };

      const params: UniversalExecuteParams = {
        to: { address: RECIPIENT, chain: CHAIN.ETHEREUM_SEPOLIA },
        funds: { amount: BigInt(1_000_000_000_000_000), token: stripped as any },
      };

      expect(() =>
        validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
      ).not.toThrow();
    });

    it('builds native Base Sepolia forwarding for the UI pETH_BASE token object', async () => {
      const amount = BigInt(1_000_000_000_000_000);
      const token = PushChain.utils.tokens
        .getMoveableTokens(CHAIN.PUSH_TESTNET_DONUT)
        .tokens.find((candidate) => candidate.symbol === 'pETH_BASE');
      expect(token).toBeDefined();

      const params: UniversalExecuteParams = {
        to: { address: RECIPIENT, chain: CHAIN.BASE_SEPOLIA },
        funds: { amount, token: token as any },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);
      expect(() =>
        validateRouteParams(params, { clientChain: CHAIN.ETHEREUM_SEPOLIA })
      ).not.toThrow();

      const { payload, gatewayRequest } = await buildPayloadForRoute(
        makePayloadCtx(),
        params,
        TransactionRoute.UOA_TO_CEA,
        BigInt(0)
      );

      const outbound = gatewayRequest as UniversalOutboundTxRequest;
      expect(outbound.token).toBe(token!.prc20Address);
      expect(outbound.amount).toBe(amount);
      expect(outbound.payload).toBe(payload);

      const calls = decodeCeaCalls(payload);
      expect(calls).toHaveLength(1);
      expect(calls[0].to.toLowerCase()).toBe(RECIPIENT.toLowerCase());
      expect(calls[0].value).toBe(amount);
      expect(calls[0].data).toBe('0x');
      expect(calls[0].to.toLowerCase()).not.toBe(token!.address.toLowerCase());
    }, 60_000);

    it('maps Push PRC-20 USDT.base to the Base Sepolia token before forwarding', async () => {
      const amount = BigInt(10_000);
      const token = PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.USDT.base;
      const destinationToken = PushChain.CONSTANTS.MOVEABLE.TOKEN.BASE_SEPOLIA.USDT;
      const params: UniversalExecuteParams = {
        to: { address: RECIPIENT, chain: CHAIN.BASE_SEPOLIA },
        funds: { amount, token },
      };

      const { payload, gatewayRequest } = await buildPayloadForRoute(
        makePayloadCtx(),
        params,
        TransactionRoute.UOA_TO_CEA,
        BigInt(0)
      );

      const outbound = gatewayRequest as UniversalOutboundTxRequest;
      expect(outbound.token).toBe(token.prc20Address);
      expect(outbound.amount).toBe(amount);

      const calls = decodeCeaCalls(payload);
      expect(calls).toHaveLength(1);
      expect(calls[0].to.toLowerCase()).toBe(destinationToken.address.toLowerCase());
      expect(calls[0].value).toBe(BigInt(0));
      expect(calls[0].data.startsWith('0xa9059cbb')).toBe(true);
      expect(calls[0].to.toLowerCase()).not.toBe(token.address.toLowerCase());
    }, 60_000);
  });

  describe('Live send via universal.sendTransaction', () => {
    let pushClient: PushChain;
    const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
    const skipE2E = !privateKey;

    beforeAll(async () => {
      if (skipE2E) {
        console.log('Skipping live send — EVM_PRIVATE_KEY not set');
        return;
      }
      const setup = await createEvmPushClient({
        chain: CHAIN.ETHEREUM_SEPOLIA,
        privateKey: privateKey!,
        printTraces: true,
        progressHook: (v) => console.log(`[${v.id}] ${v.title}`),
      });
      pushClient = setup.pushClient;
      console.log(`UEA: ${pushClient.universal.account}`);
    }, 60000);

    it('sends pETH from UEA back to Sepolia using getMoveableTokens()[0] (Riyanshu code shape)', async () => {
      if (skipE2E) return;

      const tokens = PushChain.utils.tokens.getMoveableTokens(
        CHAIN.PUSH_TESTNET_DONUT
      ).tokens;
      expect(tokens[0].symbol).toBe('pETH');

      const txnRes = await pushClient.universal.sendTransaction({
        to: { address: RECIPIENT, chain: CHAIN.ETHEREUM_SEPOLIA },
        funds: {
          amount: PushChain.utils.helpers.parseUnits(
            '0.0001',
            tokens[0].decimals
          ),
          token: tokens[0] as any,
        },
      });

      console.log(`Push tx hash: ${txnRes.hash}`);
      expect(txnRes.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await txnRes.wait();
      console.log(`Receipt status: ${receipt.status}`);
      console.log(`External tx: ${receipt.externalTxHash} on ${receipt.externalChain}`);
      console.log(`Explorer: ${receipt.externalExplorerUrl}`);
      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    }, 360000);

    it('sends pETH_BASE from Push signer to Base Sepolia as native ETH (reported UI shape)', async () => {
      if (skipE2E) return;

      const setup = await createEvmPushClient({
        chain: CHAIN.PUSH_TESTNET_DONUT,
        privateKey: privateKey!,
        printTraces: true,
        progressHook: (v) => console.log(`[push:${v.id}] ${v.title}`),
      });
      const pushSignerClient = setup.pushClient;
      const amount = BigInt(1_000_000_000_000_000);
      const token = PushChain.utils.tokens
        .getMoveableTokens(CHAIN.PUSH_TESTNET_DONUT)
        .tokens.find((candidate) => candidate.symbol === 'pETH_BASE');
      expect(token).toBeDefined();
      const tokenAddress = token!.prc20Address as `0x${string}`;
      expect(tokenAddress).toBeDefined();

      const pushPublicClient = createPublicClient({
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      const balance = await pushPublicClient.readContract({
        address: tokenAddress,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [pushSignerClient.universal.account],
      }) as bigint;

      if (balance < amount) {
        console.log(
          `Skipping live pETH_BASE send — need ${amount}, have ${balance} on ${pushSignerClient.universal.account}`
        );
        return;
      }

      const txnRes = await pushSignerClient.universal.sendTransaction({
        to: { address: RECIPIENT, chain: CHAIN.BASE_SEPOLIA },
        funds: {
          amount,
          token: token as any,
        },
        progressHook: (v) => console.log(`[send:${v.id}] ${v.title}`),
      });

      console.log(`Push tx hash: ${txnRes.hash}`);
      expect(txnRes.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      const receipt = await txnRes.wait();
      console.log(`External tx: ${receipt.externalTxHash} on ${receipt.externalChain}`);
      console.log(`Explorer: ${receipt.externalExplorerUrl}`);

      expect(receipt.status).toBe(1);
      expect(receipt.externalChain).toBe(CHAIN.BASE_SEPOLIA);
      expect(receipt.externalStatus).toBe('success');
      expect(receipt.externalAssetAddr).toBe('0x0000000000000000000000000000000000000000');
      expect(receipt.externalAmount).toBe(amount.toString());
    }, 360000);
  });
});
