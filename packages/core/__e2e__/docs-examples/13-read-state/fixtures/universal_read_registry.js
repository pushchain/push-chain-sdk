// customPropGTagEvent=universal_read_registry
import { PushChain } from '@pushchain/core';
import { ethers } from 'ethers';
import * as readline from 'node:readline/promises';

async function main() {
  const provider = new ethers.JsonRpcProvider('https://evm.donut.rpc.push.org/');
  const wallet = ethers.Wallet.createRandom().connect(provider);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('Temporary Donut wallet:', wallet.address);
    await rl.question(':::prompt:::Fund this temporary wallet with test PC, then press Enter: ' + wallet.address + ' Faucet: https://faucet.push.org/');
    const signer = await PushChain.utils.signer.toUniversal(wallet);
    const pushChainClient = await PushChain.initialize(signer, {
      network: PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT,
    });

    const pending = await pushChainClient.universal.read('0x000000000000000000000000000000000000dEaD', {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      waitForCompletion: false,
    });
    console.log('Save requestId:', pending.requestId);
    console.log('Save txHash:', pending.txHash);
    const done = await pending.wait();
    const READ = PushChain.CONSTANTS.READ;
    if (done.status !== READ.STATUS.FULFILLED || done.raw?.status !== READ.RESULT_STATUS.SUCCESS || done.callbackDelivered !== true || done.decodeError) {
      throw new Error('No usable result: ' + JSON.stringify({ status: done.status, raw: done.raw, delivered: done.callbackDelivered, decodeError: done.decodeError }));
    }
    console.log('Value:', JSON.stringify(done.value, (_, value) => typeof value === 'bigint' ? value.toString() : value));
    console.log('Callback delivered:', done.callbackDelivered);
  } finally {
    rl.close();
    provider.destroy();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
