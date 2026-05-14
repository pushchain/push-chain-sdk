/**
 * Cascade-side dogfood for the SVM finalize gas-budget bump.
 *
 * Single-route side (executeUoaToCeaSvm) is verified via live e2e and the
 * focused svm-rent unit spec; this spec covers cascade wiring.
 *
 * Cascade side (composeCascade → buildHopDescriptor) is harder to dogfood
 * with live e2e because the only available SPL mint (USDT_SOL) already has
 * an existing CEA ATA on the test signer. So this spec mocks Solana's
 * `getAccountInfo` to return null and exercises the SVM branch of
 * `buildHopDescriptor` end-to-end. We assert:
 *
 *   1. The bump fires after the initial quote when gasFee is below the
 *      gateway finalize minimum.
 *   2. Native-SOL hops receive the base finalize-budget bump but do not query
 *      CEA ATA state.
 */
import { CHAIN } from '../../constants/enums';
import { TransactionRoute } from '../route-detector';
import { buildHopDescriptor } from '../internals/cascade';
import {
  CEA_ATA_RENT_LAMPORTS_BUMP,
  SVM_EXECUTED_SUB_TX_RENT_FALLBACK,
  SVM_SIGNATURE_FEE_LAMPORTS,
  SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS,
  SVM_TOKEN_ACCOUNT_RENT_FALLBACK,
  gasLimitForSvmGasFeeBudget,
} from '../internals/svm-rent';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import type { OrchestratorContext } from '../internals/context';
import type { UniversalExecuteParams } from '../orchestrator.types';
import * as web3 from '@solana/web3.js';
import * as gasCalculator from '../internals/gas-calculator';

const UEA = '0x4A701114F991bf75685584c8156Db983c0DF95a0' as const;
const TEST_SOL_TARGET =
  '0x6a44bb5ea802a001386a5b39708523e1a3e1bafc8164ffcb94d1f5afa4849c69' as `0x${string}`;

function makeCtx(): OrchestratorContext {
  return {
    rpcUrls: { [CHAIN.SOLANA_DEVNET]: ['https://test.solana/'] },
    printTraces: false,
    progressHook: () => undefined,
    pushClient: {} as never,
    universalSigner: { account: { chain: 'PUSH_TESTNET_DONUT' as never } } as never,
    pushNetwork: 'TESTNET_DONUT' as never,
    accountStatusCache: null,
  } as unknown as OrchestratorContext;
}

describe('cascade buildHopDescriptor — SVM CEA-ATA rent bump wire-in', () => {
  let queryGasSpy: jest.SpyInstance;
  let getAccountInfoSpy: jest.SpyInstance;

  beforeEach(() => {
    // Stub queryOutboundGasFee — first call mimics the live under-sized SVM
    // default quote, second call returns gasFee = gasLimit * gasPrice.
    queryGasSpy = jest
      .spyOn(gasCalculator, 'queryOutboundGasFee')
      .mockImplementation(async (_ctx, _token, gasLimit: bigint) => ({
        gasFee: gasLimit === BigInt(0) ? BigInt(960_000) : gasLimit * BigInt(1_000),
        protocolFee: BigInt(0),
        gasToken: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed' as `0x${string}`,
        gasPrice: BigInt(1000),
        gasLimitUsed: gasLimit === BigInt(0) ? BigInt(960) : gasLimit,
        nativeValueForGas: BigInt(0),
        universalCoreAddress:
          '0x0000000000000000000000000000000000000001' as `0x${string}`,
        sizing: undefined,
      } as unknown as Awaited<ReturnType<typeof gasCalculator.queryOutboundGasFee>>));

    jest
      .spyOn(web3.Connection.prototype, 'getMinimumBalanceForRentExemption')
      .mockImplementation(async (span: number) =>
        span === 8
          ? Number(SVM_EXECUTED_SUB_TX_RENT_FALLBACK)
          : Number(SVM_TOKEN_ACCOUNT_RENT_FALLBACK)
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-queries with CEA ATA finalize budget for cascade SPL hop when ATA missing', async () => {
    getAccountInfoSpy = jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue(null); // ATA does not exist

    const params: UniversalExecuteParams = {
      to: { address: TEST_SOL_TARGET, chain: CHAIN.SOLANA_DEVNET },
      funds: {
        amount: BigInt(100_000),
        token: MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT,
      },
    };

    const hop = await buildHopDescriptor(
      makeCtx(),
      params,
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    expect(getAccountInfoSpy).toHaveBeenCalledTimes(1);
    expect(queryGasSpy).toHaveBeenCalledTimes(2);
    const [, , firstGasLimit] = queryGasSpy.mock.calls[0];
    const [, , bumpedGasLimit] = queryGasSpy.mock.calls[1];
    expect(firstGasLimit).toBe(BigInt(0));
    expect(bumpedGasLimit).toBe(
      gasLimitForSvmGasFeeBudget(CEA_ATA_RENT_LAMPORTS_BUMP, BigInt(1000))
    );
    expect(hop.route).toBe('UOA_TO_CEA');
    expect(hop.gasLimit).toBe(BigInt(3_091));
  });

  it('bumps native-SOL hop to the base finalize budget without ATA query', async () => {
    getAccountInfoSpy = jest.spyOn(web3.Connection.prototype, 'getAccountInfo');

    const params: UniversalExecuteParams = {
      to: { address: TEST_SOL_TARGET, chain: CHAIN.SOLANA_DEVNET },
      value: BigInt(1_000_000), // 0.001 SOL — native SOL withdraw
    };

    await buildHopDescriptor(
      makeCtx(),
      params,
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    // Native SOL outbound has no splMintBase58, so no ATA lookup is needed.
    expect(getAccountInfoSpy).not.toHaveBeenCalled();
    expect(queryGasSpy).toHaveBeenCalledTimes(2);
    const [, , firstGasLimit] = queryGasSpy.mock.calls[0];
    const [, , bumpedGasLimit] = queryGasSpy.mock.calls[1];
    const baseBudget =
      SVM_SIGNATURE_FEE_LAMPORTS +
      SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
      SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;
    expect(firstGasLimit).toBe(BigInt(0));
    expect(bumpedGasLimit).toBe(
      gasLimitForSvmGasFeeBudget(baseBudget, BigInt(1000))
    );
  });

  it('uses only the base finalize budget when ATA already exists', async () => {
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue({
        executable: false,
        owner: new web3.PublicKey(
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
        ),
        lamports: 2_039_280,
        data: Buffer.alloc(165),
        rentEpoch: 0,
      } as unknown as web3.AccountInfo<Buffer>);

    const params: UniversalExecuteParams = {
      to: { address: TEST_SOL_TARGET, chain: CHAIN.SOLANA_DEVNET },
      funds: {
        amount: BigInt(100_000),
        token: MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT,
      },
    };

    await buildHopDescriptor(
      makeCtx(),
      params,
      TransactionRoute.UOA_TO_CEA,
      UEA
    );

    expect(queryGasSpy).toHaveBeenCalledTimes(2);
    const [, , bumpedGasLimit] = queryGasSpy.mock.calls[1];
    const baseBudget =
      SVM_SIGNATURE_FEE_LAMPORTS +
      SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
      SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS;
    expect(bumpedGasLimit).toBe(
      gasLimitForSvmGasFeeBudget(baseBudget, BigInt(1000))
    );
  });
});
