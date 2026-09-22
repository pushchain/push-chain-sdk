// customPropGTagEvent=universal_read_batch
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

    const first = await pushChainClient.universal.prepareRead('0x000000000000000000000000000000000000dEaD', {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
    });
    const second = await pushChainClient.universal.prepareRead('https://jsonplaceholder.typicode.com/todos/1', {
      chain: PushChain.CONSTANTS.CHAIN.WEB2,
      web2: { extract: [{ path: '$.id', valueType: 'uint256' }, { path: '$.completed', valueType: 'bool' }] },
    });
    const tokenAbi = [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }];
    const third = await pushChainClient.universal.prepareRead('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', {
      chain: PushChain.CONSTANTS.CHAIN.ETHEREUM_SEPOLIA,
      abi: tokenAbi,
      functionName: 'totalSupply',
    });
    const fourth = await pushChainClient.universal.prepareRead('11111111111111111111111111111111', {
      chain: PushChain.CONSTANTS.CHAIN.SOLANA_DEVNET,
    });
    const batch = await pushChainClient.universal.executeReads([first, second, third, fourth], { waitForCompletion: false });
    console.log('Submission is atomic:', batch.atomic);
    console.log('Save request IDs:', batch.reads.map(read => read.requestId).join(', '));
    console.log('Save transaction hashes:', (batch.transactionHashes || [batch.txHash]).join(', '));
    const results = await batch.wait();
    for (const done of results) {
      const READ = PushChain.CONSTANTS.READ;
      if (done.status !== READ.STATUS.FULFILLED || done.raw?.status !== READ.RESULT_STATUS.SUCCESS || done.callbackDelivered !== true || done.decodeError) {
        throw new Error('No usable result: ' + JSON.stringify({ status: done.status, raw: done.raw, delivered: done.callbackDelivered, decodeError: done.decodeError }));
      }
      console.log('Value:', JSON.stringify(done.value, (_, value) => typeof value === 'bigint' ? value.toString() : value));
      console.log('Callback delivered:', done.callbackDelivered);
    }
  } finally {
    rl.close();
    provider.destroy();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
