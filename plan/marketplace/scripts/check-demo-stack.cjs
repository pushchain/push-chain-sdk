// Read-only comparison of SDK/marketplace CEA routing and the two supplied demo stacks.
// Usage: node plan/marketplace/scripts/check-demo-stack.cjs /absolute/path/report.json
// Requires a local core build. Never reads signer configuration or broadcasts.
const fs = require('node:fs');
const path = require('node:path');
const { createPublicClient, http, fallback, parseAbi, keccak256, stringToHex, parseAbiParameters, decodeAbiParameters, encodeAbiParameters } = require('viem');
const root = path.resolve(__dirname, '../../..');
const { CHAIN_INFO, CEA_FACTORY_ADDRESSES, VAULT_ADDRESSES } = require(path.join(root, 'dist/packages/core/src/lib/constants/chain'));
const { KERNEL_READ_ABI } = require(path.join(root, 'dist/packages/core/src/lib/market/kernel-wire'));
const { decodePrePostJobSpec } = require(path.join(root, 'dist/packages/core/src/lib/job-spec/pre-post/codec'));
const market = '0x9071ebE01B75123A91e88eB6ec4BF163F3fE9BF4';
const sampleWallet = '0x3fE044FD8c3EDc0e7ab18cF35Eda254B4eC15F55';
const stacks = {
  conversation: { kernel: '0x449C11cAFe57d8d9079058FeEef8e9E7E1DCBcE0', hook: '0xbee0B01773Dc742887f04bED58BD1B5Aa457ED96', evaluator: '0x2a73944D79E052bAF553F59fA1c7C23f3491845c' },
  downloadedDemo: { kernel: '0x4F9bbb7d75900DAc1631504BCf3047B199D7B1E0', hook: '0x360C1D85574580aa1B1213816C777fE3868D5BEC', evaluator: '0x7D6208f2008a54f6B1F613d3BF27008f6aEA4Ce3' },
};
const same = (a,b) => a.toLowerCase() === b.toLowerCase();
const serialize = x => JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
const client = urls => createPublicClient({ transport: fallback([...new Set(urls)].map(url => http(url,{timeout:12000,retryCount:1,batch:{batchSize:20,wait:30}}))) });
const read = (c,address,signature,blockNumber,args=[]) => c.readContract({address,abi:parseAbi(['function '+signature]),functionName:signature.slice(0,signature.indexOf('(')),args,blockNumber});
const safe = promise => promise.then(value=>({value}),error=>({error:error.shortMessage||error.message}));
async function main(){
  const out=process.argv[2];if(!out)throw new Error('Provide an output JSON path; no historical report is overwritten by default.');
  const push=client(CHAIN_INFO['eip155:42101'].defaultRPC),block=await push.getBlockNumber();
  const report={observedAt:new Date().toISOString(),pushBlock:block,sampleWallet,marketplace:{address:market},cea:[],stacks:{}};
  const getters={kernel:'KERNEL()',hook:'hook()',evaluator:'evaluator()'};
  for(const [key,name] of Object.entries(getters))report.marketplace[key]=await safe(read(push,market,name+' view returns(address)',block));
  if('value'in report.marketplace.kernel)report.marketplace.paymentToken=await safe(read(push,report.marketplace.kernel.value,'paymentToken() view returns(address)',block));
  if('value'in report.marketplace.evaluator)report.marketplace.evaluatorCode=await safe(push.getCode({address:report.marketplace.evaluator.value,blockNumber:block}).then(code=>({bytes:((code||'0x').length-2)/2,hash:keccak256(code||'0x')})));
  for(const chain of ['eip155:11155111','eip155:84532','eip155:421614','eip155:97']){
    const result={chain,sdkFactory:CEA_FACTORY_ADDRESSES[chain]};
    const chainHash=keccak256(stringToHex(chain));
    const [registered,derived]=await Promise.all([safe(read(push,market,'ceaDeployment(bytes32) view returns(address,address)',block,[chainHash])),safe(read(push,market,'computeCEA(address,bytes32) view returns(address)',block,[sampleWallet,chainHash]))]);
    result.marketplaceDeployment=registered;result.marketplaceCEA=derived;
    const ext=client(CHAIN_INFO[chain].defaultRPC);
    const extBlock=await safe(ext.getBlockNumber());result.externalBlock=extBlock;
    if('value'in extBlock){
      const b=extBlock.value;
      const [vault,gateway,implementation,cea]=await Promise.all([
        safe(read(ext,VAULT_ADDRESSES[chain],'CEAFactory() view returns(address)',b)),
        safe(read(ext,CHAIN_INFO[chain].lockerContract,'CEA_FACTORY() view returns(address)',b)),
        safe(read(ext,result.sdkFactory,'CEA_PROXY_IMPLEMENTATION() view returns(address)',b)),
        safe(read(ext,result.sdkFactory,'computeCEA(address) view returns(address)',b,[sampleWallet])),
      ]);
      Object.assign(result,{vaultFactory:vault,gatewayFactory:gateway,sdkImplementation:implementation,sdkCEA:cea});
      result.matches = [registered,derived,vault,gateway,implementation,cea].every(x=>'value'in x) && same(result.sdkFactory,registered.value[0]) && same(result.sdkFactory,vault.value) && same(result.sdkFactory,gateway.value) && same(implementation.value,registered.value[1]) && same(cea.value,derived.value);
    }else result.matches=false;
    report.cea.push(result);
  }
  const oldSchema=parseAbiParameters('(uint64,uint64,(string,string,uint16,address,bytes4,bytes,bytes,uint8[],uint8)[],(uint8[],uint8[],uint8,uint8,int256)[],(uint8,uint8,uint8[],uint8)[],uint8,bytes32)');
  for(const [name,stack]of Object.entries(stacks)){
    const state={...stack,getters:{},jobs:[]};
    const queries=[['kernelToken',stack.kernel,'paymentToken() view returns(address)'],['jobCounter',stack.kernel,'jobCounter() view returns(uint256)'],['hookKernel',stack.hook,'KERNEL() view returns(address)'],['hookEvaluator',stack.hook,'EVALUATOR() view returns(address)'],['agwFactory',stack.hook,'AGW_FACTORY() view returns(address)'],['sessionEngine',stack.hook,'SESSION_ENGINE() view returns(address)'],['evaluatorKernel',stack.evaluator,'KERNEL() view returns(address)'],['evaluatorHook',stack.evaluator,'HOOK() view returns(address)']];
    for(const [key,address,signature]of queries)state.getters[key]=await safe(read(push,address,signature,block));
    const counter=state.getters.jobCounter;
    if('value'in counter)for(let id=1n;id<=counter.value&&id<=4n;id++){
      const raw=await safe(push.readContract({address:stack.kernel,abi:KERNEL_READ_ABI,functionName:'getJob',args:[id],blockNumber:block}));
      if('error'in raw){state.jobs.push({id,error:raw.error});continue;}
      const bytes=raw.value.description,item={id,status:raw.value.status,descriptionHash:keccak256(bytes)};
      try{const value=decodeAbiParameters(oldSchema,bytes);item.timingFirstCanonical=encodeAbiParameters(oldSchema,value).toLowerCase()===bytes.toLowerCase();item.reads=value[0][2].length;}catch{item.timingFirstCanonical=false;}
      try{decodePrePostJobSpec(bytes,{format:'spec'});item.currentProfileCanonical=true;}catch{item.currentProfileCanonical=false;}
      state.jobs.push(item);
    }
    report.stacks[name]=state;
  }
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,serialize(report));
  if(report.cea.some(row=>!row.matches)||Object.values(report.marketplace).some(value=>value&&typeof value==='object'&&'error'in value)||Object.values(report.stacks).some(stack=>Object.values(stack.getters).some(value=>'error'in value)||stack.jobs.some(job=>'error'in job)))process.exitCode=1;
  console.log(serialize({output:out,block,cea:report.cea.map(r=>({chain:r.chain,matches:r.matches})),marketplace:report.marketplace,stacks:Object.fromEntries(Object.entries(report.stacks).map(([k,s])=>[k,{getters:s.getters,jobs:s.jobs}]))}));
}
main().catch(error=>{console.error(error.shortMessage||error.message);process.exitCode=1;});
