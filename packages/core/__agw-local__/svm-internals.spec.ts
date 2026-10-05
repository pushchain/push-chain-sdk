/** Actual v4 SVM URP checks on Anvil. No Solana execution/TSS is simulated. */
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { CHAIN } from '../src/lib/constants/enums';
import { buildSession, encodeEnvelope } from '../src/lib/agentic/codec/session';
import { configId } from '../src/lib/agentic/codec/ids';
import {
  encodeSvmTerms,
  SvmDataPinMode,
  UINT64_MAX,
  type SvmTermsWire,
} from '../src/lib/agentic/codec/svm-terms';
import { deriveAgwSvmValueAccounts } from '../src/lib/agentic/codec/svm-accounts';
import { encodeAgwSvmPayload } from '../src/lib/agentic/execution/svm-payload';
import { composeAgwSvmAction } from '../src/lib/agentic/execution/svm-outbound';
import { v4, type SvmConfigRead } from '../src/lib/agentic/contracts/v4';
import { startHarness, type Harness } from './harness';

const key = (b: string) => `0x${b.repeat(32)}` as Hex;
const GATEWAY_PROGRAM = key('22'),
  PROGRAM = key('33'),
  MINT = key('44');
const TOKEN = parseAbi([
  'function mint(address,uint256)',
  'function approve(address,uint256) returns (bool)',
]);
const UINT256_MAX = BigInt(2) ** BigInt(256) - BigInt(1);

