import 'dotenv/config';
import { createPublicClient, http, formatEther, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const pushDonut = defineChain({
  id: 42101,
  name: 'Push Donut Testnet',
  nativeCurrency: { name: 'Push', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: ['https://evm.donut.rpc.push.org/'] } },
});

async function main() {
  const pk = process.env['EVM_PRIVATE_KEY'] as `0x${string}`;
  if (!pk) throw new Error('EVM_PRIVATE_KEY not set');
  const eoa = privateKeyToAccount(pk).address;
  const pub = createPublicClient({ chain: pushDonut, transport: http() });
  const targets = [
    { label: 'EOA (sender)  ', addr: eoa },
    { label: 'UEA file 1+3  ', addr: '0x4A701114F991bf75685584c8156Db983c0DF95a0' as `0x${string}` },
    { label: 'UEA file 2+4  ', addr: '0xBa8F52487b31d3c212373da7C44bf855DeBf2283' as `0x${string}` },
  ];
  for (const t of targets) {
    const bal = await pub.getBalance({ address: t.addr });
    console.log(`${t.label} ${t.addr}  ${formatEther(bal)} PC`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
