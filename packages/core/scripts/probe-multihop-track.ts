/**
 * trackTransaction replay on the 3-leg cascade initial Push Chain tx.
 * Dumps the full progress-hook sequence emitted during replay + wait so we
 * can compare against the multichain spec (SEND-TX-001 / 002-xx / 999-xx).
 */
import { PushChain } from '../src/lib/push-chain/push-chain';
import { CHAIN, PUSH_NETWORK } from '../src/lib/constants/enums';
import type { ProgressEvent } from '../src/lib/progress-hook/progress-hook.types';
import type { UniversalAccount } from '../src/lib/universal/universal.types';

const HASH =
  '0x1eaa5e7a17063ff253ff1381079b4ec04c9c5fdb3f9114a9c4c5e3ac7c7992a2';

const readOnlyAcct: UniversalAccount = {
  chain: CHAIN.PUSH_TESTNET_DONUT,
  address: '0x0000000000000000000000000000000000000000',
};

async function main() {
  const clientLevel: ProgressEvent[] = [];
  const pc = await PushChain.initialize(readOnlyAcct, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    progressHook: (e) => clientLevel.push(e),
  });

  const perCall: ProgressEvent[] = [];
  const tracked = await pc.universal.trackTransaction(HASH, {
    waitForCompletion: true,
    progressHook: (e) => perCall.push(e),
  });

  console.log('\n--- tracked response ---');
  console.log('hash:', tracked.hash);
  console.log('route:', tracked.route);
  console.log('chain:', tracked.chain);
  console.log('hopCount:', (tracked as any).hopCount);

  // Dump the raw universalTxData so we can see outbound-leg count.
  const pushClient =
    (pc as any).orchestrator?.ctx?.pushClient ??
    (pc as any).pushClient ??
    (pc as any)._pushClient;
  if (pushClient?.getUniversalTxByIdV2) {
    try {
      // Try hash first, then the known extracted utxId from prior logs.
      const EXTRACTED_UTX = 'b56bc9789b8ae5c7b3e6dbc9dae770da8000bd7fb4c95600604b893454f3047d';
      let res = await pushClient.getUniversalTxByIdV2(HASH).catch(() => null);
      if (!res?.universalTx) {
        res = await pushClient.getUniversalTxByIdV2(EXTRACTED_UTX);
      }
      const utx = res?.universalTx;
      console.log('\n--- raw UniversalTxV2 ---');
      console.log('outboundTx length:', utx?.outboundTx?.length);
      if (utx?.outboundTx) {
        utx.outboundTx.forEach((ob: any, i: number) => {
          console.log(
            `  [${i}] dest=${ob.destinationChain}  recipient=${ob.recipient}  payloadSel=${(ob.payload || '').slice(0, 10)}  payloadLen=${(ob.payload || '').length}  status=${ob.outboundStatus}`
          );
        });
      }
      console.log('inboundTx present:', !!utx?.inboundTx);
      if (utx?.inboundTx) {
        const ib = utx.inboundTx;
        console.log('  inbound.txHash:', ib.txHash);
        console.log('  inbound.sourceChain:', ib.sourceChain);
        const d = ib.universalPayload?.data || '';
        console.log('  inbound.payload.data head:', d.slice(0, 20));
        console.log('  inbound.payload.data length:', d.length);
      }
      console.log('pcTx count:', utx?.pcTx?.length);
      console.log('universalStatus:', utx?.universalStatus);
    } catch (e) {
      console.log('getUniversalTxByIdV2 err:', (e as Error).message);
    }
  }

  // Tx already finalized on-chain, so replay should emit synchronously
  // during trackTransaction(). Skip wait/waitForAll entirely.

  const perCallIds = perCall.map((e) => e.id);
  const clientIds = clientLevel.map((e) => e.id);
  console.log(`\n--- per-call progressHook (${perCallIds.length}) ---`);
  console.log(perCallIds.join(' → '));
  console.log(`\n--- client-level progressHook (${clientIds.length}) ---`);
  console.log(clientIds.join(' → '));

  const multichainIds = [
    'SEND-TX-001',
    'SEND-TX-002-01',
    'SEND-TX-002-99-99',
    'SEND-TX-999-01',
    'SEND-TX-999-02',
    'SEND-TX-999-03',
  ];
  console.log('\n--- multichain hook presence ---');
  for (const id of multichainIds) {
    const inPerCall = perCallIds.filter((x) => x === id).length;
    const inClient = clientIds.filter((x) => x === id).length;
    console.log(`  ${id}: per-call=${inPerCall}  client=${inClient}`);
  }

  const init = perCall.find((e) => e.id === 'SEND-TX-001');
  const term = perCall.find((e) => e.id === 'SEND-TX-999-01');
  console.log('\n--- hopCount verification ---');
  console.log('SEND-TX-001 response:', init?.response);
  console.log('SEND-TX-999-01 response:', term?.response);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
