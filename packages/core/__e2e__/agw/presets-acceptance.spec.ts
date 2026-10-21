/** Release acceptance: EXACT shipped preset -> create -> readback -> two agent sends.
 * Missing routes, protocols or exact PRC20 balances fail before any funding. This is
 * deliberately separate from
 * the prefunded protocol fixtures; no asset, cap, call or pin is removed here.
 */
import '@e2e/shared/setup';
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  parseEther,
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
  'eip155:97': 'https://bsc-testnet-rpc.publicnode.com',
};
const ABI = parseAbi([
  'function factory() view returns(address)',
  'function getPool(address,address,uint24) view returns(address)',
  'function liquidity() view returns(uint128)',
  'function supply(address,uint256,address,uint16)',
  'function mint(uint256) returns(uint256)',
  'function balanceOf(address) view returns(uint256)',
  'function getReserveData(address) view returns ((uint256 configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt))',
  'function depositIntoStrategy(address,address,uint256) returns(uint256)',
  'function stakerDepositShares(address,address) view returns(uint256)',
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) returns(uint256)',
]);
// Concrete calls supported by the current catalog. A newly introduced protocol
// requires its own operation/receipt assertion rather than a false generic pass.
// `input` selects which preset asset funds the operation; swaps can trade either way.
async function operation(rule: Rule, cea: Address, input = 0) {
  const rpc = createPublicClient({
    transport: http(endpoints[rule.chainNamespace!], {
      timeout: 15000,
      retryCount: 1,
    }),
  });
  const asset = rule.assets![input],
    token = (
      typeof asset.token === 'string' ? asset.token : asset.token.address
    ) as Address;
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
      | 'stakerDepositShares'
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
  const swap = rule.allowedCalls.find((c) =>
    c.selector.toString().startsWith('exactInputSingle(')
  );
  let target: Address,
    data: Hex,
    outputToken: Address | undefined,
    shares: (() => Promise<bigint>) | undefined;
  if (swap) {
    target = swap.target as Address;
    const output = rule.assets![input === 0 ? 1 : 0];
    outputToken = (
      typeof output.token === 'string' ? output.token : output.token.address
    ) as Address;
    const factory = await read(target, 'factory');
    let fee: number | undefined;
    for (const tier of [100, 500, 2500, 3000, 10000]) {
      const pool: Address = await read(factory, 'getPool', [
        token,
        outputToken,
        tier,
      ]);
      if (!/^0x0+$/.test(pool) && (await read(pool, 'liquidity')) > BigInt(0)) {
        fee = tier;
        break;
      }
    }
    if (!fee)
      throw new Error(
        'PRESET_PROTOCOL_UNAVAILABLE: routed default pair has no active pool'
      );
    data = encodeFunctionData({
      abi: ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: token,
          tokenOut: outputToken,
          fee,
          recipient: cea,
          amountIn: amount,
          amountOutMinimum: BigInt(1),
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });
  } else {
    const call = rule.allowedCalls.find(
      (c) =>
        c.selector === 'supply(address,uint256,address,uint16)' ||
        c.selector === 'mint(uint256)' ||
        c.selector === 'depositIntoStrategy(address,address,uint256)'
    );
    if (!call)
      throw new Error(
        'PRESET_ACCEPTANCE_UNIMPLEMENTED: no verified operation for this catalog entry'
      );
    target = call.target as Address;
    if (call.selector === 'supply(address,uint256,address,uint16)') {
      const reserve = await read(target, 'getReserveData', [token]);
      if (/^0x0+$/.test(reserve.aTokenAddress))
        throw new Error(
          'PRESET_PROTOCOL_UNAVAILABLE: token is not an Aave reserve'
        );
      shares = () => read(reserve.aTokenAddress, 'balanceOf', [cea]);
      data = encodeFunctionData({
        abi: ABI,
        functionName: 'supply',
        args: [token, amount, cea, 0],
      });
    } else if (call.selector === 'mint(uint256)') {
      shares = () => read(target, 'balanceOf', [cea]);
      data = encodeFunctionData({
        abi: ABI,
        functionName: 'mint',
        args: [amount],
      });
    } else {
      const strategy = '0x424246eF71b01ee33aA33aC590fd9a0855F5eFbc' as Address;
      shares = () => read(target, 'stakerDepositShares', [cea, strategy]);
      data = encodeFunctionData({
        abi: ABI,
        functionName: 'depositIntoStrategy',
        args: [strategy, token, amount],
      });
    }
  }
  const resultBalance =
    shares ??
    (() =>
      rpc.readContract({
        address: outputToken!,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [cea],
      }));
  return {
    rpc,
    token,
    amount,
    target,
    resultBalance,
    calls: [
      {
        to: token,
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
  // Explicit titles also allow CI's scenario selector to enumerate all nine.
  const run = async (
    category: 'DEXES' | 'LENDING' | 'STAKING',
    chainNamespace: `eip155:${string}`
  ) => {
    const preview = PushChain.utils.agentic.presets.get(category, {
      chainNamespace,
      agent: '0x0000000000000000000000000000000000005678',
    });
    if (!preview.readiness.ready)
      throw new Error(
        `PRESET_BLOCKED_BEFORE_FUNDING ${category} ${chainNamespace}: ${JSON.stringify(
          preview.readiness.chains[0].issues
        )}`
      );
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
      // A swap may start from whichever default asset the owner holds as a PRC20.
      const swapPreset = generated.rules[0].allowedCalls.some((c) =>
        c.selector.toString().startsWith('exactInputSingle(')
      );
      let input = 0;
      if (swapPreset)
        for (const [i, a] of generated.rules[0].assets!.entries()) {
          const prc20 = resolveAgenticPrc20(
            {
              chain: chainNamespace,
              address: typeof a.token === 'string' ? a.token : a.token.address,
            },
            f.manifest.network
          ).address;
          const held = await f.push.readContract({
            address: prc20,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [f.ownerAddress],
          });
          if (held >= (a.maxPerCall / BigInt(1000)) * BigInt(2)) {
            input = i;
            break;
          }
        }
      const op = await operation(generated.rules[0], cea, input);
      const mapped = resolveAgenticPrc20(
        { chain: chainNamespace, address: op.token },
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
        throw new Error('PRESET_PREREQUISITE: owner lacks exact default PRC20');
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
            funds: {
              amount: op.amount,
              token: {
                symbol: mapped.symbol,
                decimals: mapped.decimals,
                address: op.token,
                mechanism: 'approve',
              },
            },
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
          expect(stored.spent.assets[input].spent).toBe(
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
  it('4. DEXES BNB testnet', () => run(...PRESET_ACCEPTANCE_CASES[3]), 600000);
  it('5. LENDING Sepolia', () => run(...PRESET_ACCEPTANCE_CASES[4]), 600000);
  it(
    '6. LENDING Base Sepolia',
    () => run(...PRESET_ACCEPTANCE_CASES[5]),
    600000
  );
  it(
    '7. LENDING Arbitrum Sepolia',
    () => run(...PRESET_ACCEPTANCE_CASES[6]),
    600000
  );
  it(
    '8. LENDING BNB testnet',
    () => run(...PRESET_ACCEPTANCE_CASES[7]),
    600000
  );
  it('9. STAKING Sepolia', () => run(...PRESET_ACCEPTANCE_CASES[8]), 600000);
});
