/**
 * Transfer ALL ERC-20 tokens + native PC from UEA to EOA on Push Chain.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import {
  createPublicClient,
  http,
  Hex,
  formatUnits,
  encodeFunctionData,
  parseEther,
} from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const TOKENS = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT];

// All tokens on the UEA with their decimals
const TOKEN_LIST: { name: string; address: `0x${string}`; decimals: number }[] =
  [
    { name: 'pETH', address: TOKENS.pETH, decimals: 18 },
    { name: 'pETH.base', address: TOKENS.pETH_BASE, decimals: 18 },
    { name: 'pETH.arb', address: TOKENS.pETH_ARB, decimals: 18 },
    { name: 'pBNB', address: TOKENS.pETH_BNB, decimals: 18 },
    { name: 'pSOL', address: TOKENS.pSOL, decimals: 9 },
    { name: 'USDT.eth', address: TOKENS.USDT_ETH, decimals: 6 },
    { name: 'USDT.arb', address: TOKENS.USDT_ARB, decimals: 6 },
    { name: 'USDT.sol', address: TOKENS.USDT_SOL, decimals: 6 },
    { name: 'USDT.bsc', address: TOKENS.USDT_BNB, decimals: 6 },
    { name: 'USDT.base', address: TOKENS.USDT_BASE, decimals: 6 },
  ];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const;

const pushPublicClient = createPublicClient({
  transport: http(PUSH_RPC),
});

// Gas reserve to keep in UEA for the transfer tx itself
const GAS_RESERVE = parseEther('1');

describe('Transfer ALL tokens from UEA to EOA', () => {
  let pushClient: PushChain;
  let ueaAddress: `0x${string}`;
  let eoaAddress: `0x${string}`;

  const privateKey = process.env['EVM_PRIVATE_KEY'] as Hex;
  const skipE2E = !privateKey;

  beforeAll(async () => {
    if (skipE2E) return;

    const setup = await createEvmPushClient({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      privateKey,
      printTraces: true,
      progressHook: (val) => {
        console.log(`[${val.id}] ${val.title}`);
      },
    });
    pushClient = setup.pushClient;
    eoaAddress = setup.account.address;
    ueaAddress = pushClient.universal.account;
  }, 60000);

  it('should check all balances on UEA', async () => {
    if (skipE2E) return;

    console.log(`\nUEA: ${ueaAddress}`);
    console.log(`EOA: ${eoaAddress}`);

    // Native PC balance
    const pcBalance = await pushPublicClient.getBalance({
      address: ueaAddress,
    });
    console.log(
      `\nNative PC: ${formatUnits(pcBalance, 18)} PC (reserve ${formatUnits(GAS_RESERVE, 18)} PC for gas)`
    );

    // ERC-20 balances
    for (const token of TOKEN_LIST) {
      const balance = (await pushPublicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [ueaAddress],
      })) as bigint;
      console.log(
        `${token.name}: ${formatUnits(balance, token.decimals)} (${token.address})`
      );
    }
  }, 30000);

  it('should transfer ALL tokens from UEA to EOA', async () => {
    if (skipE2E) return;

    // 1. Read all ERC-20 balances
    const balances: { name: string; address: `0x${string}`; balance: bigint; decimals: number }[] = [];

    for (const token of TOKEN_LIST) {
      const balance = (await pushPublicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [ueaAddress],
      })) as bigint;
      balances.push({ ...token, balance });
    }

    // 2. Read native PC balance
    const pcBalance = await pushPublicClient.getBalance({
      address: ueaAddress,
    });
    const pcTransferAmount =
      pcBalance > GAS_RESERVE ? pcBalance - GAS_RESERVE : BigInt(0);

    // 3. Build multicall data array
    const data: { to: `0x${string}`; value: bigint; data: `0x${string}` }[] =
      [];

    // ERC-20 transfers
    for (const t of balances) {
      if (t.balance === BigInt(0)) {
        console.log(`${t.name}: 0 — skipping`);
        continue;
      }
      console.log(
        `${t.name}: transferring ${formatUnits(t.balance, t.decimals)}`
      );
      data.push({
        to: t.address,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [eoaAddress, t.balance],
        }),
      });
    }

    // Native PC transfer (send to EOA directly)
    if (pcTransferAmount > BigInt(0)) {
      console.log(
        `Native PC: transferring ${formatUnits(pcTransferAmount, 18)} PC`
      );
      data.push({
        to: eoaAddress,
        value: pcTransferAmount,
        data: '0x' as `0x${string}`,
      });
    } else {
      console.log('Native PC: insufficient balance after gas reserve — skipping');
    }

    if (data.length === 0) {
      console.log('\nNothing to transfer');
      return;
    }

    console.log(`\nSending multicall with ${data.length} operations...`);

    const result = await pushClient.universal.sendTransaction({
      to: ueaAddress,
      data,
    });

    console.log(`\nTx hash: ${result.hash}`);

    // 4. Verify balances after
    console.log('\n--- After transfer ---');
    const pcAfter = await pushPublicClient.getBalance({
      address: ueaAddress,
    });
    console.log(`UEA Native PC: ${formatUnits(pcAfter, 18)} PC`);

    for (const token of TOKEN_LIST) {
      const ueaBal = (await pushPublicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [ueaAddress],
      })) as bigint;
      const eoaBal = (await pushPublicClient.readContract({
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [eoaAddress],
      })) as bigint;
      console.log(
        `${token.name} — UEA: ${formatUnits(ueaBal, token.decimals)}, EOA: ${formatUnits(eoaBal, token.decimals)}`
      );
    }
  }, 120000);
});
