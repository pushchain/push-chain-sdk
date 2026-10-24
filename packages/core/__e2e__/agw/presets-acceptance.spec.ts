/** Release acceptance: EXACT shipped preset -> create -> readback -> two agent sends.
 * Every preset sends native ETH from Push; the agent wraps it on arrival and uses
 * the app. No asset, cap, call or pin is removed or substituted here.
 */
import '@e2e/shared/setup';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseEther,
  getAddress,
  zeroAddress,
  type ContractFunctionReturnType,
  type Address,
  type Hex,
} from 'viem';
import { PushChain, CHAIN, type Rule } from '../../src';
import { resolveAgenticPrc20 } from '../../src/lib/agentic/token-routes';
import { v6 } from '../../src/lib/agentic/contracts/v6';
import { actionId, configId } from '../../src/lib/agentic/codec/ids';
import {
  PRESET_ACCEPTANCE_CASES,
  expectStoredPreset,
} from '../shared/agw-preset-acceptance';
import { observeAgwGas, recordAgwPushGas } from '../shared/agw-gas-evidence';
import { AGW_E2E_ENABLED, setupAgw } from './_fixture';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const endpoints: Record<string, string> = {
  'eip155:11155111': 'https://ethereum-sepolia-rpc.publicnode.com',
  'eip155:84532': 'https://base-sepolia-rpc.publicnode.com',
  'eip155:421614': 'https://arbitrum-sepolia-rpc.publicnode.com',
};
const ABI = parseAbi([
  'function deposit() payable',
  'function factory() view returns(address)',
  'function getPool(address,address,uint24) view returns(address)',
  'function liquidity() view returns(uint128)',
  'function supply(address,uint256,address,uint16)',
  'function balanceOf(address) view returns(uint256)',
  'function getReserveData(address) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) returns(uint256)',
]);
// Uniswap V3 QuoterV2 on each testnet. Declared view so eth_call returns its quote.
const QUOTERS: Record<string, Address> = {
  'eip155:11155111': '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3',
  'eip155:84532': '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
  'eip155:421614': '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B',
};
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) view returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)',
]);
// Concrete operations for the shipped catalog: a WETH -> USDC swap or an Aave
// WETH supply. A new protocol needs its own receipt assertion, not a generic pass.
async function operation(rule: Rule, cea: Address) {
  const rpc = createPublicClient({
    transport: http(endpoints[rule.chainNamespace!], {
      timeout: 15000,
      // Public testnet RPCs drop requests; a dropped receipt read is not a failure.
      retryCount: 3,
    }),
  });
  const asset = rule.assets![0];
  if (
    (typeof asset.token === 'string' ? asset.token : asset.token.address) !==
    zeroAddress
  )
    throw new Error('Presets must send only native ETH');
  const amount = asset.maxPerCall / BigInt(1000);
  if (amount <= BigInt(0) || (asset.maxTotal ?? BigInt(0)) < amount * BigInt(2))
    throw new Error('Default caps cannot cover two bounded acceptance sends');
  const read = <
    F extends
      | 'factory'
      | 'getPool'
      | 'liquidity'
      | 'getReserveData'
      | 'balanceOf'
  >(
    address: Address,
    functionName: F,
    args: readonly unknown[] = []
  ) =>
    rpc.readContract({
      address,
      abi: ABI,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<ContractFunctionReturnType<typeof ABI, 'view', F>>;
  const wrap = rule.allowedCalls.find((c) => c.selector === 'deposit()');
  if (!wrap || wrap.maxValue !== asset.maxPerCall)
    throw new Error('Preset must wrap ETH up to its per-call cap');
  const weth = getAddress(wrap.target);
  const swap = rule.allowedCalls.find(
    (c) =>
      c.selector.toString().startsWith('exactInputSingle(') &&
      c.pins?.some(
        (p) =>
          'expected' in p && p.expected === weth && p.arg?.toString() === '0,0'
      )
  );
  let target: Address, data: Hex, resultBalance: () => Promise<bigint>;
  if (swap) {
    target = getAddress(swap.target);
    const usdc = getAddress(
      swap.pins!.find((p) => p.arg?.toString() === '0,1')!.expected as Address
    );
    // Testnet pools are thin and often mispriced, so the first tier with
    // liquidity can return nothing. Uniswap's quoter simulates each swap.
    let fee: number | undefined,
      best = BigInt(0);
    for (const tier of [100, 500, 3000, 10000]) {
      let quoted: bigint;
      try {
        [quoted] = await rpc.readContract({
          address: QUOTERS[rule.chainNamespace!],
          abi: QUOTER_ABI,
          functionName: 'quoteExactInputSingle',
          args: [
            {
              tokenIn: weth,
              tokenOut: usdc,
              amountIn: amount,
              fee: tier,
              sqrtPriceLimitX96: BigInt(0),
            },
          ],
        });
      } catch {
        continue; // no pool at this tier
      }
      if (quoted > best) {
        best = quoted;
        fee = tier;
      }
    }
    if (!fee)
      throw new Error('PRESET_PROTOCOL_UNAVAILABLE: no active WETH/USDC pool');
    data = encodeFunctionData({
      abi: ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: weth,
          tokenOut: usdc,
          fee,
          recipient: cea,
          amountIn: amount,
          amountOutMinimum: BigInt(1),
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });
    resultBalance = () => read(usdc, 'balanceOf', [cea]);
  } else {
    const supply = rule.allowedCalls.find(
      (c) => c.selector === 'supply(address,uint256,address,uint16)'
    );
    if (!supply)
      throw new Error(
        'PRESET_ACCEPTANCE_UNIMPLEMENTED: no verified operation for this catalog entry'
      );
    target = getAddress(supply.target);
    const reserve = await read(target, 'getReserveData', [weth]);
    if (/^0x0+$/.test(reserve.aTokenAddress))
      throw new Error(
        'PRESET_PROTOCOL_UNAVAILABLE: WETH is not an Aave reserve'
      );
    data = encodeFunctionData({
      abi: ABI,
      functionName: 'supply',
      args: [weth, amount, cea, 0],
    });
    resultBalance = () => read(reserve.aTokenAddress, 'balanceOf', [cea]);
  }
  return {
    rpc,
    amount,
    target,
    resultBalance,
    calls: [
      {
        to: weth,
        value: amount,
        data: encodeFunctionData({ abi: ABI, functionName: 'deposit' }),
      },
      {
        to: weth,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [target, amount],
        }),
      },
      { to: target, value: BigInt(0), data },
    ],
  };
}

