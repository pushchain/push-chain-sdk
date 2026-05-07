/**
 * Cascade-side dogfood for the conditional CEA-ATA rent bump.
 *
 * Single-route side (executeUoaToCeaSvm) is verified via live e2e — the SPL
 * outbound logs `maybeBumpForCeaAtaRent — CEA ATA … already deployed` from
 * the route-handlers path.
 *
 * Cascade side (composeCascade → buildHopDescriptor) is harder to dogfood
 * with live e2e because the only available SPL mint (USDT_SOL) already has
 * an existing CEA ATA on the test signer. So this spec mocks Solana's
 * `getAccountInfo` to return null and exercises the SVM branch of
 * `buildHopDescriptor` end-to-end. We assert:
 *
 *   1. The bump fires (gas query receives the bumped gasLimit, not the raw)
 *   2. Native-SOL hops do NOT trigger the bump branch
 */
import { CHAIN } from '../../constants/enums';
import { TransactionRoute } from '../route-detector';
import { buildHopDescriptor } from '../internals/cascade';
import {
  CEA_ATA_RENT_LAMPORTS_BUMP,
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
    // Stub queryOutboundGasFee — we only care that buildHopDescriptor
    // calls it with the (possibly bumped) gasLimit.
    queryGasSpy = jest
      .spyOn(gasCalculator, 'queryOutboundGasFee')
      .mockResolvedValue({
        gasFee: BigInt(123),
        protocolFee: BigInt(0),
        gasToken: '0x5D525Df2bD99a6e7ec58b76aF2fd95F39874EBed' as `0x${string}`,
        gasPrice: BigInt(1000),
        nativeValueForGas: BigInt(0),
        universalCoreAddress:
          '0x0000000000000000000000000000000000000001' as `0x${string}`,
        sizing: undefined,
      } as unknown as Awaited<ReturnType<typeof gasCalculator.queryOutboundGasFee>>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bumps gasLimit by CEA_ATA_RENT_LAMPORTS_BUMP for cascade SPL hop when ATA missing', async () => {
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
    expect(queryGasSpy).toHaveBeenCalledTimes(1);
    // The 3rd positional arg of queryOutboundGasFee is gasLimit. With user
    // gasLimit unset (defaults to 0), the bumped value passed in must equal
    // CEA_ATA_RENT_LAMPORTS_BUMP exactly.
    const [, , passedGasLimit] = queryGasSpy.mock.calls[0];
    expect(passedGasLimit).toBe(CEA_ATA_RENT_LAMPORTS_BUMP);
    expect(hop.route).toBe('UOA_TO_CEA');
  });

  it('does NOT bump gasLimit for cascade native-SOL hop (no SPL mint, no ATA query)', async () => {
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

    // Native SOL outbound has no splMintBase58 → helper returns immediately
    // without any RPC call.
    expect(getAccountInfoSpy).not.toHaveBeenCalled();
    expect(queryGasSpy).toHaveBeenCalledTimes(1);
    const [, , passedGasLimit] = queryGasSpy.mock.calls[0];
    expect(passedGasLimit).toBe(BigInt(0)); // raw, no bump
  });

  it('does NOT bump when ATA already exists (cascade hot-path)', async () => {
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

    const [, , passedGasLimit] = queryGasSpy.mock.calls[0];
    expect(passedGasLimit).toBe(BigInt(0)); // raw, no bump (ATA already exists)
  });
});
