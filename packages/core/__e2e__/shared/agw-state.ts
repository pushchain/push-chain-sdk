/** Independent contract-state assertions for AGW tests; never part of the public SDK. */
import type { Address, Hex, PublicClient } from 'viem';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { configId } from '../../src/lib/agentic/codec/ids';

export async function readNativeCounters(
  client: PublicClient,
  addresses: { sessionEngine: Address; rulesPolicy: Address },
  wallet: Address,
  rulesId: Hex
) {
  const actions = await client.readContract({
    address: addresses.sessionEngine,
    abi: v5.abis.engine,
    functionName: 'getEnabledActions',
    args: [wallet, rulesId],
  });
  if (actions.length !== 1)
    throw new Error('Native counter fixture expects one action');
  const cfg = await client.readContract({
    address: addresses.rulesPolicy,
    abi: v5.abis.policy,
    functionName: 'getNativeConfig',
    args: [configId(wallet, rulesId, actions[0]), wallet],
  });
  return {
    valueSpent: cfg.valueSpent,
    amountSpent: cfg.amountSpent,
    callsUsed: Number(cfg.callsUsed),
  };
}

/** All native action terms/counters in engine order, pinned to one block. */
export async function readNativeActionConfigs(
  client: PublicClient,
  addresses: { sessionEngine: Address; rulesPolicy: Address },
  wallet: Address,
  rulesId: Hex,
  blockNumber?: bigint
) {
  const block = blockNumber ?? (await client.getBlockNumber({ cacheTime: 0 }));
  const actions = await client.readContract({
    address: addresses.sessionEngine,
    abi: v5.abis.engine,
    functionName: 'getEnabledActions',
    args: [wallet, rulesId],
    blockNumber: block,
  });
  if (!actions.length) throw new Error('Native fixture has no enabled action');
  return Promise.all(
    actions.map(async (action) => ({
      actionId: action,
      config: await client.readContract({
        address: addresses.rulesPolicy,
        abi: v5.abis.policy,
        functionName: 'getNativeConfig',
        args: [configId(wallet, rulesId, action), wallet],
        blockNumber: block,
      }),
    }))
  );
}
