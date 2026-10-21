/** Exact default preset output -> real AGW/URP -> exact public readback.
 * Source-token PRC20 metadata and gateway are local stand-ins. This proves SDK
 * preservation with provisioned routes, not live route availability or delivery.
 */
import { getAddress, parseAbi, type Address } from 'viem';
import { startHarness, type Harness } from './harness';
import { PushChain } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import * as accountLookup from '../src/lib/universal/account/account';
import { configId } from '../src/lib/agentic/codec/ids';
import {
  PRESET_ACCEPTANCE_CASES,
  expectStoredPreset,
} from '../__e2e__/shared/agw-preset-acceptance';
const sourceABI = parseAbi(['function setSourceTokenAddress(string)']);
const CEA = getAddress('0x000000000000000000000000000000000000cea1');
const runtime = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;

describe('unchanged default preset contract acceptance', () => {
  let h: Harness, owner: PushChain, lookup: jest.SpyInstance;
  const routes = new Map<string, Address>();
  beforeAll(async () => {
    lookup = jest
      .spyOn(accountLookup, 'convertExecutorToOrigin')
      .mockResolvedValue({ account: null, exists: false });
    h = await startHarness(18555);
    owner = await h.client(0);
    runtime(owner).resolveCEA = async () => ({
      cea: CEA,
      isDeployed: false,
    });
    runtime(owner).resolvePrc20 = (token, chain) => {
      const source = typeof token === 'string' ? token : token?.address;
      const mapped = routes.get(`${chain}:${source?.toLowerCase()}`);
      if (!mapped) throw new Error('Fixture route not provisioned');
      return mapped;
    };
  });
  afterAll(async () => {
    try {
      await h?.stop();
    } finally {
      lookup?.mockRestore();
    }
  });
  it.each(PRESET_ACCEPTANCE_CASES)(
    '%s %s preserves every generated asset, cap, function and pin',
    async (category, chainNamespace) => {
      const generated = PushChain.utils.agentic.presets.get(category, {
        chainNamespace,
        agent: h.wallets[1].account!.address,
      });
      const before = JSON.stringify(generated.rules, (_k, v) =>
        typeof v === 'bigint' ? String(v) : v
      );
      for (const asset of generated.rules[0].assets!) {
        const source = getAddress(
          typeof asset.token === 'string' ? asset.token : asset.token.address
        );
        const key = `${chainNamespace}:${source.toLowerCase()}`;
        if (!routes.has(key)) {
          const mapped = await h.deploy(
            0,
            'HarnessPRC20',
            'HarnessFixtures.sol',
            [chainNamespace, 18]
          );
          await h.write(0, mapped, sourceABI, 'setSourceTokenAddress', [
            source,
          ]);
          routes.set(key, mapped);
        }
      }
      const made = await owner.agentic.create('preset-exact', {
        rules: generated.rules,
      });
      const records = await owner.agentic.wallet(made.wallet).rules.list();
      expect(records.rules).toHaveLength(1);
      const record = await owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      expectStoredPreset(generated.rules[0], record);
      // Readback maps pins to agentic:wallet; check the stored destination itself.
      const [action] = await h.publicClient.readContract({
        address: h.addresses.engine,
        abi: h.generation.contracts.abis.engine,
        functionName: 'getEnabledActions',
        args: [made.wallet, made.rulesIds[0]],
      });
      const config = await h.publicClient.readContract({
        address: h.addresses.rulesPolicy,
        abi: h.generation.contracts.abis.policy,
        functionName: 'getConfig',
        args: [configId(made.wallet, made.rulesIds[0], action), made.wallet],
      });
      expect(config.expectedCEA).toBe(CEA);
      expect(
        JSON.stringify(generated.rules, (_k, v) =>
          typeof v === 'bigint' ? String(v) : v
        )
      ).toBe(before);
    }
  );
});
