/**
 * Check pSOL balance on UEA and transfer to EOA on Push Chain.
 * Used to fund the pSOL pool.
 */
import '@e2e/shared/setup';
import { PushChain } from '../../src';
import { PUSH_NETWORK, CHAIN } from '../../src/lib/constants/enums';
import { SYNTHETIC_PUSH_ERC20 } from '../../src/lib/constants/chain';
import { createPublicClient, http, Hex, formatUnits, encodeFunctionData } from 'viem';
import { createEvmPushClient } from '@e2e/shared/evm-client';

const PUSH_RPC = 'https://evm.donut.rpc.push.org/';
const pSOL_ADDRESS = SYNTHETIC_PUSH_ERC20[PUSH_NETWORK.TESTNET_DONUT].pSOL;

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

describe('Transfer pSOL from UEA to EOA', () => {
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

  it('should check pSOL balances on UEA and EOA', async () => {
    if (skipE2E) return;

    console.log(`\nUEA: ${ueaAddress}`);
    console.log(`EOA: ${eoaAddress}`);
    console.log(`pSOL: ${pSOL_ADDRESS}`);

    const ueaBalance = await pushPublicClient.readContract({
      address: pSOL_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ueaAddress],
    }) as bigint;

    const eoaBalance = await pushPublicClient.readContract({
      address: pSOL_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [eoaAddress],
    }) as bigint;

    console.log(`\nUEA pSOL balance: ${ueaBalance} raw (${formatUnits(ueaBalance, 9)} pSOL)`);
    console.log(`EOA pSOL balance: ${eoaBalance} raw (${formatUnits(eoaBalance, 9)} pSOL)`);
  }, 30000);

  it('should transfer pSOL from UEA to EOA', async () => {
    if (skipE2E) return;

    // Check UEA balance first
    const ueaBalance = await pushPublicClient.readContract({
      address: pSOL_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ueaAddress],
    }) as bigint;

    console.log(`\nUEA pSOL balance: ${ueaBalance} raw (${formatUnits(ueaBalance, 9)} pSOL)`);

    if (ueaBalance === BigInt(0)) {
      console.log('UEA has no pSOL — nothing to transfer');
      return;
    }

    // Transfer ALL pSOL from UEA to EOA
    const transferAmount = ueaBalance;
    console.log(`Transferring ${formatUnits(transferAmount, 9)} pSOL to EOA ${eoaAddress}`);

    const result = await pushClient.universal.sendTransaction({
      to: ueaAddress, // multicall on UEA
      data: [
        {
          to: pSOL_ADDRESS,
          value: BigInt(0),
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'transfer',
            args: [eoaAddress, transferAmount],
          }),
        },
      ],
    });

    console.log(`\nTx hash: ${result.hash}`);

    // Verify balances after
    const ueaAfter = await pushPublicClient.readContract({
      address: pSOL_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ueaAddress],
    }) as bigint;

    const eoaAfter = await pushPublicClient.readContract({
      address: pSOL_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [eoaAddress],
    }) as bigint;

    console.log(`\nAfter transfer:`);
    console.log(`UEA pSOL: ${formatUnits(ueaAfter, 9)} pSOL`);
    console.log(`EOA pSOL: ${formatUnits(eoaAfter, 9)} pSOL`);
  }, 60000);
});
