/** Live outbound settlement of the exact node-registered Circle USDC routes.
 * Owner door, funds only: the Push PRC20 is burned and the exact Circle USDC is
 * delivered to the owner's own address on each chain. Route evidence only; no
 * preset or agent permission is exercised here.
 */
import '@e2e/shared/setup';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseEther,
  type Hex,
} from 'viem';
import { CHAIN } from '../../src';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';
import { exactAgenticRoutes } from '../../src/lib/agentic/token-routes';
import { AGW_E2E_ENABLED, evmClient, setupAgw } from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const AMOUNT = BigInt(10_000); // 0.01 USDC
const ENDPOINTS: Partial<Record<CHAIN, string>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [CHAIN.BASE_SEPOLIA]: 'https://base-sepolia-rpc.publicnode.com',
  [CHAIN.ARBITRUM_SEPOLIA]: 'https://arbitrum-sepolia-rpc.publicnode.com',
};

d('agw exact route outbound', () => {
  async function run(chain: CHAIN) {
    const [route] = exactAgenticRoutes(chain, PUSH_NETWORK.TESTNET_DONUT);
    if (!route) throw new Error(`No exact route for ${chain}`);
    const rpc = createPublicClient({
      transport: http(ENDPOINTS[chain]!, { timeout: 15000, retryCount: 1 }),
    });
    if ((await rpc.getChainId()) !== Number(chain.split(':')[1]))
      throw new Error('Destination RPC chain mismatch');
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      const prc20Balance = (holder: `0x${string}`) =>
        f.push.readContract({
          address: route.prc20,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [holder],
        });
      if ((await prc20Balance(f.ownerAddress)) < AMOUNT)
        throw new Error(`ROUTE_PREREQUISITE: owner lacks ${route.prc20}`);
      const made = await f.owner.agentic.create('exact-route', { rules: [] });
      await f.fundPC(made.wallet, parseEther('21'));
      await (
        await f.owner.universal.sendTransaction({
          to: route.prc20,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, AMOUNT],
          }),
        })
      ).wait();
      const owner = await evmClient(
        process.env['PUSH_PRIVATE_KEY'] as Hex,
        CHAIN.PUSH_TESTNET_DONUT,
        f.manifest.network,
        made.wallet
      );
      const recipient = f.ownerAddress;
      const delivered = () =>
        rpc.readContract({
          address: route.source,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [recipient],
        });
      const before = await delivered();
      const tx = await owner.universal.sendTransaction({
        to: { chain, address: recipient },
        funds: {
          amount: AMOUNT,
          token: {
            symbol: route.symbol,
            decimals: route.decimals,
            address: route.source,
            mechanism: 'approve',
          },
        },
      });
      expect(tx.agentic?.door).toBe('owner');
      f.evidence('exact-route-submitted', {
        chain,
        wallet: made.wallet,
        prc20: route.prc20,
        source: route.source,
        hash: tx.hash,
      });
      const receipt = await tx.wait({ outboundTimeoutMs: 180000 });
      expect(receipt.externalStatus).toBe('success');
      const dest = await rpc.getTransactionReceipt({
        hash: receipt.externalTxHash as Hex,
      });
      expect(dest.status).toBe('success');
      expect(await delivered()).toBe(before + AMOUNT);
      expect(await prc20Balance(made.wallet)).toBe(BigInt(0));
      f.evidence('exact-route-delivered', {
        chain,
        hash: tx.hash,
        destinationHash: receipt.externalTxHash,
        destinationGasUsed: dest.gasUsed,
      });
    } finally {
      f.teardown();
    }
  }
  it('1. Sepolia Circle USDC', () => run(CHAIN.ETHEREUM_SEPOLIA), 600000);
  it('2. Base Sepolia Circle USDC', () => run(CHAIN.BASE_SEPOLIA), 600000);
  it(
    '3. Arbitrum Sepolia Circle USDC',
    () => run(CHAIN.ARBITRUM_SEPOLIA),
    600000
  );
});
