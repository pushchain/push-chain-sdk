/** Exact default preset output -> real AGW/URP -> exact public readback.
 * The gas PRC20 and gateway are local stand-ins. This proves SDK preservation,
 * not live route availability or delivery.
 */
import { getAddress, parseAbi, zeroAddress } from 'viem';
import { startHarness, type Harness } from './harness';
import { PushChain } from '../src';
import type { AgenticRuntime } from '../src/lib/agentic/runtime';
import * as accountLookup from '../src/lib/universal/account/account';
import { configId } from '../src/lib/agentic/codec/ids';
import {
  PRESET_ACCEPTANCE_CASES,
  expectStoredPreset,
} from '../__e2e__/shared/agw-preset-acceptance';
const CORE = parseAbi([
  'function setGasToken(string,address)',
  'function setSourceTokenAddress(string)',
]);
const CEA = getAddress('0x000000000000000000000000000000000000cea1');
const runtime = (c: PushChain) =>
  (c as unknown as { agenticRuntime: AgenticRuntime }).agenticRuntime;

describe('unchanged default preset contract acceptance', () => {
  let h: Harness, owner: PushChain, lookup: jest.SpyInstance;
  const gasTokens = new Set<string>();
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
    runtime(owner).resolvePrc20 = () => {
      throw new Error('Presets must not resolve a non-native route');
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
      // Presets send only native ETH, which resolves to the chain's gas PRC20.
      for (const asset of generated.rules[0].assets!) {
        const source = getAddress(
          typeof asset.token === 'string' ? asset.token : asset.token.address
        );
        expect(source).toBe(zeroAddress);
        if (!gasTokens.has(chainNamespace)) {
          const mapped = await h.deploy(
            0,
            'HarnessPRC20',
            'HarnessFixtures.sol',
            [chainNamespace, 18]
          );
          // Live gas PRC20s report an empty or zero source token.
          await h.write(0, mapped, CORE, 'setSourceTokenAddress', ['']);
          await h.write(0, h.addresses.universalCore, CORE, 'setGasToken', [
            chainNamespace,
            mapped,
          ]);
          gasTokens.add(chainNamespace);
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
