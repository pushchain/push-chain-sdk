const {createPublicClient,http,parseAbi}=require('/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk/node_modules/viem');
const fs=require('node:fs');
const c=createPublicClient({transport:http('https://evm.donut.rpc.push.org/',{timeout:20000,retryCount:1})});
const abi=parseAbi(['function gasPriceByChainNamespace(string) view returns (uint256)']);
const NS=['eip155:11155111','eip155:84532','eip155:421614','eip155:97','solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'];
(async()=>{const head=await c.getBlockNumber();const rows=[];
for(let back=0n;back<=2400n;back+=200n){const bn=head-back;const row={block:String(bn)};
 try{const b=await c.getBlock({blockNumber:bn});row.time=new Date(Number(b.timestamp)*1000).toISOString();}catch(e){row.timeError=e.shortMessage}
 for(const ns of NS){try{row[ns]=String(await c.readContract({address:'0x00000000000000000000000000000000000000C0',abi,functionName:'gasPriceByChainNamespace',args:[ns],blockNumber:bn}))}catch(e){row[ns]='ERR '+(e.shortMessage||e.message).slice(0,60)}}
 rows.push(row);}
fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,1));for(const r of rows)console.log(r.block,r.time,NS.map(n=>r[n]).join(' | '));})().catch(e=>{console.error(e.message);process.exitCode=1});
