/**
 * waitForLockerFeeConfirmation must not treat a reverted EVM fee-lock as a
 * confirmed one.
 *
 * The EVM and SVM branches of the same switch disagreed: the SVM branch threw
 * on `status.err`, the EVM branch returned the receipt regardless. A reverted
 * fee-lock therefore resolved, fired SEND-TX-105-02 (the terminal "fee
 * confirmed" hook), and then spent the full 15-attempt cosmos retry budget in
 * `queryUniversalTxStatusFromGatewayTx` querying for a universalTx that can
 * never exist, so the caller saw a timeout rather than the revert.
 */
import { CHAIN, VM } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';

const SEPOLIA = CHAIN.ETHEREUM_SEPOLIA as unknown as string;

const getTransactionReceipt = jest.fn();
const getBlockNumber = jest.fn();

// The EVM branch resolves its client through `getOriginEvmClient(ctx)` off
// the context module, not through `new EvmClient(...)` (that is the SVM
// branch's shape), so this is the seam to mock.
jest.mock('../internals/context', () => ({
  getOriginEvmClient: jest.fn(),
}));

let confirmationModule: typeof import('../internals/confirmation');
let chainMod: { CHAIN_INFO: Record<string, Record<string, unknown>> };


function makeCtx(): OrchestratorContext {
  return {
    pushClient: {} as any,
    universalSigner: {
      account: {
        chain: SEPOLIA,
        address: '0x1111111111111111111111111111111111111111',
      },
    } as any,
    pushNetwork: 'TESTNET_DONUT' as any,
    rpcUrls: {},
    printTraces: false,
    accountStatusCache: null,
    progressHook: jest.fn(),
  };
}

describe('waitForLockerFeeConfirmation — EVM receipt status', () => {
  let savedFast: unknown;

  beforeEach(() => {
    jest.resetModules();
    getTransactionReceipt.mockReset();
    getBlockNumber.mockReset().mockResolvedValue(BigInt(901));

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    chainMod = require('../../constants/chain');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    confirmationModule = require('../internals/confirmation');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getOriginEvmClient } = require('../internals/context');
    getOriginEvmClient.mockReturnValue({
      publicClient: { getTransactionReceipt, getBlockNumber },
    });

    // fastConfirmations: 2 so the EVM branch clears its `<= 1` early return
    // and reaches the depth loop. Every shipped EVM chain configures 0, which
    // is the common case, so the revert case is asserted separately below at
    // the real value too.
    savedFast = chainMod.CHAIN_INFO[SEPOLIA]['fastConfirmations'];
    chainMod.CHAIN_INFO[SEPOLIA]['fastConfirmations'] = 2;
    chainMod.CHAIN_INFO[SEPOLIA]['vm'] = VM.EVM;
  });

  afterEach(() => {
    chainMod.CHAIN_INFO[SEPOLIA]['fastConfirmations'] = savedFast;
  });

  it('throws when the fee-lock tx reverted on chain', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: BigInt(900),
      logs: [],
    });

    await expect(
      confirmationModule.waitForLockerFeeConfirmation(
        makeCtx(),
        new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
      )
    ).rejects.toThrow(/reverted/i);
  });

  it('throws without waiting out the confirmation depth', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: BigInt(900),
      logs: [],
    });

    await expect(
      confirmationModule.waitForLockerFeeConfirmation(
        makeCtx(),
        new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
      )
    ).rejects.toThrow();

    // The depth poll is a wasted round-trip against a tx that already failed.
    expect(getBlockNumber).not.toHaveBeenCalled();
  });

  it('throws on the shipped fastConfirmations=0 config', async () => {
    // What every EVM chain in CHAIN_INFO actually configures today.
    chainMod.CHAIN_INFO[SEPOLIA]['fastConfirmations'] = 0;
    getTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: BigInt(900),
      logs: [],
    });

    await expect(
      confirmationModule.waitForLockerFeeConfirmation(
        makeCtx(),
        new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
      )
    ).rejects.toThrow(/reverted/i);
  });

  it('resolves on a successful receipt (control)', async () => {
    getTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: BigInt(900),
      logs: [],
    });
    getBlockNumber.mockResolvedValue(BigInt(902));

    await expect(
      confirmationModule.waitForLockerFeeConfirmation(
        makeCtx(),
        new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd])
      )
    ).resolves.toBeUndefined();
    expect(getBlockNumber).toHaveBeenCalled();
  });
});
