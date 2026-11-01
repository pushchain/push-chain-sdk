const path=require('node:path');const built='/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk/dist/packages/core/src';
const {PushChain}=require(built);const {CHAIN,PUSH_NETWORK}=PushChain.CONSTANTS;
const {getNativePRC20ForChain}=require(path.join(built,'lib/orchestrator/internals/helpers'));
(async()=>{for (const chain of [CHAIN.PUSH_TESTNET_DONUT, CHAIN.ETHEREUM_SEPOLIA]) {
 const client=await PushChain.initialize({address:'0x0000000000000000000000000000000000005678',chain},{network:PUSH_NETWORK.TESTNET_DONUT,printTraces:true});
 const rt=client.agenticRuntime; console.log('#### origin',chain);
 const q=await rt.quoteOutbound(getNativePRC20ForChain(CHAIN.BNB_TESTNET,rt.network),BigInt(2000000),CHAIN.BNB_TESTNET);
 console.log('#### result',chain,String(q.nativeValueForGas));}})().catch(e=>{console.error('ERR',e.message);process.exitCode=1});
