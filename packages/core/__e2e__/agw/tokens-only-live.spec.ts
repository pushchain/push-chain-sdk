/** Live tokens-only rules and MOVEABLE ALL (Harsh/Zaryab decisions, 2026-10-23).
 * 1: a rule with Circle USDC and no app lets the agent transfer it back to the
 *    owner on Sepolia; another recipient is refused before broadcast.
 * 2: ALL expands on create and reads back every routable token with defaults.
 */
import '@e2e/shared/setup';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  parseEther,
  zeroAddress,
  type Hex,
} from 'viem';
import { CHAIN, PushChain } from '../../src';
import { PUSH_NETWORK } from '../../src/lib/constants/enums';
import { exactAgenticRoutes } from '../../src/lib/agentic/token-routes';
import { AGW_E2E_ENABLED, inSeconds, setupAgw } from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const AMOUNT = BigInt(10_000); // 0.01 USDC
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const OTHER = getAddress('0x000000000000000000000000000000000000dEaD');

d('agw tokens-only live', () => {
  it('1. Sepolia Circle USDC goes back to the owner only', async () => {
    const [route] = exactAgenticRoutes(
      CHAIN.ETHEREUM_SEPOLIA,
      PUSH_NETWORK.TESTNET_DONUT
    );
    const rpc = createPublicClient({
      transport: http(SEPOLIA_RPC, { timeout: 15000, retryCount: 1 }),
    });
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      if (
        (await f.push.readContract({
          address: route.prc20,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [f.ownerAddress],
        })) <
        AMOUNT * BigInt(2)
      )
        throw new Error(`TOKENS_ONLY_PREREQUISITE: owner lacks ${route.prc20}`);
      await f.fundAgent();
      const made = await f.owner.agentic.create('tokens-only', {
        rules: [
          {
            agent: f.agentAddress,
            chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
            validUntil: inSeconds(3600),
            assets: [
              {
                token: route.source,
                maxPerCall: AMOUNT,
                maxTotal: AMOUNT * BigInt(2),
              },
            ],
            maxGasPerCall: parseEther('20'),
          },
        ],
      });
      const record = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (!('allowedCalls' in record.rule))
        throw new Error('Expected an EVM rule');
      expect(record.rule.allowedCalls).toEqual([
        {
          target: getAddress(route.source),
          selector: '0xa9059cbb',
          maxValue: BigInt(0),
          pins: [
            {
              arg: 0,
              expected: `0x${f.ownerAddress
                .slice(2)
                .padStart(64, '0')}`.toLowerCase(),
            },
            { arg: 1, max: AMOUNT },
          ],
        },
      ]);
      f.evidence('tokens-only-created', {
        wallet: made.wallet,
        hash: made.tx.hash,
      });
      await f.fundPC(made.wallet, parseEther('25'));
      await (
        await f.owner.universal.sendTransaction({
          to: route.prc20,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, AMOUNT * BigInt(2)],
          }),
        })
      ).wait();
      const agent = await f.agent(made.wallet);
      const send = (to: `0x${string}`) =>
        agent.universal.sendTransaction({
          to: { chain: CHAIN.ETHEREUM_SEPOLIA, address: route.source },
          funds: {
            amount: AMOUNT,
            token: {
              symbol: route.symbol,
              decimals: route.decimals,
              address: route.source,
              mechanism: 'approve',
            },
          },
          data: [
            {
              to: route.source,
              value: BigInt(0),
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: 'transfer',
                args: [to, AMOUNT],
              }),
            },
          ],
        });
      // Refused by the policy simulation, so nothing is spent.
      await expect(send(OTHER)).rejects.toMatchObject({
        decodedError: { name: 'PolicyCheckReverted(ArgPinMismatch)' },
      });
      const delivered = () =>
        rpc.readContract({
          address: route.source,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [f.ownerAddress],
        });
      const before = await delivered();
      const tx = await send(f.ownerAddress);
      f.evidence('tokens-only-submitted', {
        wallet: made.wallet,
        hash: tx.hash,
      });
      const receipt = await tx.wait({ outboundTimeoutMs: 180000 });
      expect(receipt.externalStatus).toBe('success');
      const dest = await rpc.getTransactionReceipt({
        hash: receipt.externalTxHash as Hex,
      });
      expect(dest.status).toBe('success');
      expect(await delivered()).toBe(before + AMOUNT);
      const after = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (after.spent?.kind !== 'universal')
        throw new Error('Missing universal spend');
      expect(after.spent.assets[0].spent).toBe(AMOUNT);
      f.evidence('tokens-only-delivered', {
        hash: tx.hash,
        destinationHash: receipt.externalTxHash,
        destinationGasUsed: dest.gasUsed,
      });
    } finally {
      f.teardown();
    }
  }, 600000);

  it('2. ALL expands on create to every routable Sepolia token', async () => {
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      const expected = PushChain.utils.agentic.assets.all(
        CHAIN.ETHEREUM_SEPOLIA
      );
      const made = await f.owner.agentic.create('all-tokens', {
        rules: [
          {
            agent: f.agentAddress,
            chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
            validUntil: inSeconds(3600),
            assets: [
              {
                token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ALL,
              },
            ],
            maxGasPerCall: parseEther('20'),
            allowedCalls: [
              {
                target: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14',
                selector: 'deposit()',
                maxValue: BigInt(1),
              },
            ],
          },
        ],
      });
      const record = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (!('allowedCalls' in record.rule))
        throw new Error('Expected an EVM rule');
      expect(record.rule.assets).toEqual(
        expected.map((a) => ({
          token: getAddress(
            typeof a.token === 'string' ? a.token : a.token.address
          ),
          maxPerCall: a.maxPerCall,
          maxTotal: a.maxTotal,
        }))
      );
      expect(record.rule.assets).toHaveLength(6);
      expect(record.rule.assets![0].token).toBe(zeroAddress);
      f.evidence('all-tokens-created', {
        wallet: made.wallet,
        hash: made.tx.hash,
        assets: record.rule.assets,
      });
    } finally {
      f.teardown();
    }
  }, 600000);
});
