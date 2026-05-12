/**
 * Static reproduction for the 6-hop Sepolia CEA -> Push AMM -> Solana cascade.
 *
 * This does not broadcast. It exercises the same cascade shape with a fresh
 * UEA balance:
 *   R3 inbound from a funded Sepolia CEA, carrying pETH funds and a 5 PC Push payload seed
 *   R1 approvals/swaps on Push
 *   R2 SVM outbound that burns the pSOL produced by the Push swap segment
 */
import '@e2e/shared/setup';
import { ethers } from 'ethers';
import { decodeFunctionData } from 'viem';
import { PushChain } from '../../src';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi';
import { TransactionRoute } from '../../src/lib/orchestrator/route-detector';
import {
  buildHopDescriptor,
  classifyIntoSegments,
  createCascadedBuilder,
} from '../../src/lib/orchestrator/internals/cascade';
import type { OrchestratorContext } from '../../src/lib/orchestrator/internals/context';
import type {
  HopDescriptor,
  MultiCall,
  PreparedUniversalTx,
  UniversalExecuteParams,
} from '../../src/lib/orchestrator/orchestrator.types';
import * as gasCalculator from '../../src/lib/orchestrator/internals/gas-calculator';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { getUniversalGatewayPCAddress } from '../../src/lib/orchestrator/internals/helpers';

jest.mock('../../src/lib/orchestrator/cea-utils', () => ({
  ...jest.requireActual('../../src/lib/orchestrator/cea-utils'),
  getCEAAddress: jest.fn(),
}));

const PC = BigInt('1000000000000000000');
const UNCAPPED_BALANCE = BigInt('1000000000000000000000000000000');
const UEA = '0xce83ed95b1DD7141451a522F8cc5B6858Ee67bcc' as `0x${string}`;
const UOA = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const CEA_SEPOLIA =
  '0x2222222222222222222222222222222222222222' as `0x${string}`;
const CEA_BNB = '0x5555555555555555555555555555555555555555' as `0x${string}`;
const SWAP_ROUTER =
  '0x5D548bB9E305AAe0d6dc6e6fdc3ab419f6aC0037' as `0x${string}`;
const PETH = '0x2971824Db68229D087931155C2b8bB820B275809' as `0x${string}`;
const WPC = '0xE17DD2E0509f99E9ee9469Cf6634048Ec5a3ADe9' as `0x${string}`;
const PSOL = '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed' as `0x${string}`;
const CORE = '0x3333333333333333333333333333333333333333' as `0x${string}`;
const QUOTER_V2 = '0x83316275f7C2F79BC4E26f089333e88E89093037';
const POOL_FEE = 500;
const SOLANA_CEA =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;
const RPC_SEPOLIA = 'https://ethereum-sepolia-rpc.publicnode.com';
const RPC_PUSH = 'https://evm.donut.rpc.push.org/';
const RPC_BNB = 'https://bsc-testnet-rpc.publicnode.com';
const SWAP_DEADLINE = BigInt(9_999_999_999);
const COUNTER_PUSH = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const COUNTER_BNB = '0x7f0936bb90e7dcf3edb47199c2005e7184e44cf8';

