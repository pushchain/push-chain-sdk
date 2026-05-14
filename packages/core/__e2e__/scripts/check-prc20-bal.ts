import 'dotenv/config';
import { createPublicClient, http, defineChain, formatUnits } from 'viem';

const pushDonut = defineChain({
  id: 42101,
  name: 'Push Donut',
  nativeCurrency: { name: 'Push', symbol: 'PC', decimals: 18 },
  rpcUrls: { default: { http: ['https://evm.donut.rpc.push.org/'] } },
});

const balanceOfAbi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const decimalsAbi = [
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const;

const symbolAbi = [
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

const tokens: { sym: string; addr: `0x${string}` }[] = [
  { sym: 'pETH      ', addr: '0x2971824Db68229D087931155C2b8bB820B275809' },
  { sym: 'pUSDT.eth ', addr: '0x0f97A213207703923F5f0C613C9827f7C9A0f96B' },
  { sym: 'pUSDT.sol ', addr: '0x4f1A3D22d170a2F4Bddb37845a962322e24f4e34' },
  { sym: 'pUSDC.sol ', addr: '0x04B8F634ABC7C879763F623e0f0550a4b5c4426F' },
];

const wallets: { lbl: string; addr: `0x${string}` }[] = [
  { lbl: 'UEA  0x4A70', addr: '0x4A701114F991bf75685584c8156Db983c0DF95a0' },
  { lbl: 'EOA  0xBa8F', addr: '0xBa8F52487b31d3c212373da7C44bf855DeBf2283' },
];

async function main() {
  const pub = createPublicClient({ chain: pushDonut, transport: http() });
  for (const t of tokens) {
    const dec = (await pub.readContract({
      address: t.addr,
      abi: decimalsAbi,
      functionName: 'decimals',
    })) as number;
    let sym = '';
    try {
      sym = (await pub.readContract({
        address: t.addr,
        abi: symbolAbi,
        functionName: 'symbol',
      })) as string;
    } catch {
      sym = '?';
    }
    for (const w of wallets) {
      const bal = (await pub.readContract({
        address: t.addr,
        abi: balanceOfAbi,
        functionName: 'balanceOf',
        args: [w.addr],
      })) as bigint;
      console.log(
        `${t.sym} (${sym}, dec=${dec}) on ${w.lbl}: ${formatUnits(bal, dec)} (${bal} units)`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
