/* eslint-disable @typescript-eslint/no-non-null-assertion */
import '@e2e/shared/setup';
/**
 * Route 1 (UOA → Push Chain) — progress-hook parity test.
 *
 * Three streams tested per scenario:
 *   1. Live sendTransaction() client-level hook — the full sub-path sequence
 *      (101 → … → 199-01) fired from execute-phase event buffer.
 *   2. `tx.progressHook(cb)` replay on the original response — mirrors live
 *      because the setter replays the execute-phase event buffer verbatim.
 *   3. `trackTransaction()` per-call progressHook — runs on a *different*
 *      response built from Push Chain tx lookup and has no access to the
 *      original live stream. R1 doesn't register a UniversalTx on Push Chain,
 *      so reconstruction emits only the safe backbone (101, 102-01/02,
 *      103-01/02 for external origins, 107, 199-01/02).
 *
 * Live == tx.progressHook must be strict-equal to the full spec sequence.
 * trackTransaction replay is a subset — assert it matches the reconstruction
 * backbone (proves the backbone is present and in order).
 */
import { createWalletClient, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../../src';
import { CHAIN, PUSH_NETWORK } from '../../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../../src/lib/constants/chain';
import type { ProgressEvent } from '../../../src/lib/progress-hook/progress-hook.types';
import {
  PUSH_CHAIN_DEF,
  fundSepoliaUoa,
  fundUeaPC,
  makeSepoliaContext,
  makePushContext,
} from '../../docs-examples/_helpers/docs-fund';
import {
  COUNTER_ADDRESS_PAYABLE,
  COUNTER_ABI_PAYABLE,
} from '@e2e/shared/inbound-helpers';

const R1_PUSH_ORIGIN_EXPECTED = [
  'SEND-TX-101',
  'SEND-TX-102-01',
  'SEND-TX-102-02',
  'SEND-TX-107',
  'SEND-TX-199-01',
];

// Push-origin reconstruction matches live verbatim (no external UEA resolution).
const R1_PUSH_ORIGIN_RECONSTRUCTED = R1_PUSH_ORIGIN_EXPECTED;

const R1_FUNDS_BRIDGE_EXPECTED = [
  'SEND-TX-101',
  'SEND-TX-102-01',
  'SEND-TX-102-02',
  'SEND-TX-103-01',
  'SEND-TX-103-02',
  'SEND-TX-106-01',
  'SEND-TX-106-02',
  'SEND-TX-106-03',
  'SEND-TX-106-03-02',
  'SEND-TX-106-04',
  'SEND-TX-106-05',
  'SEND-TX-106-06',
  'SEND-TX-107',
  'SEND-TX-199-01',
];

// External-origin reconstruction emits the safe R1 backbone only — sub-path
// hooks (104-xx / 105-xx / 106-xx) aren't surfaced because R1 has no UTX
// on Push Chain from which to infer the sub-path.
const R1_EXTERNAL_ORIGIN_RECONSTRUCTED = [
  'SEND-TX-101',
  'SEND-TX-102-01',
  'SEND-TX-102-02',
  'SEND-TX-103-01',
  'SEND-TX-103-02',
  'SEND-TX-107',
  'SEND-TX-199-01',
];

// Fresh (undeployed) Sepolia UOA sending a payload-only tx (no funds, no
// value) forces the fee-lock signature branch in executeStandardPayload.
const R1_FEE_LOCK_EXPECTED = [
  'SEND-TX-101',
  'SEND-TX-102-01',
  'SEND-TX-102-02',
  'SEND-TX-103-01',
  'SEND-TX-103-02',
  'SEND-TX-104-01',
  'SEND-TX-105-01',
  'SEND-TX-105-02',
  'SEND-TX-107',
  'SEND-TX-199-01',
];

const evmKey = process.env['EVM_PRIVATE_KEY'] as Hex | undefined;
const pushKey = process.env['PUSH_PRIVATE_KEY'] as Hex | undefined;

describe('Route 1 progress-hook parity (live vs tx.progressHook vs trackTransaction replay)', () => {
  (pushKey ? it : it.skip)(
    'A. Push UOA signature path — three streams match spec',
    async () => {
      const pushCtx = makePushContext(pushKey as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: PUSH_CHAIN_DEF,
        transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
      });
      await fundUeaPC(pushCtx, account.address, '1');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      const tx = await client.universal.sendTransaction({
        to: '0x35B84d6848D16415177c64D64504663b998A6ab4',
        value: BigInt(100),
      });

      // Register tx.progressHook(cb) AFTER send to capture buffer replay.
      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      // --- trackTransaction replay ---
      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.PUSH_TESTNET_DONUT,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);
      console.log(`[A] Live:    ${liveIds.join(' → ')}`);
      console.log(`[A] Replay:  ${replayIds.join(' → ')}`);
      console.log(`[A] Hook:    ${hookIds.join(' → ')}`);

      expect(liveIds).toEqual(R1_PUSH_ORIGIN_EXPECTED);
      expect(hookIds).toEqual(R1_PUSH_ORIGIN_EXPECTED);
      expect(replayIds).toEqual(R1_PUSH_ORIGIN_RECONSTRUCTED);
    },
    180_000
  );

  (evmKey ? it : it.skip)(
    'B. Sepolia UOA funds-bridge path — three streams match spec',
    async () => {
      const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      const tx = await client.universal.sendTransaction({
        to: client.universal.account,
        funds: {
          amount: BigInt(1),
          token: PushChain.CONSTANTS.MOVEABLE.TOKEN.ETHEREUM_SEPOLIA.ETH,
        },
      });

      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);
      console.log(`[B] Live:    ${liveIds.join(' → ')}`);
      console.log(`[B] Replay:  ${replayIds.join(' → ')}`);
      console.log(`[B] Hook:    ${hookIds.join(' → ')}`);

      expect(liveIds).toEqual(R1_FUNDS_BRIDGE_EXPECTED);
      expect(hookIds).toEqual(R1_FUNDS_BRIDGE_EXPECTED);
      expect(replayIds).toEqual(R1_EXTERNAL_ORIGIN_RECONSTRUCTED);
    },
    300_000
  );

  (evmKey ? it : it.skip)(
    'C. Sepolia UOA fee-lock signature path — three streams match spec',
    async () => {
      const sepoliaCtx = makeSepoliaContext(evmKey as Hex);
      const account = privateKeyToAccount(generatePrivateKey());
      const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC[0]),
      });
      // Fund the UOA with ETH for fee-lock deposit (undeployed UEA → fee-lock path).
      await fundSepoliaUoa(sepoliaCtx, account.address, '0.005');

      const signer = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });

      const liveEvents: ProgressEvent[] = [];
      const client = await PushChain.initialize(signer, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => liveEvents.push(e),
      });

      // Payload-only tx: data + no funds + no value → forces fee-lock path
      // (UEA undeployed, needs gas funding on Push Chain).
      const incrementData = PushChain.utils.helpers.encodeTxData({
        abi: [...COUNTER_ABI_PAYABLE],
        functionName: 'increment',
      });
      const tx = await client.universal.sendTransaction({
        to: COUNTER_ADDRESS_PAYABLE,
        data: incrementData,
      });

      const hookEvents: ProgressEvent[] = [];
      tx.progressHook((e) => hookEvents.push(e));

      await tx.wait();

      const trackReplay: ProgressEvent[] = [];
      const trackClient: ProgressEvent[] = [];
      const trackSigner = await PushChain.utils.signer.toUniversalFromKeypair(walletClient, {
        chain: CHAIN.ETHEREUM_SEPOLIA,
        library: PushChain.CONSTANTS.LIBRARY.ETHEREUM_VIEM,
      });
      const trackClientInstance = await PushChain.initialize(trackSigner, {
        network: PUSH_NETWORK.TESTNET_DONUT,
        progressHook: (e) => trackClient.push(e),
      });
      const tracked = await trackClientInstance.universal.trackTransaction(tx.hash, {
        waitForCompletion: true,
        progressHook: (e) => trackReplay.push(e),
      });
      await tracked.wait();

      const liveIds = liveEvents.map((e) => e.id);
      const hookIds = hookEvents.map((e) => e.id);
      const replayIds = trackReplay.map((e) => e.id);
      console.log(`[C] Live:    ${liveIds.join(' → ')}`);
      console.log(`[C] Replay:  ${replayIds.join(' → ')}`);
      console.log(`[C] Hook:    ${hookIds.join(' → ')}`);

      expect(liveIds).toEqual(R1_FEE_LOCK_EXPECTED);
      expect(hookIds).toEqual(R1_FEE_LOCK_EXPECTED);
      expect(replayIds).toEqual(R1_EXTERNAL_ORIGIN_RECONSTRUCTED);
    },
    420_000
  );
});