describe('internal SVM codec/payloads against actual v4 contracts', () => {
  let h: Harness, token: Address;
  beforeAll(async () => {
    h = await startHarness(18552);
    token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.SOLANA_DEVNET,
      9,
    ]);
  });
  afterAll(async () => {
    await h?.stop();
  });
  async function setup(
    options: { dataless?: boolean; maxAccounts?: number } = {}
  ) {
    const owner = await h.client(0),
      created = await owner.agentic.create('svm-internal', { rules: [] });
    const wallet = created.wallet;
    const derived = deriveAgwSvmValueAccounts(wallet, GATEWAY_PROGRAM, [
      { mint: MINT },
    ]);
    const t: SvmTermsWire = {
      ...derived,
      validUntil: Math.floor(Date.now() / 1000) + 3600,
      assets: [{ token, maxPerCall: UINT256_MAX, maxTotal: UINT256_MAX }],
      maxGasPerCall: BigInt(10) ** BigInt(16),
      programs: [
        {
          program: PROGRAM,
          discriminator: '0x0100000000000000',
          discriminatorLen: options.dataless ? 0 : 1,
          dataless: options.dataless ?? false,
          maxAccounts: options.maxAccounts ?? 0,
        },
      ],
      pins: [
        { ruleIndex: 0, accountIndex: 0, expected: derived.expectedCEA },
        { ruleIndex: 0, accountIndex: 1, expected: derived.ceaAccounts[1] },
      ],
      dataPins: options.dataless
        ? []
        : [
            {
              ruleIndex: 0,
              fromEnd: true,
              offset: 4,
              offsetB: 2,
              len: 2,
              mode: SvmDataPinMode.RATIO_GTE_LE,
              expected: key('00'),
              num: BigInt(9),
              den: BigInt(10),
            },
          ],
    };
    const session = buildSession({
      validator: h.addresses.validator,
      rulesPolicy: h.addresses.rulesPolicy,
      agent: h.wallets[1].account!.address,
      actions: [
        {
          target: h.addresses.gateway,
          selector: '0x77b86bec',
          initData: encodeEnvelope(CHAIN.SOLANA_DEVNET, encodeSvmTerms(t, 0)),
        },
      ],
    });
    await h.write(0, wallet, v4.abis.wallet, 'grantRules', [session]);
    const [id] = await h.publicClient.readContract({
      address: h.addresses.engine,
      abi: v4.abis.engine,
      functionName: 'getPermissionIDs',
      args: [wallet],
    });
    const [action] = await h.publicClient.readContract({
      address: h.addresses.engine,
      abi: v4.abis.engine,
      functionName: 'getEnabledActions',
      args: [wallet, id],
    });
    const cid = configId(wallet, id, action);
    const cfg = (await h.publicClient.readContract({
      address: h.addresses.rulesPolicy,
      abi: v4.abis.policy,
      functionName: 'getSvmConfig',
      args: [cid, wallet],
    })) as SvmConfigRead;
    await h.publicClient.waitForTransactionReceipt({
      hash: await h.wallets[4].sendTransaction({
        to: wallet,
        value: BigInt(10) ** BigInt(18),
        account: h.wallets[4].account!,
        chain: h.wallets[4].chain,
      }),
    });
    await h.write(0, token, TOKEN, 'mint', [wallet, BigInt(100)]);
    await h.write(0, wallet, v4.abis.wallet, 'execute', [
      key('00'),
      v4.packSingle({
        target: token,
        value: BigInt(0),
        data: encodeFunctionData({
          abi: TOKEN,
          functionName: 'approve',
          args: [h.addresses.gateway, BigInt(100)],
        }),
      }),
    ]);
    const accounts = [
      { pubkey: t.expectedCEA, isWritable: true },
      { pubkey: t.ceaAccounts[1], isWritable: true },
    ];
    const payload = encodeAgwSvmPayload(
      PROGRAM,
      accounts,
      options.dataless ? new Uint8Array() : new Uint8Array([1, 90, 0, 100, 0])
    );
    const input = {
      wallet,
      gateway: h.addresses.gateway,
      token,
      amount: BigInt(5),
      recipient: PROGRAM,
      payload,
      gasLimit: BigInt(200_000),
      protocolFee: BigInt(10) ** BigInt(14),
      maxPCForGas: BigInt(10) ** BigInt(15),
    };
    const call = composeAgwSvmAction(input, cfg, 0);
    const simulate = (p: Hex, recipient = PROGRAM, amount = BigInt(5)) => {
      const data = encodeFunctionData({
        abi: parseAbi([
          'function sendUniversalTxOutbound((bytes recipient,address token,uint256 amount,uint256 gasLimit,uint256 gasPrice,uint256 maxPCForGas,bytes payload,address revertRecipient) req) payable',
        ]),
        functionName: 'sendUniversalTxOutbound',
        args: [
          {
            recipient,
            token,
            amount,
            gasLimit: BigInt(200_000),
            gasPrice: BigInt(0),
            maxPCForGas: input.maxPCForGas,
            payload: p,
            revertRecipient: wallet,
          },
        ],
      });
      return h.publicClient.simulateContract({
        address: wallet,
        abi: v4.abis.wallet,
        functionName: 'executeAsAgent',
        args: [
          id,
          key('00'),
          v4.packSingle({
            target: h.addresses.gateway,
            value: call.value,
            data,
          }),
        ],
        account: h.wallets[1].account!.address,
      });
    };
    async function reject(
      p: Hex,
      name: string,
      recipient = PROGRAM,
      amount = BigInt(5)
    ) {
      try {
        await simulate(p, recipient, amount);
        throw new Error('Expected policy rejection');
      } catch (error) {
        const { decodeAgenticRevert } = await import(
          '../src/lib/agentic/revert'
        );
        expect(decodeAgenticRevert(error)?.name).toBe(
          `PolicyCheckReverted(${name})`
        );
      }
    }
    return {
      wallet,
      id,
      cid,
      t,
      cfg,
      accounts,
      payload,
      call,
      simulate,
      reject,
    };
  }
  it('grants SDK-encoded SVM terms and preserves every field/account', async () => {
    const { cfg, t } = await setup();
    expect(cfg).toMatchObject({
      initialized: true,
      expectedCEA: t.expectedCEA,
      gatewayProgram: t.gatewayProgram,
      ceaAccounts: t.ceaAccounts,
      programs: t.programs,
      pins: t.pins,
      dataPins: t.dataPins,
      assets: [
        {
          token,
          maxPerCall: UINT256_MAX,
          maxTotal: UINT256_MAX,
          spent: BigInt(0),
        },
      ],
    });
  });
  it('the internal composed call passes actual S1–S18 and meters its token', async () => {
    const { wallet, id, cid, call } = await setup();
    await h.write(1, wallet, v4.abis.wallet, 'executeAsAgent', [
      id,
      key('00'),
      v4.packSingle(call),
    ]);
    const cfg = await h.publicClient.readContract({
      address: h.addresses.rulesPolicy,
      abi: v4.abis.policy,
      functionName: 'getSvmConfig',
      args: [cid, wallet],
    });
    expect(cfg.assets[0].spent).toBe(BigInt(5));
  });
  it('account substitution and CEA aliasing are rejected by URP', async () => {
    const s = await setup();
    await s.reject(
      encodeAgwSvmPayload(
        PROGRAM,
        [{ ...s.accounts[0], pubkey: key('77') }, s.accounts[1]],
        new Uint8Array([1, 90, 0, 100, 0])
      ),
      'SvmAccountPinMismatch'
    );
    await s.reject(
      encodeAgwSvmPayload(
        PROGRAM,
        [...s.accounts, s.accounts[0]],
        new Uint8Array([1, 90, 0, 100, 0])
      ),
      'CeaAccountAtUnpinnedIndex'
    );
  });
  it('relative price floor and recipient/program identity are enforced on-chain', async () => {
    const s = await setup();
    await s.reject(
      encodeAgwSvmPayload(
        PROGRAM,
        s.accounts,
        new Uint8Array([1, 89, 0, 100, 0])
      ),
      'SvmDataRatioNotMet'
    );
    await s.reject(s.payload, 'RecipientTargetMismatch', key('66'));
  });
  it('trailing bytes, non-execute IDs and u64 overflow are rejected', async () => {
    const s = await setup();
    await s.reject(`${s.payload}00`, 'MalformedSvmPayload');
    const bytes = Buffer.from(s.payload.slice(2), 'hex');
    bytes[bytes.length - 33] = 1;
    await s.reject(`0x${bytes.toString('hex')}`, 'SvmInstructionNotExecute');
    await s.reject(
      s.payload,
      'AmountExceedsU64',
      PROGRAM,
      UINT64_MAX + BigInt(1)
    );
  });
  it('dataless rules accept only empty instruction data', async () => {
    const s = await setup({ dataless: true });
    await expect(s.simulate(s.payload)).resolves.toBeDefined();
    await s.reject(
      encodeAgwSvmPayload(PROGRAM, s.accounts, new Uint8Array([1])),
      'ProgramNotAllowed'
    );
  });
  it('fixed account counts reject appended accounts and failed calls do not change spend', async () => {
    const s = await setup({ maxAccounts: 2 });
    await s.reject(
      encodeAgwSvmPayload(
        PROGRAM,
        [...s.accounts, { pubkey: key('55'), isWritable: false }],
        new Uint8Array([1, 90, 0, 100, 0])
      ),
      'SvmAccountCountMismatch'
    );
    const cfg = await h.publicClient.readContract({
      address: h.addresses.rulesPolicy,
      abi: v4.abis.policy,
      functionName: 'getSvmConfig',
      args: [s.cid, s.wallet],
    });
    expect(cfg.assets[0].spent).toBe(BigInt(0));
  });
});
