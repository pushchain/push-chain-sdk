import 'dotenv/config';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseUnits,
  formatUnits,
  defineChain,
  encodeFunctionData,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const pushDonut = defineChain({
  id: 42101,
  name: 'Push Donut Testnet',
  nativeCurrency: { name: 'Push', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: ['https://evm.donut.rpc.push.org/'] } },
});

const erc20Abi = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

async function main() {
  const pk = process.env['EVM_PRIVATE_KEY'] as Hex;
  if (!pk) throw new Error('EVM_PRIVATE_KEY not set');

  const tokenArg = process.argv[2];
  const ueaArg = process.argv[3];
  const amountArg = process.argv[4];
  if (!tokenArg || !ueaArg || !amountArg) {
    throw new Error(
      'Usage: ts-node fund-uea-erc20.ts <TOKEN_ADDRESS> <UEA_ADDRESS> <AMOUNT_DECIMAL>'
    );
  }
  const token = tokenArg as `0x${string}`;
  const uea = ueaArg as `0x${string}`;

  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: pushDonut, transport: http() });
  const wallet = createWalletClient({ account, chain: pushDonut, transport: http() });

  const dec = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'decimals',
  })) as number;
  const amount = parseUnits(amountArg, dec);

  const eoaBalBefore = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint;
  const ueaBalBefore = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [uea],
  })) as bigint;

  console.log(`Token:      ${token} (decimals=${dec})`);
  console.log(`EOA:        ${account.address}`);
  console.log(`EOA bal:    ${formatUnits(eoaBalBefore, dec)} (${eoaBalBefore} units)`);
  console.log(`UEA:        ${uea}`);
  console.log(`UEA bal:    ${formatUnits(ueaBalBefore, dec)} (${ueaBalBefore} units)`);
  console.log(`Sending:    ${amountArg} (${amount} units)`);

  if (eoaBalBefore < amount) {
    throw new Error(
      `EOA balance too low: ${formatUnits(eoaBalBefore, dec)} < ${amountArg}`
    );
  }

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [uea, amount],
  });

  const hash = await wallet.sendTransaction({ to: token, data, value: BigInt(0) });
  console.log(`TX hash:    ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`Status:     ${r.status}`);

  const ueaBalAfter = (await pub.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [uea],
  })) as bigint;
  console.log(`UEA bal new: ${formatUnits(ueaBalAfter, dec)} (${ueaBalAfter} units)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
