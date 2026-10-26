const fs=require('fs'),path=require('path');
const {createPublicClient,http,parseAbi,parseAbiItem,toFunctionSelector,encodeAbiParameters,encodePacked,keccak256,concat,numberToHex,getContractAddress}=require(path.join(process.cwd(),'node_modules/viem'));
const dir='plan/agw/research/deployment-review-2026-10-07-v5';
const probe=JSON.parse(fs.readFileSync(dir+'/donut-probe.json')); const block=BigInt(probe.block),factory=probe.code.factory.address,implementation=probe.code.walletImplementation.address;
const client=createPublicClient({transport:http(probe.rpc)});
(async()=>{
const logs=[]; for(let start=23989983n;start<=block;start+=1000n) {const end=start+999n>block?block:start+999n; logs.push(...await client.getLogs({address:factory,event:parseAbiItem('event WalletDeployed(address indexed owner, uint256 indexed index, address indexed wallet, string label)'),fromBlock:start,toBlock:end}));}
const code=await client.getCode({address:implementation,blockNumber:block});
const result={block:String(block),selectors:Object.fromEntries(['label()','setLabel(string)','initializeAccount(string)'].map(s=>[s,{selector:toFunctionSelector(s),presentInRuntime:code.includes(toFunctionSelector(s).slice(2))}])),wallets:[]};
for(const log of logs.slice(0,5)) {
const {owner,index,wallet,label}=log.args;
const abi=parseAbi(['function label() view returns (string)','function checkpointCount() view returns (uint64)','function setLabel(string)','error LabelTooLong(uint256 length)','error CallerIsNotOwner()']);
const reads={label:await client.readContract({address:wallet,abi,functionName:'label',blockNumber:block}),checkpointCount:String(await client.readContract({address:wallet,abi,functionName:'checkpointCount',blockNumber:block}))};
const simulations=[];
for(const [name,account,newLabel] of [['owner',owner,'SDK review'],['emptyReset',owner,''],['over64Bytes',owner,'a'.repeat(65)],['nonOwner','0x0000000000000000000000000000000000000001','SDK review']]) {
try {await client.simulateContract({address:wallet,abi,functionName:'setLabel',args:[newLabel],account,blockNumber:block});simulations.push({name,success:true});}catch(e){let c=e;while(c.cause)c=c.cause;simulations.push({name,success:false,errorName:c.data?.errorName||null,args:c.data?.args?.map(String)||[],message:e.shortMessage});}}
result.wallets.push({owner,index:String(index),wallet,deployLabel:label,reads,simulations});
}
const sampleOwner=logs[0]?.args.owner||'0xa89523351BE1e2De64937AA9AF61Ae06eAd199C7';
const count=await client.readContract({address:factory,abi:parseAbi(['function walletCount(address) view returns (uint256)']),functionName:'walletCount',args:[sampleOwner],blockNumber:block});
const salt=keccak256(encodeAbiParameters([{type:'address'},{type:'uint96'}],[sampleOwner,count]));
const args=encodePacked(['address','address'],[sampleOwner,factory]);
const bytecode=concat(['0x61',numberToHex(85,{size:2}),'0x3d81600a3d39f3363d3d373d3d3d363d73',implementation,'0x5af43d82803e903d91602b57fd5bf3',args]);
const local=getContractAddress({opcode:'CREATE2',from:factory,salt,bytecodeHash:keccak256(bytecode)});
const prediction=await client.readContract({address:factory,abi:parseAbi(['function predictWallet(address,uint256) view returns (address,bool)']),functionName:'predictWallet',args:[sampleOwner,count],blockNumber:block});
result.derivation={owner:sampleOwner,index:String(count),local,predicted:prediction[0],matches:local.toLowerCase()===prediction[0].toLowerCase()};
result.deploySimulations=[];for(const [name,label]of [['default',''],['64Bytes','a'.repeat(64)],['65Bytes','a'.repeat(65)],['16Emoji','🙂'.repeat(16)],['17Emoji','🙂'.repeat(17)]]){try{const simulated=await client.simulateContract({address:factory,abi:parseAbi(['function deployWallet(string) returns (address)','error LabelTooLong(uint256 length)']),functionName:'deployWallet',args:[label],account:sampleOwner,blockNumber:block});result.deploySimulations.push({name,success:true,wallet:simulated.result});}catch(e){const c=e.walk?.(x=>x.name==='ContractFunctionRevertedError');result.deploySimulations.push({name,success:false,errorName:c?.data?.errorName||null,args:c?.data?.args?.map(String)||[],message:e.shortMessage});}}
result.totalDeployedWalletEvents=logs.length;fs.writeFileSync(dir+'/label-readonly-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})();
