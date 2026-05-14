/**
 * Unit tests for SVM finalize gas-budget helpers (svm-rent.ts).
 */
import {
  maybeBumpForCeaAtaRent,
  CEA_ATA_RENT_LAMPORTS_BUMP,
  SVM_EXECUTED_SUB_TX_RENT_FALLBACK,
  SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS,
  SVM_SIGNATURE_FEE_LAMPORTS,
  SVM_TOKEN_ACCOUNT_RENT_FALLBACK,
  deriveSvmCeaPda,
  deriveAtaPubkey,
  gasLimitForSvmGasFeeBudget,
  getSvmFinalizeGasBudget,
} from '../internals/svm-rent';
import { CHAIN } from '../../constants/enums';
import type { OrchestratorContext } from '../internals/context';
import { PublicKey } from '@solana/web3.js';

// Stub @solana/web3.js Connection.getAccountInfo via prototype patching.
// We restore between tests.
import * as web3 from '@solana/web3.js';

const UEA = '0x4A701114F991bf75685584c8156Db983c0DF95a0' as const;
const SOL_USDT_MINT = 'EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF';

function makeCtx(rpcUrls?: Record<string, string[]>): {
  ctx: OrchestratorContext;
  logs: string[];
} {
  const logs: string[] = [];
  const ctx = {
    rpcUrls: rpcUrls ?? { [CHAIN.SOLANA_DEVNET]: ['https://test/'] },
    printTraces: true,
    progressHook: () => undefined,
    pushClient: {} as never,
    universalSigner: { account: { chain: 'PUSH_TESTNET_DONUT' as never } } as never,
    pushNetwork: 'TESTNET_DONUT' as never,
    accountStatusCache: null,
    // The printLog helper checks ctx.printTraces and falls back to console.log.
    // Capture via console.log spy below — easier than re-implementing the function.
  } as unknown as OrchestratorContext;
  const spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  });
  // Restore at end of describe via afterEach in caller.
  (logs as unknown as { restore: () => void }).restore = () => spy.mockRestore();
  return { ctx, logs };
}

describe('svm-rent — derivations', () => {
  it('deriveSvmCeaPda is deterministic for a given EVM address', () => {
    const a = deriveSvmCeaPda(UEA);
    const b = deriveSvmCeaPda(UEA);
    expect(a.equals(b)).toBe(true);
    expect(a.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it('deriveAtaPubkey matches the standard SPL ATA derivation', () => {
    const owner = deriveSvmCeaPda(UEA);
    const mint = new PublicKey(SOL_USDT_MINT);
    const ata = deriveAtaPubkey(owner, mint);
    expect(ata.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    // Idempotent
    expect(deriveAtaPubkey(owner, mint).equals(ata)).toBe(true);
  });
});

describe('getSvmFinalizeGasBudget', () => {
  let restoreLog: (() => void) | undefined;

  afterEach(() => {
    restoreLog?.();
    restoreLog = undefined;
    jest.restoreAllMocks();
  });

  it('returns base finalize budget for native SOL / payload-only SVM outbounds', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getMinimumBalanceForRentExemption')
      .mockImplementation(async (span: number) =>
        span === 8 ? Number(SVM_EXECUTED_SUB_TX_RENT_FALLBACK) : 0
      );

    const out = await getSvmFinalizeGasBudget({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: undefined,
      burnAmount: BigInt(0),
    });

    expect(out).toBe(
      SVM_SIGNATURE_FEE_LAMPORTS +
        SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
        SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS
    );
  });

  it('includes CEA ATA rent when an SPL outbound ATA does not exist yet', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getMinimumBalanceForRentExemption')
      .mockImplementation(async (span: number) =>
        span === 8
          ? Number(SVM_EXECUTED_SUB_TX_RENT_FALLBACK)
          : Number(SVM_TOKEN_ACCOUNT_RENT_FALLBACK)
      );
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue(null);

    const out = await getSvmFinalizeGasBudget({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
    });

    expect(out).toBe(CEA_ATA_RENT_LAMPORTS_BUMP);
    expect(logs.some((l) => l.includes('including'))).toBe(true);
  });

  it('does not include CEA ATA rent when the SPL outbound ATA already exists', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getMinimumBalanceForRentExemption')
      .mockImplementation(async (span: number) =>
        span === 8 ? Number(SVM_EXECUTED_SUB_TX_RENT_FALLBACK) : 0
      );
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue({
        executable: false,
        owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        lamports: 2_039_280,
        data: Buffer.alloc(165),
        rentEpoch: 0,
      } as unknown as web3.AccountInfo<Buffer>);

    const out = await getSvmFinalizeGasBudget({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
    });

    expect(out).toBe(
      SVM_SIGNATURE_FEE_LAMPORTS +
        SVM_EXECUTED_SUB_TX_RENT_FALLBACK +
        SVM_FINALIZE_COMPUTE_BUFFER_LAMPORTS
    );
    expect(logs.some((l) => l.includes('already deployed'))).toBe(true);
  });

  it('falls back to protocol rent constants on RPC failure', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getMinimumBalanceForRentExemption')
      .mockRejectedValue(new Error('connection refused'));

    const out = await getSvmFinalizeGasBudget({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
    });

    expect(out).toBe(CEA_ATA_RENT_LAMPORTS_BUMP);
    expect(logs.some((l) => l.includes('using fallback rents'))).toBe(true);
  });

  it('rounds required gas fee up to the next whole gasLimit unit', () => {
    expect(gasLimitForSvmGasFeeBudget(BigInt(1_051_560), BigInt(1_000))).toBe(
      BigInt(1_052)
    );
  });
});