const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const COUNTER_ABI = [
  {
    inputs: [],
    name: 'increment',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'count',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'countPC',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const SWAP_ROUTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'exactInputSingle',
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

const QUOTER_ABI = [
  {
    inputs: [
      {
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'quoteExactInputSingle',
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

function makeCtx(): OrchestratorContext {
  return {
    rpcUrls: { [CHAIN.ETHEREUM_SEPOLIA]: ['https://example.invalid'] },
    printTraces: false,
    progressHook: () => undefined,
    pushNetwork: PUSH_NETWORK.TESTNET_DONUT,
    universalSigner: {
      account: { address: UOA, chain: CHAIN.ETHEREUM_SEPOLIA },
    } as never,
    accountStatusCache: null,
    pushClient: {
      pushChainInfo: {
        factoryAddress: '0x4444444444444444444444444444444444444444',
      },
      getBalance: jest.fn(async () => BigInt(0)),
      publicClient: {
        getCode: jest.fn(async () => undefined),
      },
      readContract: jest.fn(
        async ({ functionName }: { functionName: string }) => {
          if (
            functionName === 'UNIVERSAL_CORE' ||
            functionName === 'universalCore'
          )
            return CORE;
          if (functionName === 'balanceOf') return BigInt(0);
          return BigInt(0);
        }
      ),
    } as never,
  } as unknown as OrchestratorContext;
}

function route1Hop(label: string, to: `0x${string}`): HopDescriptor {
  return {
    params: { to, value: BigInt(0), data: `0x${label}` as `0x${string}` },
    route: 'UOA_TO_PUSH',
    pushMulticalls: [
      { to, value: BigInt(0), data: `0x${label}` as `0x${string}` },
    ],
    gasLimit: BigInt(0),
    maxPCForGas: BigInt(0),
    ueaAddress: UEA,
    revertRecipient: UEA,
  };
}

function prepared(hop: HopDescriptor): PreparedUniversalTx {
  return {
    route: hop.route,
    payload: '0x',
    gatewayRequest: {} as never,
    estimatedGas: BigInt(0),
    nonce: BigInt(0),
    deadline: BigInt(0),
    _hop: hop,
  } as PreparedUniversalTx;
}

describe('6-hop AMM cascade simulation (funded Sepolia CEA)', () => {
  beforeEach(() => {
    (getCEAAddress as jest.Mock).mockResolvedValue({ cea: CEA_SEPOLIA });
    jest.spyOn(gasCalculator, 'queryOutboundGasFee').mockResolvedValue({
      gasFee: BigInt(1),
      protocolFee: BigInt(0),
      gasToken: PETH,
      gasPrice: BigInt(1),
      gasLimitUsed: BigInt(0),
      nativeValueForGas: BigInt(0),
      universalCoreAddress: CORE,
      sizing: undefined,
    } as Awaited<ReturnType<typeof gasCalculator.queryOutboundGasFee>>);
    jest
      .spyOn(gasCalculator, 'estimateNativeValueForSwap')
      .mockResolvedValue(BigInt(2) * PC);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not require pre-existing pETH/pSOL and fee-locks nested PC value', async () => {
    const ctx = makeCtx();
    const amountIn = PushChain.utils.helpers.parseUnits('0.001', 18);
    const pSolAmount = BigInt(123_456_789);

    const hop0Params: UniversalExecuteParams = {
      from: { chain: CHAIN.ETHEREUM_SEPOLIA },
      to: UEA,
      value: BigInt(5) * PC,
      data: '0x',
      funds: {
        amount: amountIn,
        token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
      },
    };
    const hop0 = await buildHopDescriptor(
      ctx,
      hop0Params,
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );

    const hop1 = route1Hop('01', PETH);
    const hop2 = route1Hop('02', WPC);
    const hop3 = route1Hop('03', SWAP_ROUTER);
    const hop4 = route1Hop('04', SWAP_ROUTER);
    const hop5: HopDescriptor = {
      params: {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: pSolAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol,
        },
      },
      route: 'UOA_TO_CEA',
      targetChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      svmPayload: '0x',
      prc20Token: PSOL,
      burnAmount: pSolAmount,
      gasToken: PSOL,
      gasFee: BigInt(1),
      gasLimit: BigInt(0),
      maxPCForGas: BigInt(0),
      ueaAddress: UEA,
      revertRecipient: UEA,
    };

    const segments = classifyIntoSegments([hop0, hop1, hop2, hop3, hop4, hop5]);
    expect(segments.map((s) => s.type)).toEqual([
      'INBOUND_FROM_CEA',
      'PUSH_EXECUTION',
      'OUTBOUND_TO_CEA',
    ]);
    expect(segments[0].totalBurnAmount).toBe(BigInt(0));

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'ab'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop2, hop3, hop4, hop5].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    expect(gasCalculator.estimateNativeValueForSwap).toHaveBeenCalledWith(
      ctx,
      CORE,
      PSOL,
      BigInt(1),
      UNCAPPED_BALANCE
    );

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };
    // 5 PC Hop 0 payload seed + 2 PC SVM gas-swap quote + 1 PC R3 wrapper gas.
    expect(executeParams.value).toBe(BigInt(8) * PC);
    expect(executeParams.data).toHaveLength(1);
    expect(executeParams.data[0].value).toBe(PC);

    const decoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: executeParams.data[0].data,
    });
    expect(decoded.functionName).toBe('sendUniversalTxOutbound');
    const [req] = decoded.args as unknown as [{ amount: bigint }];
    expect(req.amount).toBe(BigInt(0));
  });

  it('does not clamp SVM gas funding below the live pool quote', async () => {
    jest
      .spyOn(gasCalculator, 'estimateNativeValueForSwap')
      .mockResolvedValue(BigInt(4) * PC);

    const ctx = makeCtx();
    const amountIn = PushChain.utils.helpers.parseUnits('0.001', 18);
    const pSolAmount = BigInt(123_456_789);

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: BigInt(5) * PC,
        data: '0x',
        funds: {
          amount: amountIn,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = route1Hop('01', PETH);
    const hop5: HopDescriptor = {
      params: {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: pSolAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol,
        },
      },
      route: 'UOA_TO_CEA',
      targetChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      svmPayload: '0x',
      prc20Token: PSOL,
      burnAmount: pSolAmount,
      gasToken: PSOL,
      gasFee: BigInt(1),
      gasLimit: BigInt(0),
      maxPCForGas: BigInt(0),
      ueaAddress: UEA,
      revertRecipient: UEA,
    };

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'ab'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop5].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
    };
    // 5 PC Hop 0 payload seed + 4 PC live SVM quote + 1 PC R3 wrapper gas.
    // Before the fix the 4 PC quote was truncated to the 3 PC per-SVM budget
    // because the cascade seed budget was previously squeezed below the quote.
    expect(executeParams.value).toBe(BigInt(10) * PC);
  });

  it('derives non-zero SVM gasLimit for cascade outbound requests', async () => {
    jest.spyOn(gasCalculator, 'queryOutboundGasFee').mockResolvedValue({
      gasFee: BigInt(960_000),
      protocolFee: BigInt(0),
      gasToken: PSOL,
      gasPrice: BigInt(1_000),
      gasLimitUsed: BigInt(0),
      nativeValueForGas: BigInt(0),
      universalCoreAddress: CORE,
      sizing: undefined,
    } as Awaited<ReturnType<typeof gasCalculator.queryOutboundGasFee>>);

    const hop = await buildHopDescriptor(
      makeCtx(),
      {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(123),
        data: '0x',
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    expect(hop.gasLimit).toBe(BigInt(960));
  });

  it('uses the Donut SwapRouter exactInputSingle ABI with deadline', () => {
    const data = PushChain.utils.helpers.encodeTxData({
      abi: [...SWAP_ROUTER_ABI],
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: PETH,
          tokenOut: WPC,
          fee: POOL_FEE,
          recipient: UEA,
          deadline: SWAP_DEADLINE,
          amountIn: BigInt(1),
          amountOutMinimum: BigInt(0),
          sqrtPriceLimitX96: BigInt(0),
        },
      ],
    });

    expect(data.slice(0, 10)).toBe('0x414bf389');
  });

  it('treats value-only CEA_TO_PUSH as a root PC seed for downstream Push and EVM outbound hops', async () => {
    (getCEAAddress as jest.Mock).mockImplementation(
      async (_uea: string, chain: CHAIN) => ({
        cea: chain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_SEPOLIA,
      })
    );

    const ctx = makeCtx();
    const seedAmount = BigInt(15) * PC;
    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: seedAmount,
        data: '0x',
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = route1Hop('01', PETH);
    const hop2 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(0),
        data: incrementData,
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'cd'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop2].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };

    expect(executeParams.value).toBe(seedAmount);
    expect(executeParams.data).toHaveLength(2);
    expect(executeParams.data[0]).toMatchObject({
      to: PETH,
      value: BigInt(0),
      data: '0x01',
    });

    const outboundCall = executeParams.data[1];
    expect(outboundCall.to).toBe(getUniversalGatewayPCAddress());
    const decoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: outboundCall.data,
    });
    expect(decoded.functionName).toBe('sendUniversalTxOutbound');
    const [req] = decoded.args as unknown as [
      { target: `0x${string}`; amount: bigint; payload: `0x${string}` },
    ];
    expect(req.target).toBe(CEA_BNB);
    expect(req.amount).toBe(BigInt(0));
    expect(req.payload).not.toBe('0x');
  });

  it('treats value-only UOA_TO_PUSH to the UEA as a root PC seed for a downstream outbound hop', async () => {
    (getCEAAddress as jest.Mock).mockImplementation(
      async (_uea: string, chain: CHAIN) => ({
        cea: chain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_SEPOLIA,
      })
    );

    const ctx = makeCtx();
    const seedAmount = BigInt(15) * PC;
    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        to: UEA,
        value: seedAmount,
        data: '0x',
      },
      TransactionRoute.UOA_TO_PUSH,
      UEA
    );
    const hop1 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(0),
        data: incrementData,
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'ef'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };

    expect(executeParams.value).toBe(seedAmount);
    expect(executeParams.data).toHaveLength(1);
    expect(executeParams.data[0].to).toBe(getUniversalGatewayPCAddress());

    const decoded = decodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      data: executeParams.data[0].data,
    });
    expect(decoded.functionName).toBe('sendUniversalTxOutbound');
    const [req] = decoded.args as unknown as [
      { target: `0x${string}`; amount: bigint; payload: `0x${string}` },
    ];
    expect(req.target).toBe(CEA_BNB);
    expect(req.amount).toBe(BigInt(0));
    expect(req.payload).not.toBe('0x');
  });

  it('allows CEA_TO_PUSH inbound funds to satisfy a later outbound burn without an intermediate Push hop', async () => {
    const ctx = makeCtx();
    const amount = PushChain.utils.helpers.parseUnits('0.001', 18);
    const seedAmount = BigInt(5) * PC;

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: seedAmount,
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const segments = classifyIntoSegments([hop0, hop1]);
    expect(segments.map((s) => s.type)).toEqual([
      'INBOUND_FROM_CEA',
      'OUTBOUND_TO_CEA',
    ]);

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'12'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };
    expect(executeParams.value).toBe(BigInt(7) * PC);
    expect(executeParams.data).toHaveLength(1);
    expect(executeParams.data[0].to).toBe(getUniversalGatewayPCAddress());
  });

  it('rejects when prior inbound funds are for a different outbound burn token', async () => {
    const ctx = makeCtx();
    const amount = PushChain.utils.helpers.parseUnits('0.001', 18);
    const pSolAmount = BigInt(123_456_789);

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: BigInt(5) * PC,
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1: HopDescriptor = {
      params: {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: pSolAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol,
        },
      },
      route: 'UOA_TO_CEA',
      targetChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      svmPayload: '0x',
      prc20Token: PSOL,
      burnAmount: pSolAmount,
      gasToken: PSOL,
      gasFee: BigInt(1),
      gasLimit: BigInt(0),
      maxPCForGas: BigInt(0),
      ueaAddress: UEA,
      revertRecipient: UEA,
    };

    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1].map(prepared),
      {
        executeFn: jest.fn(),
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await expect(builder.send()).rejects.toMatchObject({
      reason: 'PRC20',
      burnToken: PSOL,
      required: pSolAmount,
      available: BigInt(0),
      shortfall: pSolAmount,
    });
  });

  it('rejects when prior inbound funds only partially cover a later outbound burn', async () => {
    const ctx = makeCtx();
    const inboundAmount = PushChain.utils.helpers.parseUnits('0.001', 18);
    const outboundAmount = PushChain.utils.helpers.parseUnits('0.002', 18);

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: BigInt(5) * PC,
        data: '0x',
        funds: {
          amount: inboundAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: outboundAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1].map(prepared),
      {
        executeFn: jest.fn(),
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await expect(builder.send()).rejects.toMatchObject({
      reason: 'PRC20',
      burnToken: PETH,
      required: outboundAmount,
      available: inboundAmount,
      shortfall: outboundAmount - inboundAmount,
    });
  });

  it('splits seeded native value across multiple downstream outbound hops', async () => {
    (getCEAAddress as jest.Mock).mockImplementation(
      async (_uea: string, chain: CHAIN) => ({
        cea: chain === CHAIN.BNB_TESTNET ? CEA_BNB : CEA_SEPOLIA,
      })
    );

    const ctx = makeCtx();
    const seedAmount = BigInt(15) * PC;
    const incrementData = PushChain.utils.helpers.encodeTxData({
      abi: [...COUNTER_ABI],
      functionName: 'increment',
    });

    const hop0 = await buildHopDescriptor(
      ctx,
      { to: UEA, value: seedAmount, data: '0x' },
      TransactionRoute.UOA_TO_PUSH,
      UEA
    );
    const hop1 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.BNB_TESTNET,
        },
        value: BigInt(0),
        data: incrementData,
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );
    const hop2 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x8888888888888888888888888888888888888888',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(0),
        data: incrementData,
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'34'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop2].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };
    expect(executeParams.value).toBe(seedAmount);
    expect(executeParams.data).toHaveLength(2);
    expect(executeParams.data.every((call) => call.value === BigInt(6) * PC))
      .toBe(true);
    expect(executeParams.data.every((call) => call.to === getUniversalGatewayPCAddress()))
      .toBe(true);
  });

  it('keeps seed-only and real CEA_TO_PUSH hops from the same source chain in separate segments', async () => {
    const ctx = makeCtx();
    const seedAmount = BigInt(5) * PC;
    const inboundPayloadSeed = PC;
    const amount = PushChain.utils.helpers.parseUnits('0.001', 18);

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: seedAmount,
        data: '0x',
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: inboundPayloadSeed,
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );

    const segments = classifyIntoSegments([hop0, hop1]);
    expect(segments.map((s) => s.type)).toEqual([
      'INBOUND_FROM_CEA',
      'INBOUND_FROM_CEA',
    ]);
    expect(segments[0].hops).toHaveLength(1);
    expect(segments[1].hops).toHaveLength(1);

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'56'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };
    expect(executeParams.value).toBe(seedAmount);
    expect(executeParams.data).toHaveLength(1);
    expect(executeParams.data[0].to).toBe(getUniversalGatewayPCAddress());
  });

  it('allows R3 inbound funds to pass through a Push hop before a same-token outbound burn', async () => {
    const ctx = makeCtx();
    const amount = PushChain.utils.helpers.parseUnits('0.001', 18);
    const seedAmount = BigInt(5) * PC;

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: seedAmount,
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = route1Hop('01', PETH);
    const hop2 = await buildHopDescriptor(
      ctx,
      {
        to: {
          address: '0x7777777777777777777777777777777777777777',
          chain: CHAIN.ETHEREUM_SEPOLIA,
        },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    const segments = classifyIntoSegments([hop0, hop1, hop2]);
    expect(segments.map((s) => s.type)).toEqual([
      'INBOUND_FROM_CEA',
      'PUSH_EXECUTION',
      'OUTBOUND_TO_CEA',
    ]);

    const executeFn = jest.fn(async (params: unknown) => ({
      hash: `0x${'78'.repeat(32)}`,
      params,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop2].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    await builder.send();

    const executeParams = executeFn.mock.calls[0][0] as {
      value: bigint;
      data: MultiCall[];
    };
    expect(executeParams.value).toBe(BigInt(7) * PC);
    expect(executeParams.data).toHaveLength(1);
    expect(executeParams.data[0].to).toBe(getUniversalGatewayPCAddress());
  });

  it('does not report success when the Route 3 source-chain tx reverts', async () => {
    const ctx = makeCtx();
    const amountIn = PushChain.utils.helpers.parseUnits('0.001', 18);
    const failedExternalTx =
      `0x${'1e'.repeat(32)}` as `0x${string}`;

    const hop0 = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: UEA,
        value: BigInt(5) * PC,
        data: '0x',
        funds: {
          amount: amountIn,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const hop1 = route1Hop('01', PETH);
    const hop2: HopDescriptor = {
      params: {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: BigInt(123_456_789),
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol,
        },
      },
      route: 'UOA_TO_CEA',
      targetChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      svmPayload: '0x',
      prc20Token: PSOL,
      burnAmount: BigInt(123_456_789),
      gasToken: PSOL,
      gasFee: BigInt(1),
      gasLimit: BigInt(0),
      maxPCForGas: BigInt(0),
      ueaAddress: UEA,
      revertRecipient: UEA,
    };

    const executeFn = jest.fn(async () => ({
      hash: `0x${'ab'.repeat(32)}`,
      wait: jest.fn(async () => undefined),
    }));
    const waitForOutboundTxFn = jest.fn(async () => {
      throw Object.assign(
        new Error(
          `Outbound to ${CHAIN.ETHEREUM_SEPOLIA} reverted on source-chain RPC (tx: ${failedExternalTx}).`
        ),
        { externalTxHash: failedExternalTx }
      );
    });
    const waitForInboundPushTxFn = jest.fn();
    const waitForAllOutboundTxsFn = jest.fn();
    const builder = createCascadedBuilder(
      ctx,
      [hop0, hop1, hop2].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn,
        waitForInboundPushTxFn,
        waitForAllOutboundTxsFn,
      } as never
    );

    const cascade = await builder.send();
    const result = await cascade.waitForAll({
      timeout: 10_000,
      pollingIntervalMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.hops[0].status).toBe('failed');
    expect(result.hops[0].txHash).toBe(failedExternalTx);
    expect(result.hops[1].status).toBe('pending');
    expect(result.hops[2].status).toBe('pending');
    expect(waitForInboundPushTxFn).not.toHaveBeenCalled();
    expect(waitForAllOutboundTxsFn).not.toHaveBeenCalled();
  });

  it('exposes Solana outbound tx hashes as base58 in cascade results and progress', async () => {
    const ctx = makeCtx();
    const seedAmount = BigInt(5) * PC;
    const rawSolanaTxHash = `0x${'25'.repeat(64)}`;
    const progressEvents: Array<{
      chain: CHAIN;
      status: string;
      txHash?: string;
    }> = [];

    const seedHop = await buildHopDescriptor(
      ctx,
      {
        to: UEA,
        value: seedAmount,
        data: '0x',
      },
      TransactionRoute.UOA_TO_PUSH,
      UEA
    );
    const solanaOutbound: HopDescriptor = {
      params: {
        to: { address: SOLANA_CEA, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
      },
      route: 'UOA_TO_CEA',
      targetChain: CHAIN.SOLANA_DEVNET,
      isSvmTarget: true,
      svmPayload: '0x',
      prc20Token: PSOL,
      burnAmount: BigInt(0),
      gasToken: PSOL,
      gasFee: BigInt(1),
      gasLimit: BigInt(0),
      maxPCForGas: BigInt(0),
      ueaAddress: UEA,
      revertRecipient: UEA,
    };

    const executeFn = jest.fn(async () => ({
      hash: `0x${'ab'.repeat(32)}`,
      wait: jest.fn(async () => undefined),
    }));
    const waitForOutboundTxFn = jest.fn(async () => ({
      externalTxHash: rawSolanaTxHash,
      destinationChain: CHAIN.SOLANA_DEVNET,
      explorerUrl: '',
      recipient: SOLANA_CEA,
      amount: '0',
      assetAddr: PSOL,
    }));
    const builder = createCascadedBuilder(
      ctx,
      [seedHop, solanaOutbound].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn,
        waitForInboundPushTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    const cascade = await builder.send();
    const result = await cascade.waitForAll({
      timeout: 10_000,
      pollingIntervalMs: 1,
      progressHook: (event) => {
        progressEvents.push({
          chain: event.chain,
          status: event.status,
          txHash: event.txHash,
        });
      },
    });

    const solanaHop = result.hops[1];
    expect(result.success).toBe(true);
    expect(solanaHop.status).toBe('confirmed');
    expect(solanaHop.txHash).toBeDefined();
    expect(solanaHop.txHash).not.toBe(rawSolanaTxHash);
    expect(solanaHop.txHash).not.toMatch(/^0x/);
    expect(solanaHop.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,90}$/);
    expect(solanaHop.outboundDetails?.externalTxHash).toBe(solanaHop.txHash);

    const confirmedEvent = progressEvents.find(
      (event) =>
        event.chain === CHAIN.SOLANA_DEVNET &&
        event.status === 'confirmed' &&
        event.txHash
    );
    expect(confirmedEvent?.txHash).toBe(solanaHop.txHash);
  });

  it('exposes Solana Route 3 failure tx hashes as base58 in cascade results and progress', async () => {
    const ctx = makeCtx();
    (ctx.pushClient.getBalance as jest.Mock).mockResolvedValue(
      UNCAPPED_BALANCE
    );
    const rawSolanaTxHash = `0x${'35'.repeat(64)}`;
    const progressEvents: Array<{
      chain: CHAIN;
      status: string;
      txHash?: string;
    }> = [];

    const solanaInbound = await buildHopDescriptor(
      ctx,
      {
        from: { chain: CHAIN.SOLANA_DEVNET },
        to: UEA,
        value: BigInt(5_000_000),
        data: '0x01',
      },
      TransactionRoute.CEA_TO_PUSH,
      UEA
    );
    const pushHop = route1Hop('01', PETH);

    const executeFn = jest.fn(async () => ({
      hash: `0x${'ab'.repeat(32)}`,
      wait: jest.fn(async () => undefined),
    }));
    const waitForOutboundTxFn = jest.fn(async () => {
      throw Object.assign(
        new Error(
          `Outbound to ${CHAIN.SOLANA_DEVNET} reverted on source-chain RPC (tx: ${rawSolanaTxHash}).`
        ),
        { externalTxHash: rawSolanaTxHash }
      );
    });

    const builder = createCascadedBuilder(
      ctx,
      [solanaInbound, pushHop].map(prepared),
      {
        executeFn,
        waitForOutboundTxFn,
        waitForInboundPushTxFn: jest.fn(),
        waitForAllOutboundTxsFn: jest.fn(),
      } as never
    );

    const cascade = await builder.send();
    const result = await cascade.waitForAll({
      timeout: 10_000,
      pollingIntervalMs: 1,
      progressHook: (event) => {
        progressEvents.push({
          chain: event.chain,
          status: event.status,
          txHash: event.txHash,
        });
      },
    });

    const solanaHop = result.hops[0];
    expect(result.success).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(solanaHop.status).toBe('failed');
    expect(solanaHop.txHash).toBeDefined();
    expect(solanaHop.txHash).not.toBe(rawSolanaTxHash);
    expect(solanaHop.txHash).not.toMatch(/^0x/);
    expect(solanaHop.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,90}$/);

    const failedEvent = progressEvents.find(
      (event) =>
        event.chain === CHAIN.SOLANA_DEVNET &&
        event.status === 'failed' &&
        event.txHash
    );
    expect(failedEvent?.txHash).toBe(solanaHop.txHash);
  });
});

describe('6-hop AMM cascade live e2e (funded Sepolia CEA)', () => {
  const evmKey = process.env['EVM_PRIVATE_KEY'] as `0x${string}` | undefined;
  const runLive = evmKey && process.env['RUN_LIVE_SIX_HOP_CASCADE'] === '1';

  (runLive ? it : it.skip)(
    'executes Sepolia ETH -> pETH -> WPC -> pSOL -> Solana CEA',
    async () => {
      const actualCeaUtils = jest.requireActual(
        '../../src/lib/orchestrator/cea-utils'
      ) as typeof import('../../src/lib/orchestrator/cea-utils');
      (getCEAAddress as jest.Mock).mockImplementation(
        actualCeaUtils.getCEAAddress
      );

      const sepoliaProvider = new ethers.JsonRpcProvider(RPC_SEPOLIA);
      const pushProvider = new ethers.JsonRpcProvider(RPC_PUSH);
      const sponsor = new ethers.Wallet(evmKey!, sepoliaProvider);
      const wallet = ethers.Wallet.createRandom();
      const signer = wallet.connect(sepoliaProvider);

      console.log(`fresh Sepolia UOA: ${wallet.address}`);
      const fundTx = await sponsor.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther('0.02'),
      });
      console.log(`funded fresh UOA: ${fundTx.hash}`);
      await fundTx.wait(1);

      const universalSigner = await PushChain.utils.signer.toUniversal(signer);
      const client = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        printTraces: true,
        progressHook: (event) => {
          console.log(`[${event.id}] ${event.title}`);
        },
      });
      console.log(`fresh UEA: ${client.universal.account}`);

      const { cea: sepoliaCEA } = await actualCeaUtils.getCEAAddress(
        client.universal.account as `0x${string}`,
        CHAIN.ETHEREUM_SEPOLIA,
        RPC_SEPOLIA
      );
      console.log(`Sepolia CEA source: ${sepoliaCEA}`);
      const fundCeaTx = await sponsor.sendTransaction({
        to: sepoliaCEA,
        value: ethers.parseEther('0.003'),
      });
      console.log(`funded source CEA: ${fundCeaTx.hash}`);
      await fundCeaTx.wait(1);

      const uoa = PushChain.utils.account.toUniversal(wallet.address, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });
      const solanaCEA = await PushChain.utils.account.deriveExecutorAccount(
        uoa,
        {
          chain: CHAIN.SOLANA_DEVNET,
          skipNetworkCheck: true,
        }
      );
      console.log(`Solana CEA: ${solanaCEA.address}`);

      const amountIn = PushChain.utils.helpers.parseUnits('0.001', 18);
      const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, pushProvider);
      const wpcQuote = (await quoter['quoteExactInputSingle'].staticCall({
        tokenIn: PETH,
        tokenOut: WPC,
        amountIn,
        fee: POOL_FEE,
        sqrtPriceLimitX96: BigInt(0),
      })) as { amountOut: bigint };
      const wpcAmount = (wpcQuote.amountOut * BigInt(99)) / BigInt(100);
      const pSolQuote = (await quoter['quoteExactInputSingle'].staticCall({
        tokenIn: WPC,
        tokenOut: PSOL,
        amountIn: wpcAmount,
        fee: POOL_FEE,
        sqrtPriceLimitX96: BigInt(0),
      })) as { amountOut: bigint };
      const pSolAmount = (pSolQuote.amountOut * BigInt(99)) / BigInt(100);
      console.log(`quoted WPC amount: ${wpcAmount.toString()}`);
      console.log(`quoted pSOL amount: ${pSolAmount.toString()}`);

      const hop0 = await client.universal.prepareTransaction({
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: client.universal.account,
        value: BigInt(5) * PC,
        data: '0x',
        funds: {
          amount: amountIn,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      });
      const hop1 = await client.universal.prepareTransaction({
        to: PETH,
        value: BigInt(0),
        data: PushChain.utils.helpers.encodeTxData({
          abi: [...ERC20_APPROVE_ABI],
          functionName: 'approve',
          args: [SWAP_ROUTER, ethers.MaxUint256],
        }),
      });
      const hop2 = await client.universal.prepareTransaction({
        to: WPC,
        value: BigInt(0),
        data: PushChain.utils.helpers.encodeTxData({
          abi: [...ERC20_APPROVE_ABI],
          functionName: 'approve',
          args: [SWAP_ROUTER, ethers.MaxUint256],
        }),
      });
      const hop3 = await client.universal.prepareTransaction({
        to: SWAP_ROUTER,
        value: BigInt(0),
        data: PushChain.utils.helpers.encodeTxData({
          abi: [...SWAP_ROUTER_ABI],
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: PETH,
              tokenOut: WPC,
              fee: POOL_FEE,
              recipient: client.universal.account as `0x${string}`,
              deadline: SWAP_DEADLINE,
              amountIn,
              amountOutMinimum: BigInt(0),
              sqrtPriceLimitX96: BigInt(0),
            },
          ],
        }),
      });
      const hop4 = await client.universal.prepareTransaction({
        to: SWAP_ROUTER,
        value: BigInt(0),
        data: PushChain.utils.helpers.encodeTxData({
          abi: [...SWAP_ROUTER_ABI],
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: WPC,
              tokenOut: PSOL,
              fee: POOL_FEE,
              recipient: client.universal.account as `0x${string}`,
              deadline: SWAP_DEADLINE,
              amountIn: wpcAmount,
              amountOutMinimum: BigInt(0),
              sqrtPriceLimitX96: BigInt(0),
            },
          ],
        }),
      });
      const hop5 = await client.universal.prepareTransaction({
        to: { address: solanaCEA.address, chain: CHAIN.SOLANA_DEVNET },
        value: BigInt(0),
        data: '0x',
        funds: {
          amount: pSolAmount,
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.PUSH_TESTNET_DONUT.pSol,
        },
      });

      const cascade = await client.universal.executeTransactions([
        hop0,
        hop1,
        hop2,
        hop3,
        hop4,
        hop5,
      ]);
      console.log(`cascade initialTxHash: ${cascade.initialTxHash}`);
      expect(cascade.hopCount).toBe(6);

      const result = await cascade.wait({
        timeout: 900_000,
        progressHook: (event) => {
          console.log(
            `  [Hop ${event.hopIndex}] ${event.status} on ${event.chain}`
          );
        },
      });
      console.log(`cascade success: ${result.success}`);
      expect(result.success).toBe(true);
    },
    1_200_000
  );
});

