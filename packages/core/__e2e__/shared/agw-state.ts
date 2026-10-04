/** Independent contract-state assertions for AGW tests; never part of the public SDK. */
import type { Address, Hex, PublicClient } from 'viem';
import { e704d5b } from '../../src/lib/agentic/contracts/e704d5b';
import { configId } from '../../src/lib/agentic/codec/ids';

export async function readNativeCounters(
  client: PublicClient,
  addresses: { sessionEngine: Address; rulesPolicy: Address },
  wallet: Address,
  rulesId: Hex
) {
  const actions = await client.readContract({
    address: addresses.sessionEngine,
    abi: e704d5b.abis.engine,
    functionName: 'getEnabledActions',
    args: [wallet, rulesId],
  });
  if (actions.length !== 1)
    throw new Error('Native counter fixture expects one action');
  const cfg = await client.readContract({
    address: addresses.rulesPolicy,
    abi: e704d5b.abis.policy,
    functionName: 'getNativeConfig',
    args: [configId(wallet, rulesId, actions[0]), wallet],
  });
  return {
    valueSpent: cfg.valueSpent,
    amountSpent: cfg.amountSpent,
    callsUsed: Number(cfg.callsUsed),
  };
}
