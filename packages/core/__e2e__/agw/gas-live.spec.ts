/** Measure omitted destination gas on first/subsequent supported EVM routes.
 * Uses the existing counter fixtures and native PRC20s, not unavailable presets.
 */
import '@e2e/shared/setup';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseEventLogs,
  parseEther,
  type Hex,
  type Address,
} from 'viem';
import { CHAIN } from '../../src';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { EVM_CHAIN_FIXTURES } from '../shared/chain-fixtures';
import { observeAgwGas, recordAgwPushGas } from '../shared/agw-gas-evidence';
import { AGW_E2E_ENABLED, setupAgw, inSeconds } from './_fixture';
const d = AGW_E2E_ENABLED ? describe : describe.skip;
const AMOUNT = BigInt(10) ** BigInt(12);
const EXECUTED = parseAbi([
  'event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)',
]);
const ENDPOINTS: Partial<Record<CHAIN, string>> = {
  [CHAIN.ETHEREUM_SEPOLIA]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [CHAIN.BASE_SEPOLIA]: 'https://base-sepolia-rpc.publicnode.com',
  [CHAIN.ARBITRUM_SEPOLIA]: 'https://arbitrum-sepolia-rpc.publicnode.com',
  [CHAIN.BNB_TESTNET]: 'https://bsc-testnet-rpc.publicnode.com',
};
d('agw live gas sizing', () => {
  async function run(chain: CHAIN) {
    const counter = EVM_CHAIN_FIXTURES.find((x) => x.chain === chain)!.contracts
      .counter as Address;
    const rpc = createPublicClient({
      transport: http(ENDPOINTS[chain]!, { timeout: 15000 }),
    });
    if ((await rpc.getChainId()) !== Number(chain.split(':')[1]))
      throw new Error('Destination RPC chain mismatch');
    if (!(await rpc.getCode({ address: counter })))
      throw new Error('GAS_PREREQUISITE: counter fixture has no code');
    const f = await setupAgw();
    try {
      const token = getNativePRC20ForChain(chain, f.manifest.network);
      if (
        (await f.push.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [f.ownerAddress],
        })) <
        AMOUNT * BigInt(2)
      )
        throw new Error(
          `GAS_PREREQUISITE: owner lacks native PRC20 for ${chain}`
        );
      const made = await f.owner.agentic.create('route-gas-acceptance', {
        rules: [
          {
            agent: f.agentAddress,
            chainNamespace: chain as `eip155:${string}`,
            validUntil: inSeconds(3600),
            assets: [
              {
                token: '0x0000000000000000000000000000000000000000',
                maxPerCall: AMOUNT,
                maxTotal: AMOUNT * BigInt(2),
              },
            ],
            maxGasPerCall: parseEther('20'),
            allowedCalls: [{ target: counter, selector: 'increment()' }],
          },
        ],
      });
      const cea = (await getCEAAddress(made.wallet, chain, ENDPOINTS[chain]))
        .cea as Address;
      expect(await rpc.getCode({ address: cea })).toBeUndefined();
      await f.fundPC(made.wallet, parseEther('21'));
      await (
        await f.owner.universal.sendTransaction({
          to: token,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, AMOUNT * BigInt(2)],
          }),
        })
      ).wait();
      const agent = await f.agent(made.wallet);
      for (const stage of ['first-use', 'subsequent']) {
        const oldBalance = await rpc.getBalance({ address: cea });
        const stop = observeAgwGas(agent, f, `${chain}:${stage}`);
        try {
          const tx = await agent.universal.sendTransaction({
            to: { chain, address: counter },
            funds: { amount: AMOUNT },
            data: [{ to: counter, data: '0xd09de08a', value: BigInt(0) }],
          });
          f.evidence('evm-gas-submitted', {
            chain,
            stage,
            wallet: made.wallet,
            cea,
            hash: tx.hash,
          });
          const result = await tx.wait({ outboundTimeoutMs: 180000 });
          expect(result.externalStatus).toBe('success');
          const receipt = await rpc.getTransactionReceipt({
            hash: result.externalTxHash as Hex,
          });
          expect(receipt.status).toBe('success');
          expect(await rpc.getBalance({ address: cea })).toBe(
            oldBalance + AMOUNT
          );
          const events = parseEventLogs({ abi: EXECUTED, logs: receipt.logs });
          expect(
            events.some(
              (e) =>
                e.address.toLowerCase() === cea.toLowerCase() &&
                e.args.originCaller.toLowerCase() ===
                  made.wallet.toLowerCase() &&
                e.args.target.toLowerCase() === counter.toLowerCase() &&
                e.args.data === '0xd09de08a'
            )
          ).toBe(true);
          await recordAgwPushGas(f, tx.hash, `${chain}:${stage}`);
          f.evidence('evm-gas-delivered', {
            chain,
            stage,
            wallet: made.wallet,
            hash: tx.hash,
            destinationHash: result.externalTxHash,
            destinationBlock: receipt.blockNumber,
            destinationGasUsed: receipt.gasUsed,
            destinationGasPaidWei: receipt.gasUsed * receipt.effectiveGasPrice,
          });
        } finally {
          stop();
        }
      }
      const stored = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (stored.spent?.kind !== 'universal')
        throw new Error('Missing universal spend');
      expect(stored.spent.assets[0].spent).toBe(AMOUNT * BigInt(2));
    } finally {
      f.teardown();
    }
  }
  it(
    '1. Sepolia first-use and subsequent execution',
    () => run(CHAIN.ETHEREUM_SEPOLIA),
    600000
  );
  it(
    '2. Base Sepolia first-use and subsequent execution',
    () => run(CHAIN.BASE_SEPOLIA),
    600000
  );
  it(
    '3. Arbitrum Sepolia first-use and subsequent execution',
    () => run(CHAIN.ARBITRUM_SEPOLIA),
    600000
  );
  it(
    '4. BNB testnet first-use and subsequent execution',
    () => run(CHAIN.BNB_TESTNET),
    600000
  );
});
