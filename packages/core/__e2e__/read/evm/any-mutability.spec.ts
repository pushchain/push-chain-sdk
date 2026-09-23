import '@e2e/shared/setup';
/**
 * E2E · read state · EVM contract calls that are not view/pure.
 *
 * Validators run a contract-call read as an eth_call simulation at the pinned
 * block, so nonpayable and payable functions return data and never execute.
 *   - nonpayable: Uniswap V3 QuoterV2.quoteExactInputSingle (built to be simulated)
 *   - payable:    Multicall3.aggregate, whose first return value is the block the
 *                 call ran at, so it proves the simulation used the pinned block.
 * Both go through the default registry in one batch. Truth = the same eth_call
 * on an independent Sepolia RPC at the pinned block. Costs ~2 registry reads.
 */
import { encodeFunctionData, parseAbi } from 'viem';
import { CHAIN, PushChain } from '../../../src';
import { makePushEoaClient, pushKey, retryTruth, sepoliaTruth, SLOW_PATH } from '../_shared';

const READ = PushChain.CONSTANTS.READ;
const QUOTER_V2 = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3' as const;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const;
const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' as const;
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
]);
const MULTICALL_ABI = parseAbi(['function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)']);
const TOTAL_SUPPLY = encodeFunctionData({ abi: parseAbi(['function totalSupply() view returns (uint256)']), functionName: 'totalSupply' });
const QUOTE = { tokenIn: WETH, tokenOut: USDC, amountIn: 10n ** 15n, fee: 3000, sqrtPriceLimitX96: 0n } as const;

const d = pushKey ? describe : describe.skip;

d('read state › EVM nonpayable and payable functions read via eth_call simulation', () => {
  it('returns the simulated result at the pinned block for both mutabilities', async () => {
    const { client } = await makePushEoaClient(pushKey!);
    const common = { chain: CHAIN.ETHEREUM_SEPOLIA, expiryBlocks: SLOW_PATH.expiryBlocks } as const;
    const quote = await client.universal.prepareRead(QUOTER_V2, { ...common, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [QUOTE] });
    const aggregate = await client.universal.prepareRead(MULTICALL3, { ...common, abi: MULTICALL_ABI, functionName: 'aggregate', args: [[{ target: USDC, callData: TOTAL_SUPPLY }]] });

    const batch = await client.universal.executeReads([quote, aggregate], { waitForCompletion: false });
    const [q, m] = await batch.wait(SLOW_PATH.wait);

    for (const r of [q, m]) {
      expect(r.status).toBe(READ.STATUS.FULFILLED);
      expect(r.raw?.status).toBe(READ.RESULT_STATUS.SUCCESS);
      expect(r.callbackDelivered).toBe(true);
      expect(r.decodeError).toBeUndefined();
      expect(r.outcome).toBe(READ.OUTCOME.SUCCESS);
    }

    const sepolia = sepoliaTruth();
    const quoteTruth = await retryTruth(() => sepolia.simulateContract({ address: QUOTER_V2, abi: QUOTER_ABI, functionName: 'quoteExactInputSingle', args: [QUOTE], blockNumber: quote.spec.blockNumber }));
    expect(q.value).toEqual(quoteTruth.result);
    expect((q.value as readonly bigint[])[0]).toBeGreaterThan(0n);

    const [blockNumber, returnData] = m.value as readonly [bigint, readonly `0x${string}`[]];
    expect(blockNumber).toBe(aggregate.spec.blockNumber); // simulated exactly at the pin
    const supplyTruth = await retryTruth(() => sepolia.call({ to: USDC, data: TOTAL_SUPPLY, blockNumber: aggregate.spec.blockNumber }));
    expect(returnData[0]).toBe(supplyTruth.data);
  }, SLOW_PATH.jestTimeoutMs);
});
