// Read-only Donut deployment probe. Never loads keys or broadcasts transactions.
const fs = require('node:fs');
const path = require('node:path');
const {
  createPublicClient, http, parseAbi, keccak256, encodeAbiParameters,
  parseAbiParameters, getCreate2Address,
} = require('viem');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'research/2026-10-20/live-deployment.json');
const addresses = {
  marketplace: '0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4',
  kernel: '0x977cf1AC973E9eC4332791d531507575006157Ed',
  hook: '0xDe7A94e510b6C571DE7880d441349689F73A32b3',
  rules: '0x5b98A8E0df5b918DF76cD2BE84bA7995B39dfd44',
  builder: '0x2de1e3F053b0bBa0cE0C6953144534a0b055f59e',
  factory: '0xFBBEB6a365178fAaA81A9789a5f64b300c37e5bc',
  engine: '0xf63DC0628fe1B25049FE3E3a3585Ef051CB98c1d',
  pUSDC: '0x7A58048036206bB898008b5bBDA85697DB1e5d66',
  evaluator: '0x1afC81396f1bb36F91f74506284952b81e4bd47c',
};
const implementationSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const adminSlot = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const getters = {
  marketplace: ['version() view returns (string)', 'AGW_FACTORY() view returns (address)', 'KERNEL() view returns (address)', 'RULES() view returns (address)', 'hook() view returns (address)', 'evaluator() view returns (address)', 'PUSH_CHAIN_HASH() view returns (bytes32)', 'agentCardCount() view returns (uint256)', 'OPENJOB_LANE() view returns (uint192)', 'paused() view returns (bool)'],
  kernel: ['paymentToken() view returns (address)', 'jobCounter() view returns (uint256)', 'platformFeeBP() view returns (uint256)', 'evaluatorFeeBP() view returns (uint256)', 'EVALUATOR_GRACE_PERIOD() view returns (uint256)', 'MIN_EXPIRY_WINDOW() view returns (uint256)', 'paused() view returns (bool)'],
  hook: ['KERNEL() view returns (address)', 'AGW_FACTORY() view returns (address)', 'SESSION_ENGINE() view returns (address)'],
  pUSDC: ['symbol() view returns (string)', 'decimals() view returns (uint8)'],
};
async function main() {
  const client = createPublicClient({ transport: http('https://evm.donut.rpc.push.org/', { timeout: 20000, retryCount: 2 }) });
  const blockNumber = await client.getBlockNumber();
  const report = { observedAt: new Date().toISOString(), rpc: 'https://evm.donut.rpc.push.org/', chainId: await client.getChainId(), blockNumber, addresses, components: {}, getters: {}, chains: [], errors: [] };
  await Promise.all(Object.entries(addresses).map(async ([name, address]) => {
    try {
      const code = (await client.getCode({ address, blockNumber })) || '0x';
      report.components[name] = { address, codeBytes: (code.length - 2) / 2, codeHash: keccak256(code) };
      if (['marketplace', 'kernel', 'hook'].includes(name)) {
        const [impl, admin] = await Promise.all([implementationSlot, adminSlot].map(slot => client.getStorageAt({ address, slot, blockNumber })));
        report.components[name].implementation = '0x' + impl.slice(-40);
        report.components[name].proxyAdmin = '0x' + admin.slice(-40);
        const implCode = (await client.getCode({ address: report.components[name].implementation, blockNumber })) || '0x';
        report.components[name].implementationCodeBytes = (implCode.length - 2) / 2;
        report.components[name].implementationCodeHash = keccak256(implCode);
      }
    } catch (error) { report.errors.push({ stage: 'code', name, message: error.shortMessage || error.message }); }
  }));
  await Promise.all(Object.entries(getters).flatMap(([name, signatures]) => signatures.map(async signature => {
    const fn = signature.slice(0, signature.indexOf('('));
    try { report.getters[`${name}.${fn}`] = await client.readContract({ address: addresses[name], abi: parseAbi(['function ' + signature]), functionName: fn, blockNumber }); }
    catch (error) { report.errors.push({ stage: 'getter', name, fn, message: error.shortMessage || error.message }); }
  })));
  report.getters['kernel.whitelistedHooks'] = await client.readContract({ address: addresses.kernel, abi: parseAbi(['function whitelistedHooks(address) view returns (bool)']), functionName: 'whitelistedHooks', args: [addresses.hook], blockNumber });
  const owner = '0x1111111111111111111111111111111111111111';
  const [wallet, deployed] = await client.readContract({ address: addresses.factory, abi: parseAbi(['function predictWallet(address,uint256) view returns (address,bool)']), functionName: 'predictWallet', args: [owner, 0n], blockNumber });
  report.sampleWallet = { owner, index: 0, wallet, deployed };
  for (const chain of ['eip155:11155111', 'eip155:84532', 'eip155:421614', 'eip155:97']) {
    const chainHash = keccak256(Buffer.from(chain));
    const [factory, implementation] = await client.readContract({ address: addresses.marketplace, abi: parseAbi(['function ceaDeployment(bytes32) view returns (address,address)']), functionName: 'ceaDeployment', args: [chainHash], blockNumber });
    const cea = await client.readContract({ address: addresses.marketplace, abi: parseAbi(['function computeCEA(address,bytes32) view returns (address)']), functionName: 'computeCEA', args: [wallet, chainHash], blockNumber });
    const init = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`;
    const independentCEA = getCreate2Address({ from: factory, salt: keccak256(encodeAbiParameters(parseAbiParameters('address'), [wallet])), bytecodeHash: keccak256(init) });
    report.chains.push({ chain, chainHash, factory, implementation, cea, independentCEA, matches: cea.toLowerCase() === independentCEA.toLowerCase() });
  }
  fs.writeFileSync(OUT, JSON.stringify(report, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n');
  console.log(JSON.stringify({ file: OUT, blockNumber: blockNumber.toString(), version: report.getters['marketplace.version'], cards: String(report.getters['marketplace.agentCardCount']), jobs: String(report.getters['kernel.jobCounter']), errors: report.errors, ceaChecks: report.chains.map(x => ({ chain: x.chain, matches: x.matches })) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
