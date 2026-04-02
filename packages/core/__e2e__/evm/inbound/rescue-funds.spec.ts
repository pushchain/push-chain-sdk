/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Rescue Funds: Outbound CEA Inbound (Route 3)
 *
 * Sends funds via Route 3 (CEA → Push Chain) to a rescue address.
 * The CEA on the external chain bridges funds back to Push Chain
 * targeting the rescue address. Tests whether the revert triggers
 * and funds get stuck for rescue.
 *
 * Prerequisites:
 * - Hardcoded revert for rescue addresses on Push Chain
 * - CEA must be deployed on the external chain with sufficient USDT
 * - EVM_PRIVATE_KEY env var must be set
 */
import { PushChain } from '../../../src';
import { PUSH_NETWORK, CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO, SYNTHETIC_PUSH_ERC20 } from '../../../src/lib/constants/chain';
import { Hex, sha256, stringToBytes } from 'viem';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import { PushClient } from '../../../src/lib/push-client/push-client';
import { TransactionRoute, detectRoute } from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { type MoveableToken } from '../../../src/lib/constants/tokens';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { getActiveFixtures, type ChainTestFixture } from '@e2e/shared/chain-fixtures';
import { createEvmPushClient } from '@e2e/shared/evm-client';
import { ensureCeaErc20Balance } from '@e2e/shared/outbound-helpers';

// ---------------------------------------------------------------------------
// Rescue test recipient — hardcoded revert address on Push Chain
// ---------------------------------------------------------------------------

const RESCUE_TEST_RECIPIENT =
  '0xbb068190b8c1e8b565f7b293df6a21f1a468878f' as `0x${string}`;

// ---------------------------------------------------------------------------
// Chain → PRC-20 USDT address on Push Chain (needed for rescueFunds prc20 param)
// ---------------------------------------------------------------------------

const s = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];

const CHAIN_TO_PRC20_USDT: Partial<Record<CHAIN, `0x${string}`>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: s.USDT_ETH,
  [CHAIN.BNB_TESTNET]: s.USDT_BNB,
  [CHAIN.ARBITRUM_SEPOLIA]: s.USDT_ARB,
  [CHAIN.BASE_SEPOLIA]: s.USDT_BASE,
};

const fixtures = getActiveFixtures();

const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
const skipE2E = !privateKey;

