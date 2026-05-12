import 'dotenv/config';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  defineChain,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { formatPc } from '../../src/lib/formatters';

const pushDonut = defineChain({
  id: 42101,
  name: 'Push Donut Testnet',
  nativeCurrency: { name: 'Push', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: ['https://evm.donut.rpc.push.org/'] } },
});

async function main() {
  const pk = process.env['EVM_PRIVATE_KEY'] as Hex;
  if (!pk) throw new Error('EVM_PRIVATE_KEY not set');

  const ueaArg = process.argv[2];
  const amountArg = process.argv[3];
  if (!ueaArg || !amountArg) {
    throw new Error('Usage: ts-node fund-uea.ts <UEA_ADDRESS> <AMOUNT_PC>');
  }
  const uea = ueaArg as `0x${string}`;
  const amount = parseEther(amountArg);

  const account = privateKeyToAccount(pk);
  const pub = createPublicClient({ chain: pushDonut, transport: http() });
  const wallet = createWalletClient({ account, chain: pushDonut, transport: http() });

  const eoaBal = await pub.getBalance({ address: account.address });
  const ueaBalBefore = await pub.getBalance({ address: uea });
  console.log(`EOA:        ${account.address}`);
  console.log(`EOA bal:    ${formatPc(eoaBal)}`);
  console.log(`UEA:        ${uea}`);
  console.log(`UEA bal:    ${formatPc(ueaBalBefore)}`);
  console.log(`Sending:    ${amountArg} PC`);

  if (eoaBal < amount + parseEther('1')) {
    throw new Error(`EOA balance too low: ${formatPc(eoaBal)} < ${amountArg}+1 PC`);
  }

  const hash = await wallet.sendTransaction({ to: uea, value: amount });
  console.log(`TX hash:    ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  console.log(`Status:     ${r.status}`);

  const ueaBalAfter = await pub.getBalance({ address: uea });
  console.log(`UEA bal new: ${formatPc(ueaBalAfter)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
