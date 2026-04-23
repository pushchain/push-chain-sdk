/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * R2 funds-only recipient forwarding.
 *
 * Regression coverage for the SDK payload bug where
 * `sendTransaction({ to: { chain, address }, funds: { amount, token } })` with
 * NO `data` and NO `value` produced an empty CEA multicall payload. The relayed
 * funds landed in the CEA on the destination chain and were never forwarded
 * to the caller's recipient.
 *
 * Two scenarios:
 *   1. Native funds (pETH -> ETH on Sepolia) — recipient receives native value.
 *   2. ERC-20 funds (pUSDT -> USDT on Sepolia) — recipient receives the token.
 *
 * Each test records the recipient's balance before, executes the outbound, and
 * asserts the delta matches the funds amount.
 */
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import type { MoveableToken } from '../../../src/lib/constants/tokens';
import {
  createPublicClient,
  http,
  Hex,
  parseEther,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getCEAAddress } from '../../../src/lib/orchestrator/cea-utils';
import {
  TransactionRoute,
  detectRoute,
} from '../../../src/lib/orchestrator/route-detector';
import type { UniversalExecuteParams } from '../../../src/lib/orchestrator/orchestrator.types';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import { ERC20_EVM } from '../../../src/lib/constants/abi/erc20.evm';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import { getToken } from '@e2e/shared/constants';
import { createEvmPushClient } from '@e2e/shared/evm-client';

const TARGET_CHAIN = CHAIN.ETHEREUM_SEPOLIA;