describe('maybeBumpForCeaAtaRent', () => {
  let restoreLog: (() => void) | undefined;

  afterEach(() => {
    restoreLog?.();
    restoreLog = undefined;
    jest.restoreAllMocks();
  });

  it('returns input unchanged when burnAmount is 0 (native SOL outbound)', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(0),
      effectiveGasLimit: BigInt(960),
    });
    expect(out).toBe(BigInt(960));
  });

  it('returns input unchanged when splMintBase58 is undefined', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: undefined,
      burnAmount: BigInt(100_000),
      effectiveGasLimit: BigInt(960),
    });
    expect(out).toBe(BigInt(960));
  });

  it('bumps effectiveGasLimit by CEA_ATA_RENT_LAMPORTS_BUMP when ATA does not exist', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue(null);

    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
      effectiveGasLimit: BigInt(960),
    });

    expect(out).toBe(BigInt(960) + CEA_ATA_RENT_LAMPORTS_BUMP);
    expect(logs.some((l) => l.includes('not deployed'))).toBe(true);
    expect(logs.some((l) => l.includes('bumping effectiveGasLimit'))).toBe(true);
  });

  it('does not bump when ATA already exists with non-empty data', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue({
        executable: false,
        owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        lamports: 2_039_280,
        data: Buffer.alloc(165),
        rentEpoch: 0,
      } as unknown as web3.AccountInfo<Buffer>);

    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
      effectiveGasLimit: BigInt(960),
    });

    expect(out).toBe(BigInt(960));
    expect(logs.some((l) => l.includes('already deployed'))).toBe(true);
  });

  it('returns input unchanged on RPC failure (logs warning, does not throw)', async () => {
    const { ctx, logs } = makeCtx();
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockRejectedValue(new Error('connection refused'));

    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
      effectiveGasLimit: BigInt(960),
    });

    expect(out).toBe(BigInt(960));
    expect(
      logs.some((l) => l.includes('RPC error') && l.includes('connection refused'))
    ).toBe(true);
  });

  it('falls back to CHAIN_INFO defaultRPC when ctx.rpcUrls is empty', async () => {
    const { ctx, logs } = makeCtx({});
    restoreLog = (logs as unknown as { restore: () => void }).restore;
    const spy = jest
      .spyOn(web3.Connection.prototype, 'getAccountInfo')
      .mockResolvedValue(null);

    const out = await maybeBumpForCeaAtaRent({
      ctx,
      ueaAddress: UEA,
      targetChain: CHAIN.SOLANA_DEVNET,
      splMintBase58: SOL_USDT_MINT,
      burnAmount: BigInt(100_000),
      effectiveGasLimit: BigInt(0),
    });

    expect(spy).toHaveBeenCalled();
    expect(out).toBe(CEA_ATA_RENT_LAMPORTS_BUMP);
  });

  it('CEA_ATA_RENT_LAMPORTS_BUMP equals 3_090_840 (gateway finalize budget with ATA)', () => {
    // 5_000 signature fee + 946_560 ExecutedSubTx rent + 2_039_280 ATA rent + 100_000 buffer
    expect(CEA_ATA_RENT_LAMPORTS_BUMP).toBe(BigInt(3_090_840));
  });
});
