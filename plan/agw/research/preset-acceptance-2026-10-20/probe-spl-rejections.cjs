// Read-only exact contract error checks using the recorded successful SPL call.
// Run from SDK root after building. No signer or environment keys are loaded.
const root=process.cwd(),fs=require('node:fs');
const { createPublicClient,http,decodeFunctionData,encodeFunctionData }=require(root+'/node_modules/viem');
const built=root+'/dist/packages/core/src';
const {v6}=require(built+'/lib/agentic/contracts/v6');
const {UNIVERSAL_GATEWAY_PC}=require(built+'/lib/constants/abi');
const {parseAgwSvmPayload,encodeAgwSvmPayload}=require(built+'/lib/agentic/execution/svm-payload');
const {decodeAgenticRevert}=require(built+'/lib/agentic/revert');
const reportPath=root+'/plan/agw/research/preset-acceptance-2026-10-20/';
(async()=>{
 const rpc=createPublicClient({transport:http('https://evm.donut.rpc.push.org/',{timeout:15000,retryCount:1})});
 const evidence=JSON.parse(fs.readFileSync(reportPath+'live-spl-evidence.json'));
 const hash=evidence.find(x=>x.name==='agent-spl-submitted').hash;
 const tx=await rpc.getTransaction({hash}),w=v6.decodeWalletCall(tx.input);
 if(w?.kind!=='executeAsAgent'||w.calls.length!==1)throw new Error('Unexpected recorded wallet call');
 const call=w.calls[0],{args}=decodeFunctionData({abi:UNIVERSAL_GATEWAY_PC,data:call.data}),req=args[0];
 const original=parseAgwSvmPayload(req.payload),block=await rpc.getBlockNumber();
 const results=[];
 for(const mode of ['amount','account']){
  const payload={...original,accounts:original.accounts.map(a=>({...a})),instructionData:Uint8Array.from(original.instructionData)};
  if(mode==='amount')new DataView(payload.instructionData.buffer).setBigUint64(8,1001n,true);
  else payload.accounts[1].pubkey=payload.accounts[2].pubkey;
  const next={...req,amount:0n,payload:encodeAgwSvmPayload(payload.program,payload.accounts,payload.instructionData)};
  const data=v6.encodeExecuteAsAgent(w.rulesId,{...call,data:encodeFunctionData({abi:UNIVERSAL_GATEWAY_PC,functionName:'sendUniversalTxOutbound',args:[next]})});
  try{await rpc.call({account:tx.from,to:tx.to,data,blockNumber:block});throw new Error('Expected refusal');}
  catch(e){const decoded=decodeAgenticRevert(e);if(!decoded)throw e;results.push({mode,decoded});}
 }
 const report={at:new Date().toISOString(),readOnly:true,chainId:await rpc.getChainId(),block:String(block),originalHash:hash,note:'Zero burn on the already-spent rule isolates instruction/data checks; no transactions sent.',results};
 fs.writeFileSync(reportPath+'spl-rejections.json',JSON.stringify(report,(_k,v)=>typeof v==='bigint'?String(v):v,2));
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1});
