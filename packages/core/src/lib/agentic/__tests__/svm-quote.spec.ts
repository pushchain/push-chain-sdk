import {
  decodeFunctionResult,
  encodeAbiParameters,
  type Abi,
  type Hex,
} from 'viem';
import { preparePublicSvmRule } from '../management/svm-public';
import { resolveSvmAssets } from '../management/svm-context';
import { readSvmSourceToken } from '../contracts/prc20-metadata';
import { PublicKey } from '@solana/web3.js';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../constants/tokens';
import { getPRC20Address } from '../../universal/prc20-address';
import { CHAIN } from '../../constants/enums';
import { Snapshot } from '../reads/snapshot';
import { quoteSvmRequest } from '../execution/svm-quote';
import { ADDR, FakeChain } from './fake-chain';
import { mockRuntime } from './mock-runtime';
const mint = '0x' + '33'.repeat(32);
function fixture(chain = CHAIN.SOLANA_DEVNET) {
  const fake = new FakeChain();
  fake.readContract = async ({ functionName }) =>
    functionName === 'gasTokenPRC20ByChainNamespace'
      ? ADDR.other
      : functionName === 'SOURCE_CHAIN_NAMESPACE'
      ? chain
      : mint;
  const quoteOutbound = jest.fn().mockResolvedValue({
    protocolFee: BigInt(1),
    nativeValueForGas: BigInt(10),
    gasLimitUsed: BigInt(100),
  });
  return {
    snap: new Snapshot(fake, BigInt(1)),
    rt: mockRuntime(fake, { quoteOutbound }),
    quoteOutbound,
  };
}
describe('AGW Solana finalization quote context', () => {
  it('uses the wallet identity and actual source mint for SPL rent budgeting', async () => {
    const f = fixture();
    await quoteSvmRequest(
      f.rt,
      f.snap,
      ADDR.owner,
      ADDR.target,
      CHAIN.SOLANA_DEVNET,
      BigInt(0),
      BigInt(5)
    );
    expect(f.quoteOutbound).toHaveBeenCalledWith(
      ADDR.target,
      BigInt(0),
      CHAIN.SOLANA_DEVNET,
      {
        wallet: ADDR.owner,
        splMintBase58: new PublicKey(
          Buffer.from(mint.slice(2), 'hex')
        ).toBase58(),
        burnAmount: BigInt(5),
      }
    );
  });
  it('native transfers carry no SPL mint or ATA requirement', async () => {
    const f = fixture();
    const q = await quoteSvmRequest(
      f.rt,
      f.snap,
      ADDR.owner,
      ADDR.other,
      CHAIN.SOLANA_DEVNET,
      BigInt(0),
      BigInt(5)
    );
    expect(q.isNative).toBe(true);
    expect(f.quoteOutbound.mock.calls[0][3].splMintBase58).toBeUndefined();
  });
  it('zero-burn instruction quotes do not add a transfer ATA requirement', async () => {
    const f = fixture();
    await quoteSvmRequest(
      f.rt,
      f.snap,
      ADDR.owner,
      ADDR.target,
      CHAIN.SOLANA_DEVNET,
      BigInt(0),
      BigInt(0)
    );
    expect(f.quoteOutbound.mock.calls[0][3].splMintBase58).toBeUndefined();
  });
  it('an asset from another chain fails route validation without a quote', async () => {
    const f = fixture(CHAIN.ETHEREUM_SEPOLIA);
    await expect(
      quoteSvmRequest(
        f.rt,
        f.snap,
        ADDR.owner,
        ADDR.target,
        CHAIN.SOLANA_DEVNET,
        BigInt(0),
        BigInt(5)
      )
    ).rejects.toMatchObject({ code: 'ASSET_CHAIN_MISMATCH' });
    expect(f.quoteOutbound).not.toHaveBeenCalled();
  });
  it('decodes the real precompile word when a Solidity string ABI cannot decode it', async () => {
    const f = fixture();
    const read = f.snap.reader.readContract;
    const outputTypes: string[] = [];
    f.snap.reader.readContract = async (args) => {
      if (args.functionName !== 'SOURCE_TOKEN_ADDRESS') return read(args);
      const fn = (args.abi as Abi).find(
        (entry) => entry.type === 'function' && entry.name === args.functionName
      );
      if (fn?.type !== 'function') throw new Error('missing metadata ABI');
      outputTypes.push(fn.outputs[0].type);
      return decodeFunctionResult({
        abi: args.abi as Abi,
        functionName: args.functionName,
        data: encodeAbiParameters([{ type: 'bytes32' }], [mint as Hex]),
      });
    };
    await quoteSvmRequest(
      f.rt,
      f.snap,
      ADDR.owner,
      ADDR.target,
      CHAIN.SOLANA_DEVNET,
      BigInt(0),
      BigInt(5)
    );
    expect(outputTypes).toEqual(['string', 'bytes32']);
    const expected = new PublicKey(
      Buffer.from(mint.slice(2), 'hex')
    ).toBase58();
    expect(f.quoteOutbound.mock.calls[0][3].splMintBase58).toBe(expected);
    const metadata = {
      gateway: jest.fn(),
      mint: jest.fn().mockResolvedValue({
        mint: expected,
        tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      }),
    };
    const assets = await resolveSvmAssets(
      f.snap,
      CHAIN.SOLANA_DEVNET,
      [{ token: ADDR.target, maxPerCall: BigInt(5), maxTotal: BigInt(5) }],
      metadata
    );
    expect(assets[0]).toMatchObject({ kind: 'spl', mint: expected });
    expect(metadata.mint).toHaveBeenCalledWith(CHAIN.SOLANA_DEVNET, mint);
  });

  it('does not fabricate a mint when both metadata representations fail', async () => {
    const f = fixture();
    f.snap.reader.readContract = async () => {
      throw new Error('RPC unavailable');
    };
    await expect(
      readSvmSourceToken(f.snap, ADDR.target, CHAIN.SOLANA_DEVNET)
    ).rejects.toMatchObject({
      code: 'RULE_READ_FAILED',
      cause: { message: 'RPC unavailable' },
    });
    expect(f.quoteOutbound).not.toHaveBeenCalled();
  });
  it('uses the current registered SPL mint when Donut metadata returns a zero word', async () => {
    const f = fixture();
    const asset = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;
    const token = getPRC20Address({
      chain: CHAIN.SOLANA_DEVNET,
      address: asset.address,
    }).address;
    const read = f.snap.reader.readContract;
    f.snap.reader.readContract = async (args) => {
      if (args.functionName !== 'SOURCE_TOKEN_ADDRESS') return read(args);
      return decodeFunctionResult({
        abi: args.abi as Abi,
        functionName: args.functionName,
        data: encodeAbiParameters(
          [{ type: 'bytes32' }],
          [`0x${'00'.repeat(32)}`]
        ),
      });
    };
    await quoteSvmRequest(
      f.rt,
      f.snap,
      ADDR.owner,
      token,
      CHAIN.SOLANA_DEVNET,
      BigInt(0),
      BigInt(1000)
    );
    expect(f.quoteOutbound.mock.calls[0][3].splMintBase58).toBe(asset.address);
    await expect(
      readSvmSourceToken(f.snap, ADDR.target, CHAIN.SOLANA_DEVNET)
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
  });
  it('canonicalizes a decoded SPL mint before resolving its PRC20 mapping', async () => {
    const f = fixture();
    const expected = new PublicKey(
      Buffer.from(mint.slice(2), 'hex')
    ).toBase58();
    const program = `0x${'44'.repeat(32)}` as Hex;
    const rt = {
      ...f.rt,
      resolvePrc20: jest.fn().mockReturnValue(ADDR.target),
      svmMetadata: {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_DEVNET,
          program: `0x${'22'.repeat(32)}`,
        }),
        mint: async () => ({
          mint: expected,
          tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        }),
      },
    };
    await preparePublicSvmRule(rt, f.snap, ADDR.owner, {
      agent: ADDR.agent,
      chainNamespace: CHAIN.SOLANA_DEVNET,
      assets: [{ token: mint, maxPerCall: BigInt(5), maxTotal: BigInt(5) }],
      validUntil: f.rt.nowSeconds() + 3600,
      maxGasPerCall: BigInt(10),
      allowedInstructions: [
        {
          program,
          accounts: [{ name: 'authority', expected: { kind: 'walletCEA' } }],
          instruction: {
            name: 'ping',
            idl: {
              address: new PublicKey(
                Buffer.from(program.slice(2), 'hex')
              ).toBase58(),
              metadata: { name: 'fixture', version: '1', spec: '0.1.0' },
              instructions: [
                {
                  name: 'ping',
                  discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
                  accounts: [{ name: 'authority', signer: true }],
                  args: [],
                },
              ],
            },
          },
        },
      ],
    });
    expect(rt.resolvePrc20).toHaveBeenCalledWith(expected, CHAIN.SOLANA_DEVNET);
  });
});