describe('value-only PC seed cascade live e2e (Sepolia -> Push -> BNB)', () => {
  const evmKey = process.env['EVM_PRIVATE_KEY'] as `0x${string}` | undefined;
  const runLive =
    evmKey && process.env['RUN_LIVE_VALUE_SEED_BNB_CASCADE'] === '1';

  (runLive ? it : it.skip)(
    'executes fresh UEA PC seed, Push counter, then BNB counter without pre-funding UEA',
    async () => {
      const actualCeaUtils = jest.requireActual(
        '../../src/lib/orchestrator/cea-utils'
      ) as typeof import('../../src/lib/orchestrator/cea-utils');
      (getCEAAddress as jest.Mock).mockImplementation(
        actualCeaUtils.getCEAAddress
      );

      const sepoliaProvider = new ethers.JsonRpcProvider(RPC_SEPOLIA);
      const pushProvider = new ethers.JsonRpcProvider(RPC_PUSH);
      const bnbProvider = new ethers.JsonRpcProvider(RPC_BNB);
      const sponsor = new ethers.Wallet(evmKey!, sepoliaProvider);
      const wallet = ethers.Wallet.createRandom();
      const signer = wallet.connect(sepoliaProvider);

      console.log(`fresh Sepolia UOA: ${wallet.address}`);
      const fundTx = await sponsor.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther('0.02'),
      });
      console.log(`funded fresh UOA: ${fundTx.hash}`);
      await fundTx.wait(1);

      const universalSigner = await PushChain.utils.signer.toUniversal(signer);
      const client = await PushChain.initialize(universalSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        printTraces: true,
        progressHook: (event) => {
          console.log(`[${event.id}] ${event.title}`);
        },
      });
      console.log(`fresh UEA: ${client.universal.account}`);

      const pushCounter = new ethers.Contract(
        COUNTER_PUSH,
        COUNTER_ABI,
        pushProvider
      );
      const bnbCounter = new ethers.Contract(
        COUNTER_BNB,
        COUNTER_ABI,
        bnbProvider
      );
      const pushBefore = (await pushCounter['countPC']()) as bigint;
      const bnbBefore = (await bnbCounter['count']()) as bigint;
      console.log(`push counter before: ${pushBefore.toString()}`);
      console.log(`bnb counter before: ${bnbBefore.toString()}`);

      const incrementData = PushChain.utils.helpers.encodeTxData({
        abi: [...COUNTER_ABI],
        functionName: 'increment',
      });

      const hop0 = await client.universal.prepareTransaction({
        from: { chain: CHAIN.ETHEREUM_SEPOLIA },
        to: client.universal.account,
        value: BigInt(15) * PC,
        data: '0x',
      });
      const hop1 = await client.universal.prepareTransaction({
        to: COUNTER_PUSH,
        value: BigInt(0),
        data: incrementData,
      });
      const hop2 = await client.universal.prepareTransaction({
        to: { address: COUNTER_BNB, chain: CHAIN.BNB_TESTNET },
        value: BigInt(0),
        data: incrementData,
      });

      const cascade = await client.universal.executeTransactions([
        hop0,
        hop1,
        hop2,
      ]);
      console.log(`cascade initialTxHash: ${cascade.initialTxHash}`);
      expect(cascade.hopCount).toBe(3);

      const result = await cascade.wait({
        timeout: 900_000,
        progressHook: (event) => {
          console.log(
            `  [Hop ${event.hopIndex}] ${event.status} on ${event.chain}`
          );
        },
      });
      console.log(`cascade success: ${result.success}`);
      expect(result.success).toBe(true);

      const pushAfter = (await pushCounter['countPC']()) as bigint;
      const bnbAfter = (await bnbCounter['count']()) as bigint;
      console.log(`push counter after: ${pushAfter.toString()}`);
      console.log(`bnb counter after: ${bnbAfter.toString()}`);
      expect(pushAfter).toBe(pushBefore + BigInt(1));
      expect(bnbAfter).toBe(bnbBefore + BigInt(1));
    },
    1_200_000
  );
});