d('agw unchanged preset acceptance', () => {
  // Explicit titles also allow CI's scenario selector to enumerate every case.
  const run = async (
    category: 'DEXES' | 'LENDING',
    chainNamespace: `eip155:${string}`
  ) => {
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      const generated = PushChain.utils.agentic.presets.get(category, {
        chainNamespace,
        agent: f.agentAddress,
      });
      const before = JSON.stringify(generated.rules, (_k, v) =>
        typeof v === 'bigint' ? String(v) : v
      );
      const predicted = await f.owner.agentic.derive();
      const cea = (
        await getCEAAddress(
          predicted.address,
          chainNamespace as CHAIN,
          endpoints[chainNamespace]
        )
      ).cea as Address;
      const op = await operation(generated.rules[0], cea);
      // Native ETH leaves Push as the chain's gas PRC20 (pETH, pETH_BASE, pETH_ARB).
      const mapped = resolveAgenticPrc20(
        { chain: chainNamespace, address: zeroAddress },
        f.manifest.network
      );
      if (
        (await f.push.readContract({
          address: mapped.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [f.ownerAddress],
        })) <
        op.amount * BigInt(2)
      )
        throw new Error(
          `PRESET_PREREQUISITE: owner lacks ${mapped.symbol} for two sends`
        );
      await f.fundAgent();
      const made = await f.owner.agentic.create('preset-acceptance', {
        rules: generated.rules,
      });
      expect(made.wallet).toBe(predicted.address);
      const config = await f.push.readContract({
        address: f.manifest.addresses.rulesPolicy,
        abi: v6.abis.policy,
        functionName: 'getConfig',
        args: [
          configId(
            made.wallet,
            made.rulesIds[0],
            actionId(f.manifest.addresses.gateway, '0x77b86bec')
          ),
          made.wallet,
        ],
      });
      expect(config.expectedCEA).toBe(cea);
      expectStoredPreset(
        generated.rules[0],
        await f.owner.agentic.wallet(made.wallet).rules.get(made.rulesIds[0])
      );
      expect(
        JSON.stringify(generated.rules, (_k, v) =>
          typeof v === 'bigint' ? String(v) : v
        )
      ).toBe(before);
      f.evidence('unchanged-preset-created', {
        category,
        chainNamespace,
        wallet: made.wallet,
        hash: made.tx.hash,
        rules: generated.rules,
      });
      await f.fundPC(made.wallet, parseEther('50'));
      await (
        await f.owner.universal.sendTransaction({
          to: mapped.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, op.amount * BigInt(2)],
          }),
        })
      ).wait();
      const agent = await f.agent(made.wallet);
      for (const stage of ['first-use', 'subsequent']) {
        const oldBalance = await op.resultBalance();
        const stop = observeAgwGas(
          agent,
          f,
          `${category}:${chainNamespace}:${stage}`
        );
        try {
          const tx = await agent.universal.sendTransaction({
            to: { address: op.target, chain: chainNamespace as CHAIN },
            data: op.calls,
            funds: { amount: op.amount },
          });
          f.evidence('unchanged-preset-submitted', {
            category,
            chainNamespace,
            stage,
            wallet: made.wallet,
            hash: tx.hash,
          });
          const receipt = await tx.wait({ outboundTimeoutMs: 180000 });
          expect(receipt.externalStatus).toBe('success');
          expect(receipt.externalTxHash).toBeTruthy();
          const dest = await op.rpc.getTransactionReceipt({
            hash: receipt.externalTxHash as Hex,
          });
          expect(dest.status).toBe('success');
          expect(await op.resultBalance()).toBeGreaterThan(oldBalance);
          await recordAgwPushGas(f, tx.hash, stage);
          f.evidence('unchanged-preset-delivered', {
            category,
            chainNamespace,
            stage,
            hash: tx.hash,
            destinationHash: receipt.externalTxHash,
            destinationGasUsed: dest.gasUsed,
            destinationGasPaidWei: dest.gasUsed * dest.effectiveGasPrice,
          });
          const stored = await f.owner.agentic
            .wallet(made.wallet)
            .rules.get(made.rulesIds[0]);
          if (stored.spent?.kind !== 'universal')
            throw new Error('Missing universal spend');
          expect(stored.spent.assets[0].spent).toBe(
            op.amount * BigInt(stage === 'first-use' ? 1 : 2)
          );
        } finally {
          stop();
        }
      }
    } finally {
      f.teardown();
    }
  };
  it('1. DEXES Sepolia', () => run(...PRESET_ACCEPTANCE_CASES[0]), 600000);
  it('2. DEXES Base Sepolia', () => run(...PRESET_ACCEPTANCE_CASES[1]), 600000);
  it(
    '3. DEXES Arbitrum Sepolia',
    () => run(...PRESET_ACCEPTANCE_CASES[2]),
    600000
  );
  it('4. LENDING Sepolia', () => run(...PRESET_ACCEPTANCE_CASES[3]), 600000);
  it(
    '5. LENDING Base Sepolia',
    () => run(...PRESET_ACCEPTANCE_CASES[4]),
    600000
  );
  it(
    '6. LENDING Arbitrum Sepolia',
    () => run(...PRESET_ACCEPTANCE_CASES[5]),
    600000
  );
});
