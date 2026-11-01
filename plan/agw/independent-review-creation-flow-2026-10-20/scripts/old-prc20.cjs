const SDK='/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk';
const {createPublicClient,http,parseAbi,hexToString,keccak256,toHex}=require(SDK+'/node_modules/viem');
const fs=require('node:fs');
const c=createPublicClient({transport:http('https://evm.donut.rpc.push.org/',{timeout:20000,retryCount:2})});
const abi=parseAbi(['function SOURCE_CHAIN_NAMESPACE() view returns (string)','function decimals() view returns (uint8)','function symbol() view returns (string)','function name() view returns (string)','function totalSupply() view returns (uint256)','function getOutboundTxGasAndFees(address,uint256) view returns (address,uint256,uint256,uint256,string,uint256)']);
const T={ 'USDC.eth.old':'0x387b9C8Db60E74999aAAC5A2b7825b400F12d68E','USDC.base.old':'0x84B62e44F667F692F7739Ca6040cD17DA02068A8','USDC.arb.old':'0xa261A10e94aE4bA88EE8c5845CbE7266bD679DD6','USDT.eth.old':'0xCA0C5E6F002A389E1580F0DB7cd06e4549B5F9d3','USDT.arb.old':'0x76Ad08339dF606BeEDe06f90e3FaF82c5b2fb2E9','USDT.base.old':'0x2C455189D2af6643B924A981a9080CcC63d5a567','USDT.bsc.old':'0x2f98B4235FD2BA0173a2B056D722879360B12E7b'};
const sel=keccak256(toHex('SOURCE_TOKEN_ADDRESS()')).slice(0,10);
(async()=>{const bn=await c.getBlockNumber();const out={at:new Date().toISOString(),block:bn.toString(),tokens:{}};
for(const [k,a] of Object.entries(T)){const m={address:a};
 for(const f of ['SOURCE_CHAIN_NAMESPACE','decimals','symbol','name','totalSupply']){try{m[f]=String(await c.readContract({address:a,abi,functionName:f,blockNumber:bn}))}catch(e){m[f+'Error']=(e.shortMessage||e.message).slice(0,120)}}
 try{const raw=(await c.call({to:a,data:sel,blockNumber:bn})).data; if(raw.length===66)m.sourceWord=raw; else {const len=Number(BigInt('0x'+raw.slice(66,130)));m.sourceString=hexToString('0x'+raw.slice(130,130+len*2));}}catch(e){m.sourceError=(e.shortMessage||e.message).slice(0,120)}
 try{const r=await c.readContract({address:'0x00000000000000000000000000000000000000C0',abi,functionName:'getOutboundTxGasAndFees',args:[a,0n],blockNumber:bn});m.outboundQuote={gasToken:r[0],gasFee:String(r[1]),protocolFee:String(r[2]),chain:r[4],gasLimitUsed:String(r[5])}}catch(e){m.outboundQuoteError=(e.shortMessage||e.message).slice(0,160)}
 out.tokens[k]=m;}
fs.writeFileSync(process.argv[2],JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,1));})().catch(e=>{console.error(e.message);process.exitCode=1});
