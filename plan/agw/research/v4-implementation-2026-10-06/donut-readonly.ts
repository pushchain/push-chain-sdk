/** Read-only public SDK check. No signer key, create(), funding or grant calls. */
import { PushChain } from '../../../../packages/core/src';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const { CHAIN, PUSH_NETWORK } = PushChain.CONSTANTS;
  const client = await PushChain.initialize({
    address: '0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7',
    chain: CHAIN.PUSH_TESTNET_DONUT,
  }, {
    network: PUSH_NETWORK.TESTNET_DONUT,
    rpcUrls: { [CHAIN.PUSH_TESTNET_DONUT]: ['https://evm.donut.rpc.push.org/'] },
  });
  const result = {
    checkedAt: new Date().toISOString(), mode: 'read-only',
    factory: PushChain.CONSTANTS.AGENTIC[PUSH_NETWORK.TESTNET_DONUT]!.FACTORY,
    derived: await client.agentic.derive(),
  };
  writeFileSync(join(__dirname, 'donut-sdk-readonly.json'), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
