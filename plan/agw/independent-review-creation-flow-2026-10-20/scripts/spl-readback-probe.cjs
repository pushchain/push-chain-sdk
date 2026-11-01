// Read-only: stored SPL rule readback + wrong-recipient refusal via eth_call. No keys.
const root='/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk',fs=require('node:fs');
const {createPublicClient,http,decodeFunctionData,encodeFunctionData}=require(root+'/node_modules/viem');
const built=root+'/dist/packages/core/src';
const {PushChain}=require(built);
const {v6}=require(built+'/lib/agentic/contracts/v6');
const {UNIVERSAL_GATEWAY_PC}=require(built+'/lib/constants/abi');
const {parseAgwSvmPayload,encodeAgwSvmPayload}=require(built+'/lib/agentic/execution/svm-payload');
const {decodeAgenticRevert}=require(built+'/lib/agentic/revert');
const {PublicKey}=require(root+'/node_modules/@solana/web3.js');
const big=(_k,v)=>typeof v==='bigint'?String(v):v;
(async()=>{
 const rpc=createPublicClient({transport:http('https://evm.donut.rpc.push.org/',{timeout:15000,retryCount:1})});
 const hash='0x119c89e9ff7c7cccdfc8c071fade2488aa28b0eff7d9b71f7f0cf247c958bbf5';
 const tx=await rpc.getTransaction({hash}),w=v6.decodeWalletCall(tx.input);
 const call=w.calls[0],{args}=decodeFunctionData({abi:UNIVERSAL_GATEWAY_PC,data:call.data}),req=args[0];
 const original=parseAgwSvmPayload(req.payload),block=await rpc.getBlockNumber();
 const client=await PushChain.initialize({address:'0x0000000000000000000000000000000000005678',chain:PushChain.CONSTANTS.CHAIN.PUSH_TESTNET_DONUT},{network:PushChain.CONSTANTS.PUSH_NETWORK.TESTNET_DONUT});
 const record=await client.agentic.wallet(tx.to).rules.get(w.rulesId);
 // Wrong recipient: swap the recipient ATA (account 2) for an ATA owned by someone else.
 const other=PublicKey.findProgramAddressSync([new PublicKey('11111111111111111111111111111112').toBuffer(),new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),new PublicKey('EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF').toBuffer()],new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))[0];
 const payload={...original,accounts:original.accounts.map(a=>({...a})),instructionData:Uint8Array.from(original.instructionData)};
 payload.accounts[2].pubkey='0x'+other.toBuffer().toString('hex');
 const next={...req,amount:0n,payload:encodeAgwSvmPayload(payload.program,payload.accounts,payload.instructionData)};
 const data=v6.encodeExecuteAsAgent(w.rulesId,{...call,data:encodeFunctionData({abi:UNIVERSAL_GATEWAY_PC,functionName:'sendUniversalTxOutbound',args:[next]})});
 let refusal;
 try{await rpc.call({account:tx.from,to:tx.to,data,blockNumber:block});refusal='NOT REFUSED';}catch(e){refusal=decodeAgenticRevert(e)||String(e.shortMessage||e.message);}
 const out={at:new Date().toISOString(),readOnly:true,block:String(block),wallet:tx.to,rulesId:w.rulesId,originalAccounts:original.accounts,record,wrongRecipient:{ata:other.toBase58(),refusal}};
 fs.writeFileSync(process.argv[2],JSON.stringify(out,big,2));
 console.log(JSON.stringify({block:out.block,rule:record.rule,wrongRecipient:out.wrongRecipient,originalAccounts:original.accounts},big,1));
})().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1});
