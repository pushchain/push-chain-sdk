import { PublicKey } from '@solana/web3.js';
import { bytesToHex, type Hex } from 'viem';
import { CHAIN } from '../../constants/enums';
import { createSvmMetadataProvider } from '../management/svm-metadata';
import { resolveSvmContext } from '../management/svm-context';
import { Snapshot } from '../reads/snapshot';
import {
  registerIdl,
  clearRegistry,
} from '../../orchestrator/svm-idl/registry';
import { prepareAgwSvmInstruction } from '../execution/svm-instruction';
import {
  deriveAgwSvmValueAccounts,
  deriveAgwSvmAta,
} from '../codec/svm-accounts';
import { ADDR, FakeChain } from './fake-chain';
import type { SvmTermsWire } from '../codec/svm-terms';
const key = (b: string) => `0x${b.repeat(32)}` as Hex;
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const MINT = new PublicKey(Buffer.from(key('44').slice(2), 'hex'));
const PROGRAM = key('33'),
  GATEWAY = key('22');
const genesis = CHAIN.SOLANA_DEVNET.slice(7) + 'abcdefghijk';
function rpc(owner = SPL, length = 82) {
  const data = Buffer.alloc(length);
  data[45] = 1;
  if (length >= 166) data[165] = 1;
  return {
    getGenesisHash: jest.fn().mockResolvedValue(genesis),
    getAccountInfo: jest.fn().mockResolvedValue({
      owner: new PublicKey(owner),
      executable: false,
      data,
      lamports: 1,
      rentEpoch: 0,
    }),
  };
}
afterEach(clearRegistry);
describe('SVM metadata and resolved instruction backend', () => {
  it.each(['dataless', 'non-anchor', 'wrong-account'])(
    'validates explicit wire accounts for %s instructions',
    (kind) => {
      const derived = deriveAgwSvmValueAccounts(ADDR.owner, GATEWAY, []);
      const dataless = kind === 'dataless';
      const terms: SvmTermsWire = {
        ...derived,
        validUntil: 9999999999,
        assets: [
          { token: ADDR.target, maxPerCall: BigInt(1), maxTotal: BigInt(2) },
        ],
        maxGasPerCall: BigInt(10),
        programs: [
          {
            program: PROGRAM,
            discriminator: '0x0100000000000000',
            discriminatorLen: dataless ? 0 : 1,
            dataless,
            maxAccounts: 1,
          },
        ],
        pins: [
          { ruleIndex: 0, accountIndex: 0, expected: derived.expectedCEA },
        ],
        dataPins: [],
      };
      const build = () =>
        prepareAgwSvmInstruction(
          {
            wallet: ADDR.owner,
            chain: CHAIN.SOLANA_DEVNET,
            program: PROGRAM,
            instructionData: dataless ? new Uint8Array() : new Uint8Array([1]),
            accounts: [
              {
                pubkey:
                  kind === 'wrong-account' ? key('66') : derived.expectedCEA,
                isWritable: true,
              },
            ],
          },
          terms
        );
      if (kind === 'wrong-account')
        expect(build).toThrow('SvmAccountPinMismatch');
      else expect(build().recipient).toBe(PROGRAM);
    }
  );
  it.each([false, true])(
    'resolves output mint Token-2022 ownership, rejecting a wrong supplied program: %s',
    async (wrong) => {
      const fake = new FakeChain();
      fake.readContract = async ({ functionName }) =>
        functionName === 'gasTokenPRC20ByChainNamespace'
          ? ADDR.other
          : functionName === 'SOURCE_CHAIN_NAMESPACE'
          ? CHAIN.SOLANA_DEVNET
          : '';
      const mint = key('55');
      const metadata = {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_DEVNET,
          program: GATEWAY,
        }),
        mint: async () => ({ mint, tokenProgram: TOKEN2022 }),
      };
      const promise = resolveSvmContext(
        new Snapshot(fake, BigInt(1)),
        ADDR.owner,
        CHAIN.SOLANA_DEVNET,
        [{ token: ADDR.other, maxPerCall: BigInt(1), maxTotal: BigInt(2) }],
        metadata,
        [{ mint, ...(wrong ? { tokenProgram: SPL } : {}) }]
      );
      if (wrong)
        await expect(promise).rejects.toThrow(
          'output mint/token-program mismatch'
        );
      else {
        const ctx = await promise;
        expect(ctx.ceaAccounts).toEqual([
          ctx.expectedCEA,
          deriveAgwSvmAta(ctx.expectedCEA, { mint, tokenProgram: TOKEN2022 }),
        ]);
      }
    }
  );
  it.each([
    [SPL, 82],
    [TOKEN2022, 82],
    [TOKEN2022, 166],
  ])('reads initialized mint owner %s length %s', async (owner, length) => {
    const r = rpc(owner, length);
    const provider = createSvmMetadataProvider(
      {
        [CHAIN.SOLANA_DEVNET]: {
          gatewayProgram: GATEWAY,
          rpcUrls: ['http://fixture'],
        },
      },
      () => r
    );
    expect(
      await provider.mint(CHAIN.SOLANA_DEVNET, bytesToHex(MINT.toBytes()))
    ).toEqual({ mint: MINT.toBase58(), tokenProgram: owner });
    expect(await provider.gateway(CHAIN.SOLANA_DEVNET)).toEqual({
      chainNamespace: CHAIN.SOLANA_DEVNET,
      program: GATEWAY,
    });
  });
  it('rejects wrong cluster RPCs and falls back to the configured correct cluster', async () => {
    const wrong = rpc(),
      correct = rpc();
    wrong.getGenesisHash.mockResolvedValue('wrong-genesis');
    const provider = createSvmMetadataProvider(
      {
        [CHAIN.SOLANA_DEVNET]: {
          gatewayProgram: GATEWAY,
          rpcUrls: ['wrong', 'right'],
        },
      },
      (url) => (url === 'wrong' ? wrong : correct)
    );
    await provider.mint(CHAIN.SOLANA_DEVNET, bytesToHex(MINT.toBytes()));
    expect(wrong.getAccountInfo).not.toHaveBeenCalled();
    expect(correct.getAccountInfo).toHaveBeenCalledTimes(1);
  });
  it.each([
    'missing',
    'executable',
    'token-account',
    'uninitialized',
    'wrong-owner',
  ])('rejects %s as a mint', async (kind) => {
    const r = rpc(),
      info = await r.getAccountInfo();
    if (kind === 'missing') r.getAccountInfo.mockResolvedValue(null);
    else {
      if (kind === 'executable') info.executable = true;
      if (kind === 'token-account') info.data = Buffer.alloc(165);
      if (kind === 'uninitialized') info.data[45] = 0;
      if (kind === 'wrong-owner') info.owner = PublicKey.default;
      r.getAccountInfo.mockResolvedValue(info);
    }
    const p = createSvmMetadataProvider(
      {
        [CHAIN.SOLANA_DEVNET]: {
          gatewayProgram: GATEWAY,
          rpcUrls: ['fixture'],
        },
      },
      () => r
    );
    await expect(
      p.mint(CHAIN.SOLANA_DEVNET, bytesToHex(MINT.toBytes()))
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
  });
  it('requires a configured gateway/RPC, rather than choosing a devnet default', async () => {
    await expect(
      createSvmMetadataProvider({}).gateway(CHAIN.SOLANA_DEVNET)
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
  });
  it('pins all PRC20 reads and rejects a source-chain mismatch', async () => {
    const fake = new FakeChain();
    fake.readContract = jest.fn(async ({ functionName }) =>
      functionName === 'gasTokenPRC20ByChainNamespace'
        ? ADDR.other
        : CHAIN.ETHEREUM_SEPOLIA
    );
    const snap = new Snapshot(fake, BigInt(123));
    const metadata = {
      gateway: async () => ({
        chainNamespace: CHAIN.SOLANA_DEVNET,
        program: GATEWAY,
      }),
      mint: jest.fn(),
    };
    await expect(
      resolveSvmContext(
        snap,
        ADDR.owner,
        CHAIN.SOLANA_DEVNET,
        [{ token: ADDR.target, maxPerCall: BigInt(1), maxTotal: BigInt(2) }],
        metadata
      )
    ).rejects.toMatchObject({ code: 'ASSET_CHAIN_MISMATCH' });
    expect(
      (fake.readContract as jest.Mock).mock.calls.every(
        ([arg]) => arg.blockNumber === BigInt(123)
      )
    ).toBe(true);
  });
  it('rejects registry and mint substitution', async () => {
    const fake = new FakeChain();
    fake.readContract = async ({ functionName }) =>
      functionName === 'gasTokenPRC20ByChainNamespace'
        ? ADDR.other
        : functionName === 'SOURCE_CHAIN_NAMESPACE'
        ? CHAIN.SOLANA_DEVNET
        : MINT.toBase58();
    const snap = new Snapshot(fake, BigInt(1)),
      caps = [
        { token: ADDR.target, maxPerCall: BigInt(1), maxTotal: BigInt(2) },
      ];
    await expect(
      resolveSvmContext(snap, ADDR.owner, CHAIN.SOLANA_DEVNET, caps, {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_TESTNET,
          program: GATEWAY,
        }),
        mint: jest.fn(),
      })
    ).rejects.toThrow('cluster mismatch');
    await expect(
      resolveSvmContext(snap, ADDR.owner, CHAIN.SOLANA_DEVNET, caps, {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_DEVNET,
          program: GATEWAY,
        }),
        mint: async () => ({ mint: key('55'), tokenProgram: SPL }),
      })
    ).rejects.toThrow('different mint');
  });
  it('derives the wallet authority for IDL accounts, not the signer/default gateway authority', () => {
    const derived = deriveAgwSvmValueAccounts(ADDR.owner, GATEWAY, []);
    const program = new PublicKey(
      Buffer.from(PROGRAM.slice(2), 'hex')
    ).toBase58();
    registerIdl({
      address: program,
      metadata: { name: 'fixture', version: '1', spec: '0.1.0' },
      instructions: [
        {
          name: 'go',
          discriminator: [1, 2, 3, 4, 5, 6, 7, 8],
          accounts: [{ name: 'cea_authority', writable: true }],
          args: [],
        },
      ],
    });
    const t: SvmTermsWire = {
      ...derived,
      validUntil: 9999999999,
      assets: [
        { token: ADDR.target, maxPerCall: BigInt(1), maxTotal: BigInt(2) },
      ],
      maxGasPerCall: BigInt(10),
      programs: [
        {
          program: PROGRAM,
          discriminator: '0x0102030405060708',
          discriminatorLen: 8,
          dataless: false,
          maxAccounts: 1,
        },
      ],
      pins: [{ ruleIndex: 0, accountIndex: 0, expected: derived.expectedCEA }],
      dataPins: [],
    };
    const out = prepareAgwSvmInstruction(
      {
        wallet: ADDR.owner,
        chain: CHAIN.SOLANA_DEVNET,
        program,
        instructionData: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      },
      t
    );
    expect(out.accounts[0].pubkey).toBe(derived.expectedCEA);
    expect(() =>
      prepareAgwSvmInstruction(
        {
          wallet: ADDR.owner,
          chain: CHAIN.SOLANA_DEVNET,
          program,
          instructionData: new Uint8Array([9, 2, 3, 4, 5, 6, 7, 8]),
        },
        t
      )
    ).toThrow(/discriminator/);
  });
});
