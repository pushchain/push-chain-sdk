/**
 * Unit test for the EVM confirmation countdown in
 * `waitForEvmConfirmationsWithCountdown` (internals/confirmation.ts).
 *
 * Before the fix: the intermediate progress count was computed as
 * `confirmations - remaining + 1` and the loop returned as soon as that
 * count reached `confirmations`, one block BEFORE the authoritative
 * `currentBlock >= targetBlock` gate at the top of the loop. With
 * `confirmations: 1` (every chain in CHAIN_INFO) the derived count hits 1
 * on the very first poll, so the wait returned without ever observing the
 * target block, and the terminal hook fired with a block still outstanding.
 *
 * After the fix: the poll loop is governed solely by the block gate, so it
 * waits until `currentBlock >= receipt.blockNumber + confirmations`.
 */
import {
  waitForEvmConfirmationsWithCountdown,
} from '../internals/confirmation';
import type { OrchestratorContext } from '../internals/context';

describe('waitForEvmConfirmationsWithCountdown', () => {
  function makeStubCtx(): OrchestratorContext {
    return {
      printTraces: false,
      pushNetwork: 'TESTNET_DONUT',
    } as unknown as OrchestratorContext;
  }

  /**
   * An EvmClient whose chain head advances by one block per poll, starting at
   * the block the receipt was mined in. `getBlockNumber` is called once per
   * poll iteration, so `maxBlocks` bounds the loop the same way a real chain
   * bounds it.
   */
  function makeAdvancingClient(receiptBlock: bigint, maxBlocks = 8) {
    const seenBlocks: bigint[] = [];
    let head = receiptBlock;
    return {
      seenBlocks,
      client: {
        publicClient: {
          getTransactionReceipt: jest
            .fn()
            .mockResolvedValue({ blockNumber: receiptBlock }),
          getBlockNumber: jest.fn().mockImplementation(async () => {
            // Return the current head, then advance. This models the real
            // case the wait exists for: the receipt was just mined and the
            // chain has not produced the next block yet.
            const observed = head;
            seenBlocks.push(observed);
            if (head < receiptBlock + BigInt(maxBlocks)) head += BigInt(1);
            return observed;
          }),
        },
      } as any,
    };
  }

  it('waits until the target block, not one block short (confirmations = 1)', async () => {
    const ctx = makeStubCtx();
    const receiptBlock = BigInt(1000);
    const { client, seenBlocks } = makeAdvancingClient(receiptBlock);

    await waitForEvmConfirmationsWithCountdown(
      ctx,
      client,
      '0xabc' as `0x${string}`,
      1,
      60_000
    );

    // The loop must observe the head reaching the gate, i.e. at least one
    // poll at block >= receiptBlock + 1. Returning at receiptBlock itself is
    // the off-by-one: the tx had zero confirmations at that point.
    const finalHead = seenBlocks[seenBlocks.length - 1];
    expect(finalHead).toBeGreaterThanOrEqual(receiptBlock + BigInt(1));
  });

  it('waits the full confirmation depth (confirmations = 3)', async () => {
    const ctx = makeStubCtx();
    const receiptBlock = BigInt(500);
    const { client, seenBlocks } = makeAdvancingClient(receiptBlock);

    await waitForEvmConfirmationsWithCountdown(
      ctx,
      client,
      '0xdef' as `0x${string}`,
      3,
      60_000
    );

    const finalHead = seenBlocks[seenBlocks.length - 1];
    expect(finalHead).toBeGreaterThanOrEqual(receiptBlock + BigInt(3));
  });

  it('control: confirmations = 0 returns immediately without polling', async () => {
    const ctx = makeStubCtx();
    const { client, seenBlocks } = makeAdvancingClient(BigInt(10));

    await waitForEvmConfirmationsWithCountdown(
      ctx,
      client,
      '0x123' as `0x${string}`,
      0,
      60_000
    );

    expect(seenBlocks).toHaveLength(0);
  });
});
