/** Real v4 execution/receipts; only origin mapping and Cosmos indexing are fixtures. */
import { getAddress, parseAbi, type Address, type Hex } from 'viem';
import { CHAIN, type PushChain } from '../src';
import * as account from '../src/lib/universal/account/account';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import type { OrchestratorContext } from '../src/lib/orchestrator/internals/context';
import { detectRouteFromUniversalTxData } from '../src/lib/orchestrator/internals/tx-transformer';
import { UniversalTxStatus } from '../src/lib/generated/uexecutor/v1/types';
import {
  OutboundStatus,
  UniversalTxV2Codec,
  OutboundTxV2Codec,
} from '../src/lib/generated/uexecutor/v2/types';
import type { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import { startHarness, type Harness } from './harness';

const DEST = getAddress('0x0000000000000000000000000000000000001234');
const CEA = getAddress('0x000000000000000000000000000000000000cea1');
const EXTERNAL_HASH = `0x${'ef'.repeat(32)}` as Hex;
const CORE = parseAbi([
  'function setGasToken(string,address)',
  'function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)',
]);
const runtime = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;
const context = (c: PushChain) =>
  (c as unknown as { orchestrator: { ctx: OrchestratorContext } }).orchestrator
    .ctx;

describe('AGW replay with delayed Cosmos indexing', () => {
  let h: Harness, token: Address;
  beforeAll(async () => {
    h = await startHarness(18553);
    token = await h.deploy(0, 'HarnessPRC20', 'HarnessFixtures.sol', [
      CHAIN.ETHEREUM_SEPOLIA,
      18,
    ]);
    await h.write(0, h.addresses.universalCore, CORE, 'setGasToken', [
      CHAIN.ETHEREUM_SEPOLIA,
      token,
    ]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => h?.stop());

  function configure(c: PushChain) {
    runtime(c).resolvePrc20 = () => token;
    runtime(c).resolveCEA = async () => ({ cea: CEA, isDeployed: false });
    runtime(c).quoteOutbound = async (asset, limit) => {
      const [, nativeValueForGas, protocolFee, , , gasLimitUsed] =
        await h.publicClient.readContract({
          address: h.addresses.universalCore,
          abi: CORE,
          functionName: 'getOutboundTxGasAndFees',
          args: [asset, limit],
        });
      return { nativeValueForGas, protocolFee, gasLimitUsed };
    };
  }

  it.each([
    ['owner', 'success'],
    ['agent', 'success'],
    ['owner', 'failed'],
    ['agent', 'failed'],
    ['owner', 'timeout'],
    ['agent', 'timeout'],
  ] as const)(
    '%s door: real Push receipt then delayed external %s',
    async (door, outcome) => {
      // No UEA factory is present locally. Preserve real EVM RPC and contract
      // verification, while isolating the unrelated UEA origin lookup.
      jest
        .spyOn(account, 'convertExecutorToOrigin')
        .mockResolvedValue({ account: null, exists: false });
      const owner = await h.client(0);
      configure(owner);
      const created = await owner.agentic.create('delayed-index', {
        rules: [
          {
            agent: h.wallets[1].account!.address,
            chainNamespace: CHAIN.ETHEREUM_SEPOLIA,
            assets: [],
            maxGasPerCall: BigInt(10) ** BigInt(16),
            validUntil: Math.floor(Date.now() / 1000) + 3600,
            allowedCalls: [{ target: DEST, selector: 'increment()' }],
          },
        ],
      });
      const wallet = created.wallet;
      await h.publicClient.waitForTransactionReceipt({
        hash: await h.wallets[4].sendTransaction({
          to: wallet,
          value: BigInt(10) ** BigInt(18),
          account: h.wallets[4].account!,
          chain: h.wallets[4].chain,
        }),
      });
      const sender = await h.client(door === 'owner' ? 0 : 1, {
        agenticWallet: wallet,
      });
      configure(sender);
      const sent = await sender.universal.sendTransaction({
        to: { address: DEST, chain: CHAIN.ETHEREUM_SEPOLIA },
        data: [{ to: DEST, value: BigInt(0), data: '0xd09de08a' }],
      });
      const root = await h.publicClient.waitForTransactionReceipt({
        hash: sent.hash as Hex,
      });
      expect(root.status).toBe('success');
      expect(getAddress(root.from)).toBe(
        h.wallets[door === 'owner' ? 0 : 1].account!.address
      );

      const init: ProgressEvent[] = [],
        perCall: ProgressEvent[] = [];
      const tracker = await h.client(0, {
        progressHook: (e) => init.push(e as ProgressEvent),
      });
      const ctx = context(tracker);
      const partial = UniversalTxV2Codec.fromPartial({
        id: 'delayed-record',
        universalStatus: UniversalTxStatus.PC_EXECUTED_SUCCESS,
        pcTx: [
          {
            txHash: sent.hash,
            status: 'SUCCESS',
            sender: wallet,
            gasUsed: 0,
            blockHeight: Number(root.blockNumber),
            errorMsg: '',
          },
        ],
      });
      expect(detectRouteFromUniversalTxData(partial)).toBe('UOA_TO_PUSH');
      let waiting = false,
        polls = 0;
      const lookup = jest
        .spyOn(ctx.pushClient, 'getUniversalTxByIdV2')
        .mockImplementation(async () => {
          if (!waiting) return { universalTx: partial };
          polls++;
          // Missing record, then root-only record, then the destination observation.
          if (polls === 1) return { universalTx: undefined };
          if (polls === 2 || outcome === 'timeout')
            return { universalTx: partial };
          return {
            universalTx: UniversalTxV2Codec.fromPartial({
              ...partial,
              universalStatus: UniversalTxStatus.OUTBOUND_PENDING,
              outboundTx: [
                OutboundTxV2Codec.fromPartial({
                  destinationChain: CHAIN.ETHEREUM_SEPOLIA,
                  sender: wallet,
                  recipient: CEA,
                  amount: '0',
                  prc20AssetAddr: token,
                  externalAssetAddr: token,
                  outboundStatus:
                    outcome === 'success'
                      ? OutboundStatus.OBSERVED
                      : OutboundStatus.REVERTED,
                  observedTx: {
                    txHash: EXTERNAL_HASH,
                    success: outcome === 'success',
                    errorMsg:
                      outcome === 'failed' ? 'fixture destination revert' : '',
                    blockHeight: 1,
                    gasFeeUsed: '',
                    pc20WrapperAddress: '',
                  },
                }),
              ],
            }),
          };
        });
      const cosmos = jest
        .spyOn(ctx.pushClient, 'getCosmosTx')
        .mockResolvedValue({
          events: [],
          height: Number(root.blockNumber),
          txIndex: 0,
          code: 0,
          transactionHash: sent.hash,
          msgResponses: [],
          gasWanted: BigInt(0),
          gasUsed: BigInt(0),
        });
      const signerNonces = await Promise.all(
        h.wallets
          .slice(0, 2)
          .map((signer) =>
            h.publicClient.getTransactionCount({
              address: signer.account!.address,
              blockTag: 'pending',
            })
          )
      );
      const replay = await tracker.universal.trackTransaction(sent.hash, {
        progressHook: (e) => perCall.push(e),
      });
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(polls).toBe(0);
      expect(replay).toMatchObject({
        from: wallet,
        origin: sent.origin,
        to: DEST,
        data: '0xd09de08a',
        route: 'UOA_TO_CEA',
        chain: CHAIN.ETHEREUM_SEPOLIA,
      });
      expect(replay.agentic).toMatchObject({ wallet, door });
      waiting = true;
      const receipt = await replay.wait({
        outboundInitialWaitMs: 0,
        outboundPollingIntervalMs: 1,
        outboundTimeoutMs: outcome === 'timeout' ? 100 : 1000,
      });
      expect(receipt).toMatchObject({
        status: 1,
        from: wallet,
        externalStatus: outcome,
      });
      expect(cosmos).toHaveBeenCalledTimes(1);
      expect(polls).toBeGreaterThanOrEqual(outcome === 'timeout' ? 1 : 3);
      if (outcome !== 'timeout')
        expect(receipt.externalTxHash).toBe(EXTERNAL_HASH);
      else expect(receipt.externalTxHash).toBeUndefined();
      const terminal =
        outcome === 'success'
          ? 'SEND-TX-299-01'
          : outcome === 'failed'
          ? 'SEND-TX-299-02'
          : 'SEND-TX-299-03';
      for (const events of [init, perCall]) {
        expect(events.filter((event) => event.id === terminal)).toHaveLength(1);
      }
      expect(perCall.map((e) => e.id)).toEqual(init.map((e) => e.id));
      // wait reuses the mined root; it does not sign or send a replacement.
      expect(
        await Promise.all(
          h.wallets
            .slice(0, 2)
            .map((signer) =>
              h.publicClient.getTransactionCount({
                address: signer.account!.address,
                blockTag: 'pending',
              })
            )
        )
      ).toEqual(signerNonces);
      expect(
        (await h.publicClient.getTransaction({ hash: sent.hash as Hex })).input
      ).toBe(sent.agentic!.rawData);
    }
  );
});
