const {createPublicClient,http,parseAbi,parseEventLogs}=require('/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk/node_modules/viem');
const fs=require('node:fs');
const EXEC=parseAbi(['event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)']);
const D=[
 ['eip155:11155111','https://ethereum-sepolia-rpc.publicnode.com','0xD847ca2462405a70c32ff5776e70fE25EA7B26ca','0xDdc0C8e35863f1478c0485144d2Fae959242Ce43',['0xf3ed17fa05f700543ec10930d078c6fb793624e44e8ec8fe3f14fbb7cee5cf19','0x15f49a09b3879f3cc1ea4c3accddc7431b279da59033f5eb9842a0d4994df50a']],
 ['eip155:84532','https://base-sepolia-rpc.publicnode.com','0xB07a90329A3Ef6B20aC80a458069a7D8daE93D58','0xB0d8079eEF1553d3e975947f087eEeB05f02ab1A',['0x89337900340a39fd1725657e72f146fe5b4b917a58d5db150f052b2222724d6d','0xe81704385810c74cef8d16cb7fe3e2a98805aff9a9f63aaf5008d3d9288a4781']],
 ['eip155:421614','https://arbitrum-sepolia-rpc.publicnode.com','0x3130f7F8b10C94A54eC012A4d0e6DAc963f200eb','0x97B91433aF804877cd11EC522C910c54E04624b5',['0x059011ed41d6409e48b70ab47dd02a16eca292e01e68eb721d78df5813f46c98','0x54f382ed25d895893f6cd3042ff7ee43e63bc392397c9a9572c424a3589d9df8']],
 ['eip155:97','https://bsc-testnet-rpc.publicnode.com','0x0140403283bB76C1890501067754d1c376189b5D','0xA7384f2b00463E548426Cd9C8979dDa78ECf60c4',['0x6b5cfb84699948c2b626e2a244b9ff8354d070093d6f8ecb42a228914adfdaa5','0x42adb9167d8f25a81ff01e143cb43e676818d8ce144a08444c890caecd08029a']],
];
(async()=>{const out=[];
for(const [ns,rpc,wallet,cea,hashes] of D){const c=createPublicClient({transport:http(rpc,{timeout:20000,retryCount:2})});
 for(const h of hashes){const r={ns,hash:h};try{const rc=await c.getTransactionReceipt({hash:h});const tx=await c.getTransaction({hash:h});
  Object.assign(r,{status:rc.status,block:String(rc.blockNumber),from:rc.from,to:rc.to,value:String(tx.value),gasUsed:String(rc.gasUsed)});
  const ev=parseEventLogs({abi:EXEC,logs:rc.logs});r.ceaExecuted=ev.map(e=>({emitter:e.address,originCaller:e.args.originCaller,target:e.args.target,data:e.args.data}));
  r.ceaMatches=ev.some(e=>e.address.toLowerCase()===cea.toLowerCase()&&e.args.originCaller.toLowerCase()===wallet.toLowerCase());}catch(e){r.error=(e.shortMessage||e.message).slice(0,160)}out.push(r);}
 try{out.push({ns,ceaCodeBytes:((await c.getCode({address:cea}))||'0x').length/2-1,ceaNativeBalanceNow:String(await c.getBalance({address:cea}))})}catch(e){}}
// Push-side wallet balance deltas around the SPL first-use send (refund check)
const p=createPublicClient({transport:http('https://evm.donut.rpc.push.org/',{timeout:20000,retryCount:1})});
const W='0xED6bFE825b8d84A1E6f4F7c9067398F8985CC372';const refund={};
for(const [k,b] of [['spl:first-use',24455663n],['spl:subsequent',24455695n]]){try{const before=await p.getBalance({address:W,blockNumber:b-1n});const after=await p.getBalance({address:W,blockNumber:b});refund[k]={before:String(before),after:String(after),deltaPC:Number(after-before)/1e18}}catch(e){refund[k]={error:(e.shortMessage||e.message).slice(0,160)}}}
fs.writeFileSync(process.argv[2],JSON.stringify({at:new Date().toISOString(),dest:out,walletDelta:refund},null,1));
for(const r of out)console.log(JSON.stringify(r));console.log('walletDelta',JSON.stringify(refund));})().catch(e=>{console.error(e.message);process.exitCode=1});
