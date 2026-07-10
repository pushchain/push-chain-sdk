import '@e2e/shared/setup';
import {
  createPublicClient,
  formatUnits,
  Hex,
  http,
  isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { ERC20_EVM } from '../../src/lib/constants/abi/erc20.evm';
import { createEvmPushClient } from '@e2e/shared/evm-client';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const PUSHPAY_CORE = '0x6a03976df2ae697b642c4310b22ee224cc70f384' as const;
const PUSD = '0x774c799646bB60103e38Fd65b18D81bbDD1Aa760' as const;
const ONE_PUSD = BigInt(1000000);
const PUSHPAY_OUTPUT_PUSD = 0;

const PUSHPAY_CORE_PAY_ABI = [
  {
    type: 'function',
    name: 'payDirect',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'sourceToken', type: 'address' },
      { name: 'sourceAmount', type: 'uint256' },
      { name: 'output', type: 'uint8' },
    ],
    outputs: [],
  },
] as const;

const describePushPayRepro =
  process.env['PUSHPAY_E2E'] === '1' ? describe : describe.skip;

describePushPayRepro('PushPay native PUSD multicall repro', () => {
  const privateKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;
  const recipientFromEnv = process.env['PUSHPAY_RECIPIENT'];

  const pushPublicClient = createPublicClient({
    transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
  });

  let pushClient: PushChain;
  let payer: `0x${string}`;
  let recipient: `0x${string}`;

  beforeAll(async () => {
    if (!privateKey) {
      console.log('Skipping PushPay repro — PUSH_PRIVATE_KEY not set');
      return;
    }

    payer = privateKeyToAccount(privateKey).address;

    if (recipientFromEnv && !isAddress(recipientFromEnv)) {
      throw new Error(
        `PUSHPAY_RECIPIENT must be an EVM address, got: ${recipientFromEnv}`
      );
    }
    recipient = (recipientFromEnv || payer) as `0x${string}`;
  }, 120_000);

  it('sends 1 PUSD through approve + PushPayCore.payDirect multicall', async () => {
    if (!privateKey) return;

    const readPusdBalance = (owner: `0x${string}`) =>
      pushPublicClient.readContract({
        address: PUSD,
        abi: ERC20_EVM,
        functionName: 'balanceOf',
        args: [owner],
      }) as Promise<bigint>;

    const readPusdAllowance = () =>
      pushPublicClient.readContract({
        address: PUSD,
        abi: ERC20_EVM,
        functionName: 'allowance',
        args: [payer, PUSHPAY_CORE],
      }) as Promise<bigint>;

    const payerBefore = await readPusdBalance(payer);
    const recipientBefore =
      recipient.toLowerCase() === payer.toLowerCase()
        ? payerBefore
        : await readPusdBalance(recipient);

    if (payerBefore < ONE_PUSD) {
      throw new Error(
        `PushPay repro needs at least 1 PUSD at ${payer}; current balance is ${formatUnits(payerBefore, 6)} PUSD`
      );
    }

    const setup = await createEvmPushClient({
      chain: CHAIN.PUSH_TESTNET_DONUT,
      privateKey,
      printTraces: true,
      progressHook: (val) => console.log(`[pushpay:${val.id}] ${val.title}`),
    });
    pushClient = setup.pushClient;

    console.log(
      `PushPay repro payer=${payer}, recipient=${recipient}, payerBefore=${formatUnits(payerBefore, 6)} PUSD`
    );

    const approveData = PushChain.utils.helpers.encodeTxData({
      abi: ERC20_EVM,
      functionName: 'approve',
      args: [PUSHPAY_CORE, ONE_PUSD],
    });

    const payDirectData = PushChain.utils.helpers.encodeTxData({
      abi: PUSHPAY_CORE_PAY_ABI,
      functionName: 'payDirect',
      args: [recipient, PUSD, ONE_PUSD, PUSHPAY_OUTPUT_PUSD],
    });

    const tx = await pushClient.universal.sendTransaction({
      to: ZERO_ADDRESS,
      value: BigInt(0),
      data: [
        { to: PUSD, value: BigInt(0), data: approveData },
        { to: PUSHPAY_CORE, value: BigInt(0), data: payDirectData },
      ],
    });

    expect(tx.hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);

    const allowanceAfter = await readPusdAllowance();
    const payerAfter = await readPusdBalance(payer);
    const recipientAfter =
      recipient.toLowerCase() === payer.toLowerCase()
        ? payerAfter
        : await readPusdBalance(recipient);

    expect(allowanceAfter).toBe(BigInt(0));
    if (recipient.toLowerCase() !== payer.toLowerCase()) {
      expect(payerAfter).toBeLessThanOrEqual(payerBefore - ONE_PUSD);
      expect(recipientAfter).toBeGreaterThan(recipientBefore);
      expect(recipientAfter).toBeLessThanOrEqual(recipientBefore + ONE_PUSD);
    }
  }, 300_000);
});
