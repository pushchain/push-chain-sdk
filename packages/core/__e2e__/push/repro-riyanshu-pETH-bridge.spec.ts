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
 * Goal: prove the SDK validation passes for the canonical token, then
 * exercise the failure mode (token without sourceChain) to show the gap.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { Hex } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import {
  detectRoute,
  validateRouteParams,
  TransactionRoute,
} from '../../src/lib/orchestrator/route-detector';
import type {
  UniversalExecuteParams,
} from '../../src/lib/orchestrator/orchestrator.types';

const RECIPIENT = '0xFaE3594C68EDFc2A61b7527164BDAe80bC302108' as `0x${string}`;

describe('Repro: pETH bridge-back to Sepolia (Riyanshu payload)', () => {
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
  });
});