describe('R2 Funds-only → Recipient forwarding (Route 2)', () => {
  let pushClient: Awaited<ReturnType<typeof PushChain.initialize>>;
  let ueaAddress: `0x${string}`;
  let ceaAddress: `0x${string}`;
  let publicClient: ReturnType<typeof createPublicClient>;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) {
      console.log('Skipping E2E tests - EVM_PRIVATE_KEY not set');
      return;
    }

    const setup = await createEvmPushClient({
      chain: TARGET_CHAIN,
      privateKey,
      printTraces: true,
      progressHook: (val: ProgressEvent) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;
    ueaAddress = pushClient.universal.account;

    const ceaResult = await getCEAAddress(ueaAddress, TARGET_CHAIN);
    ceaAddress = ceaResult.cea;

    publicClient = createPublicClient({
      transport: http(CHAIN_INFO[TARGET_CHAIN].defaultRPC[0]),
    });

    console.log(`UEA: ${ueaAddress}`);
    console.log(`CEA on ${TARGET_CHAIN}: ${ceaAddress} (deployed=${ceaResult.isDeployed})`);
  }, 60_000);

  it('native funds: recipient receives ETH (not CEA)', async () => {
    if (skipE2E) return;

    // Fresh recipient — zero starting balance, so delta equals the sent amount.
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const amount = parseEther('0.00005'); // tiny — keeps the burn small

    const recipientBefore = await publicClient.getBalance({ address: recipient });
    const ceaBefore = await publicClient.getBalance({ address: ceaAddress });
    console.log(`Recipient ${recipient} balance before: ${recipientBefore}`);
    console.log(`CEA ${ceaAddress} balance before: ${ceaBefore}`);
    expect(recipientBefore).toBe(BigInt(0));

    const pethToken = getToken(TARGET_CHAIN, 'ETH') as MoveableToken;

    const params: UniversalExecuteParams = {
      to: {
        address: recipient,
        chain: TARGET_CHAIN,
      },
      funds: {
        amount,
        token: pethToken,
      },
      // No data. No value. This is the exact call shape that used to leave
      // funds stranded in the CEA.
    };

    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Outbound external TX: ${receipt.externalTxHash}`);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(TARGET_CHAIN);
    expect(receipt.externalTxHash).toBeDefined();
    await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

    const recipientAfter = await publicClient.getBalance({ address: recipient });
    const ceaAfter = await publicClient.getBalance({ address: ceaAddress });
    console.log(`Recipient balance after: ${recipientAfter}`);
    console.log(`CEA balance after: ${ceaAfter}`);

    // Recipient got the full amount.
    expect(recipientAfter).toBe(amount);
    // CEA balance did NOT grow by the forwarded amount. Allow a tiny tolerance
    // for unrelated background activity by asserting the growth is strictly
    // less than the forwarded amount.
    const ceaDelta = ceaAfter - ceaBefore;
    expect(ceaDelta).toBeLessThan(amount);
  }, 600_000);

  it('ERC-20 funds: recipient receives USDT (not CEA)', async () => {
    if (skipE2E) return;

    let usdtToken: MoveableToken | undefined;
    try {
      usdtToken = getToken(TARGET_CHAIN, 'USDT');
    } catch {
      console.log('Skipping - USDT not configured for this chain');
      return;
    }
    if (!usdtToken) return;

    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const amount = BigInt(10_000); // 0.01 USDT (6 decimals)

    // ---- Prefund UEA with pUSDT if short (R1 inbound bridge from master EOA) ----
    const pcPublicClient = createPublicClient({
      transport: http('https://evm.donut.rpc.push.org/'),
    });
    const pUsdtPrc20 = PushChain.utils.tokens.getPRC20Address(usdtToken).address as `0x${string}`;
    const readUeaPusdt = async (): Promise<bigint> =>
      (await pcPublicClient.readContract({
        address: pUsdtPrc20,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [ueaAddress],
      })) as bigint;

    const ueaPusdtBefore = await readUeaPusdt();
    const prefundTarget = amount * BigInt(5); // leave headroom for reruns
    console.log(`UEA pUSDT before prefund: ${ueaPusdtBefore}, target: ${prefundTarget}`);

    if (ueaPusdtBefore < amount) {
      const deficit = prefundTarget - ueaPusdtBefore;
      console.log(`Prefunding UEA with ${deficit} pUSDT via R1 inbound bridge...`);
      const prefundTx = await pushClient.universal.sendTransaction({
        to: ueaAddress, // PC address → Route 1 inbound (UOA_TO_PUSH)
        funds: {
          amount: deficit,
          token: usdtToken,
        },
      });
      console.log(`Prefund push tx: ${prefundTx.hash}`);
      const prefundReceipt = await prefundTx.wait();
      console.log(`Prefund receipt status: ${prefundReceipt.status}`);
      expect(prefundReceipt.status).toBe(1);

      // Poll UEA pUSDT balance until the inbound mint settles.
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const bal = await readUeaPusdt();
        if (bal >= amount) {
          console.log(`UEA pUSDT after prefund: ${bal}`);
          break;
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      const finalBal = await readUeaPusdt();
      if (finalBal < amount) {
        throw new Error(
          `Prefund did not land in time: UEA pUSDT=${finalBal}, need ${amount}`
        );
      }
    }

    const readUsdt = async (addr: `0x${string}`): Promise<bigint> =>
      (await publicClient.readContract({
        address: usdtToken!.address as `0x${string}`,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [addr],
      })) as bigint;

    const recipientBefore = await readUsdt(recipient);
    const ceaBefore = await readUsdt(ceaAddress);
    console.log(`Recipient ${recipient} USDT before: ${recipientBefore}`);
    console.log(`CEA ${ceaAddress} USDT before: ${ceaBefore}`);
    expect(recipientBefore).toBe(BigInt(0));

    const params: UniversalExecuteParams = {
      to: {
        address: recipient,
        chain: TARGET_CHAIN,
      },
      funds: {
        amount,
        token: usdtToken,
      },
      // No data. No value. SDK must auto-forward the minted tokens from CEA.
    };

    expect(detectRoute(params)).toBe(TransactionRoute.UOA_TO_CEA);

    const tx = await pushClient.universal.sendTransaction(params);
    console.log(`Push Chain TX: ${tx.hash}`);
    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    console.log(`Outbound external TX: ${receipt.externalTxHash}`);
    expect(receipt.status).toBe(1);
    expect(receipt.externalChain).toBe(TARGET_CHAIN);
    expect(receipt.externalTxHash).toBeDefined();
    await verifyExternalTransaction(receipt.externalTxHash!, receipt.externalChain!);

    const recipientAfter = await readUsdt(recipient);
    const ceaAfter = await readUsdt(ceaAddress);
    console.log(`Recipient USDT after: ${recipientAfter}`);
    console.log(`CEA USDT after: ${ceaAfter}`);

    expect(recipientAfter).toBe(amount);
    // CEA balance must not have grown by the forwarded amount (forwarding
    // consumes what was minted; some pre-existing balance may remain).
    expect(ceaAfter - ceaBefore).toBeLessThan(amount);
  }, 600_000);
});
