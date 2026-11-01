/** Read-only Donut acceptance of built preset configuration and factory calldata.
 * Build core first. No keys, signing, funding, deployments or broadcasts.
 * Usage: node packages/core/scripts/check-agw-preset-routes.js /tmp/report.json
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createPublicClient, http, getAddress } = require('viem');
const built = path.resolve(__dirname, '../../..', 'dist/packages/core/src');
const { PushChain } = require(built);
const { CHAIN, PUSH_NETWORK } = PushChain.CONSTANTS;
const { currentGeneration, verifyFactoryWiring } = require(path.join(
  built,
  'lib/agentic/deployments'
));
const { Snapshot } = require(path.join(built, 'lib/agentic/reads/snapshot'));
const { publicRules } = require(path.join(built, 'lib/agentic/public-rule'));
const { prepareWalletRules } = require(path.join(
  built,
  'lib/agentic/management/prepare'
));
const { getCEAAddress } = require(path.join(
  built,
  'lib/orchestrator/cea-utils'
));
const { readOriginToken, PRC20_SOURCE_ABI } = require(path.join(
  built,
  'lib/agentic/contracts/prc20-metadata'
));
const { getPRC20Address } = require(path.join(
  built,
  'lib/universal/prc20-address'
));

const endpoints = {
  [CHAIN.ETHEREUM_SEPOLIA]: 'https://ethereum-sepolia-rpc.publicnode.com',
  [CHAIN.BASE_SEPOLIA]: 'https://base-sepolia-rpc.publicnode.com',
  [CHAIN.ARBITRUM_SEPOLIA]: 'https://arbitrum-sepolia-rpc.publicnode.com',
  [CHAIN.BNB_TESTNET]: 'https://bsc-testnet-rpc.publicnode.com',
};

async function main() {
  const report = {
    at: new Date().toISOString(),
    readOnly: true,
    network: PUSH_NETWORK.TESTNET_DONUT,
    cases: [],
  };
  const rpc = createPublicClient({
    transport: http('https://evm.donut.rpc.push.org/', {
      timeout: 15000,
      retryCount: 1,
    }),
  });
  assert.equal(await rpc.getChainId(), 42101);
  const owner = getAddress('0x0A16CBa65FfCAa4C2282b27b027Ab4A2fE46E0Bf');
  const agent = getAddress('0x0000000000000000000000000000000000005678');
  // A UniversalAccount creates a read-mode client: there is no signer here.
  const client = await PushChain.initialize(
    { address: owner, chain: CHAIN.PUSH_TESTNET_DONUT },
    { network: PUSH_NETWORK.TESTNET_DONUT }
  );
  const runtime = client.agenticRuntime;
  assert.equal(runtime.isReadOnly, true);
  // Same CEA factory read, with explicit public endpoints for reproducibility.
  runtime.resolveCEA = (wallet, chain) =>
    getCEAAddress(wallet, chain, endpoints[chain]);
  const gen = currentGeneration(runtime.network);
  await verifyFactoryWiring(runtime.reader, gen);
  const snap = await Snapshot.at(runtime.reader);
  report.blockNumber = String(snap.blockNumber);
  report.factory = gen.addresses.factory;
  report.verifiedERC20Mappings = [];
  for (const source of [
    '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af',
  ]) {
    const mapped = getPRC20Address({
      chain: CHAIN.ETHEREUM_SEPOLIA,
      address: getAddress(source),
    });
    assert.equal(
      await snap.read(
        mapped.address,
        PRC20_SOURCE_ABI,
        'SOURCE_CHAIN_NAMESPACE'
      ),
      CHAIN.ETHEREUM_SEPOLIA
    );
    assert.equal(
      await readOriginToken(snap, mapped.address, CHAIN.ETHEREUM_SEPOLIA),
      getAddress(source)
    );
    report.verifiedERC20Mappings.push({
      source: getAddress(source),
      prc20: mapped.address,
      status: 'source-identity-verified',
    });
  }
  const index = await snap.read(
    gen.addresses.factory,
    gen.contracts.abis.factory,
    'walletCount',
    [owner]
  );
  const [wallet, deployed] = await snap.read(
    gen.addresses.factory,
    gen.contracts.abis.factory,
    'predictWallet',
    [owner, index]
  );
  assert.equal(deployed, false);
  report.counterfactualWallet = wallet;
  for (const category of ['DEXES', 'LENDING', 'STAKING']) {
    const chains = PushChain.utils.agentic.presets
      .list()
      .presets.find((p) => p.constant === category)
      .chains.filter((c) => endpoints[c]);
    for (const chainNamespace of chains) {
      const result = { category, chainNamespace };
      try {
        const push = PushChain.utils.agentic.presets.get(category, {
          agent,
          chainNamespace,
        });
        // Explicit prefunded fixture, not public preset acceptance or bridge proof.
        const fixtureRules = push.rules.map((rule) => ({
          ...rule,
          assets: [],
        }));
        const prepared = await prepareWalletRules(
          runtime,
          gen,
          owner,
          wallet,
          publicRules(fixtureRules),
          snap
        );
        const data = gen.contracts.encodeCreateWalletAt(
          owner,
          index,
          wallet,
          'preset-readonly-check',
          prepared.map((p) => p.session)
        );
        const simulated = await rpc.call({
          account: owner,
          to: gen.addresses.factory,
          data,
          blockNumber: snap.blockNumber,
          gas: BigInt(20000000),
        });
        assert(simulated.data && simulated.data !== '0x');
        result.prefundedFixtureFactorySimulation = 'passed';
        result.selectedAssets = push.rules[0].assets;
        // Every shipped preset is routable, so preparation must verify against real metadata.
        await prepareWalletRules(
          runtime,
          gen,
          owner,
          wallet,
          publicRules(push.rules),
          snap
        );
        result.pushPreparation = 'passed';
        console.log(
          `${category} ${chainNamespace}: destination factory eth_call passed; Push ${result.pushPreparation}`
        );
      } catch (error) {
        result.error = error.shortMessage || error.message;
        process.exitCode = 1;
        console.error(`${category} ${chainNamespace}: ${result.error}`);
      }
      report.cases.push(result);
    }
  }
  const output = process.argv[2] || '/tmp/agw-preset-route-acceptance.json';
  fs.writeFileSync(
    output,
    JSON.stringify(
      report,
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )
  );
  console.log(
    `Read-only report: ${output}; ${
      report.cases.filter((c) => !c.error).length
    }/${report.cases.length} passed.`
  );
}
main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