describe('Rescue Funds: Outbound CEA Inbound (Route 3)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;

    ueaAddress = pushClient.universal.account;
    console.log(`UEA Address: ${ueaAddress}`);
  }, 60000);

  describe.each(fixtures)('[$label]', (fixture: ChainTestFixture) => {
    let fixtureCeaAddress: `0x${string}`;
    let fixtureUsdtToken: MoveableToken | undefined;
    let prc20Usdt: `0x${string}` | undefined;

    beforeAll(async () => {
      if (skipE2E) return;

      const ceaResult = await getCEAAddress(ueaAddress, fixture.chain);
      fixtureCeaAddress = ceaResult.cea;
      console.log(`CEA Address on ${fixture.label}: ${fixtureCeaAddress}, deployed: ${ceaResult.isDeployed}`);

      try {
        fixtureUsdtToken = getToken(fixture.chain, 'USDT');
      } catch {
        /* token not available */
      }

      prc20Usdt = CHAIN_TO_PRC20_USDT[fixture.chain];

      if (fixtureUsdtToken) {
        console.log(`USDT Token (${fixture.label}): ${fixtureUsdtToken.address} (${fixtureUsdtToken.decimals} decimals)`);
      }
      if (prc20Usdt) {
        console.log(`PRC-20 USDT on Push Chain: ${prc20Usdt}`);
      }

      // Ensure CEA has enough USDT on external chain
      if (fixtureUsdtToken) {
        await ensureCeaErc20Balance({
          pushClient,
          ceaAddress: fixtureCeaAddress,
          token: fixtureUsdtToken,
          requiredAmount: BigInt(10000),
          targetChain: fixture.chain,
        });
      }
    }, 600000);

    it('should bridge funds via outbound CEA inbound to rescue address', async () => {
      if (skipE2E) return;
      if (!fixtureUsdtToken) {
        console.log(`Skipping [${fixture.label}] - USDT token not found`);
        return;
      }
      if (!prc20Usdt) {
        console.log(`Skipping [${fixture.label}] - PRC-20 USDT mapping not found`);
        return;
      }

      console.log(`\n=== Rescue Funds Test (Route 3: Outbound CEA Inbound) [${fixture.label}] ===`);
      console.log(`Recipient: ${RESCUE_TEST_RECIPIENT}`);

      // ------------------------------------------------------------------
      // Step 1: Send funds via Route 3 (CEA → Push Chain) to rescue address
      // ------------------------------------------------------------------
      const bridgeAmount = BigInt(10000); // 0.01 USDT (6 decimals)

      // Use ueaAddress as recipient — same as cea-to-uea "1. Funds" test.
      // depositPRC20Token(prc20, amount, UEA) will revert because UEA
      // is in Nilesh's hardcoded revert list.
      const params: UniversalExecuteParams = {
        from: { chain: fixture.chain },
        to: ueaAddress,
        funds: {
          amount: bridgeAmount,
          token: fixtureUsdtToken,
        },
      };

      expect(detectRoute(params)).toBe(TransactionRoute.CEA_TO_PUSH);

      const tx = await pushClient.universal.sendTransaction(params);

      console.log(`Push Chain TX Hash: ${tx.hash}`);
      expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(tx.chain).toBe(fixture.chain);

      // ------------------------------------------------------------------
      // Step 2: Wait for relay
      // ------------------------------------------------------------------
      console.log('Waiting for relay...');

      let failed = false;
      let receipt: any;
      try {
        receipt = await tx.wait();
        console.log(`Receipt status: ${receipt.status}`);
        console.log(`External TX Hash: ${receipt.externalTxHash}`);
        console.log(`External Chain: ${receipt.externalChain}`);

        if (receipt.status !== 1) {
          failed = true;
          console.log('Transaction reverted as expected');
        } else {
          console.log('Transaction succeeded — checking external chain...');
          if (receipt.externalTxHash) {
            await verifyExternalTransaction(receipt.externalTxHash, receipt.externalChain!);
          }
        }
      } catch (err) {
        failed = true;
        console.log(`Relay failed/timed out: ${err}`);
      }

      console.log(`Failed: ${failed}`);

      // ------------------------------------------------------------------
      // Step 3: Wait for inbound to fail on Push Chain (depositPRC20Token reverts)
      // The outbound relay succeeded, but the inbound back to Push Chain
      // fails asynchronously. Wait extra time for validators to process.
      // ------------------------------------------------------------------
      console.log('Waiting 60s for Push Chain inbound to fail...');
      await new Promise((r) => setTimeout(r, 60000));

      // ------------------------------------------------------------------
      // Step 4: Get universalTxId from Push Chain
      // Use the outbound sub-tx ID extracted from cosmos events to query
      // Push Chain for the full universal tx, then get its ID.
      // ------------------------------------------------------------------
      const pushChainClient = new PushClient({
        rpcUrls: CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC,
        network: PUSH_NETWORK.TESTNET_DONUT,
      });

      // The rescue needs the INBOUND universal tx ID (Sepolia → Push Chain),
      // not the outbound (Push Chain → Sepolia). The inbound is created when
      // the CEA calls sendUniversalTxToUEA on Sepolia gateway.
      // Compute its query ID from the Sepolia external tx hash + log index.
      const externalTxHash = receipt?.externalTxHash;
      if (!externalTxHash) {
        throw new Error('No external tx hash — cannot compute inbound universalTxId');
      }

      // Get log index from the Sepolia tx receipt
      const { createPublicClient: createPC, http: httpTransport } = require('viem');
      const sepoliaClient = createPC({
        transport: httpTransport(CHAIN_INFO[fixture.chain].defaultRPC[0]),
      });
      const sepoliaReceipt = await sepoliaClient.getTransactionReceipt({
        hash: externalTxHash as `0x${string}`,
      });

      const gatewayAddress = (await import('../../../src/lib/constants/chain')).UNIVERSAL_GATEWAY_ADDRESSES[fixture.chain]!;
      const gatewayLogs = sepoliaReceipt.logs.filter(
        (log: any) => log.address.toLowerCase() === gatewayAddress.toLowerCase()
      );
      const lastLog = gatewayLogs[gatewayLogs.length - 1];
      const logIndex = lastLog?.logIndex ?? 0;

      const sourceChain = `eip155:${CHAIN_INFO[fixture.chain].chainId}`;
      const inboundIdInput = `${sourceChain}:${externalTxHash}:${logIndex}`;
      const inboundQueryId = sha256(stringToBytes(inboundIdInput)).slice(2);

      console.log(`External TX (Sepolia): ${externalTxHash}`);
      console.log(`Log index: ${logIndex}`);
      console.log(`Inbound ID input: ${inboundIdInput}`);
      console.log(`Inbound query ID (sha256): ${inboundQueryId}`);

      // Query Push Chain for the inbound universal tx
      let universalTxId: `0x${string}` | undefined;
      for (let attempt = 0; attempt < 10; attempt++) {
        console.log(`[Query] Attempt ${attempt + 1}/10...`);
        try {
          const resp = await pushChainClient.getUniversalTxByIdV2(inboundQueryId);
          if (resp?.universalTx?.id) {
            universalTxId = (resp.universalTx.id.startsWith('0x')
              ? resp.universalTx.id
              : `0x${resp.universalTx.id}`) as `0x${string}`;
            console.log(`Inbound Universal TX ID: ${universalTxId}`);
            console.log(`Status: ${resp.universalTx.universalStatus}`);
            break;
          }
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 3000));
      }

      if (!universalTxId) {
        throw new Error('Could not resolve inbound universalTxId from Push Chain');
      }

      // ------------------------------------------------------------------
      // Step 5: Call rescueFunds to recover stuck funds from Vault
      // ------------------------------------------------------------------
      console.log(`Calling rescueFunds with universalTxId=${universalTxId}, prc20=${prc20Usdt}...`);

      const rescueTx = await pushClient.universal.rescueFunds({
        universalTxId,
        prc20: prc20Usdt,
      });

      console.log(`Rescue TX Hash: ${rescueTx.hash}`);
      expect(rescueTx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

      // ------------------------------------------------------------------
      // Step 6: Wait for rescue outbound relay to Sepolia
      // TSS picks up the rescue event and calls Vault.rescueFunds() on Sepolia
      // ------------------------------------------------------------------
      console.log('Waiting for rescue outbound relay to Sepolia...');
      const rescueReceipt = await rescueTx.wait();
      console.log(`Rescue receipt status: ${rescueReceipt.status}`);
      console.log(`Rescue external TX: ${rescueReceipt.externalTxHash}`);
      console.log(`Rescue external chain: ${rescueReceipt.externalChain}`);
      console.log(`Rescue explorer: ${rescueReceipt.externalExplorerUrl}`);

      expect(rescueReceipt.status).toBe(1);
      expect(rescueReceipt.externalTxHash).toBeDefined();

      if (rescueReceipt.externalTxHash) {
        await verifyExternalTransaction(rescueReceipt.externalTxHash, rescueReceipt.externalChain!);
        console.log('Rescue funds verified on external chain!');
      }

      console.log('Rescue funds test complete — funds recovered from Vault');
    }, 600000);
  });
});
