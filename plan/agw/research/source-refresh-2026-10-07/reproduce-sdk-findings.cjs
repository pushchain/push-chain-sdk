/** Read-only source-level reproductions. No RPC, signer, funding or .env use. */
const path = require('node:path');
const assert = require('node:assert/strict');
const root = process.env.AGW_REVIEW_SDK_ROOT || path.resolve(__dirname, '../../../..');
const { AgenticRevertError } = require(path.join(root, 'packages/core/src'));
const { composeAgwSvmAction } = require(path.join(root, 'packages/core/src/lib/agentic/execution/svm-outbound'));
const { encodeAgwSvmPayload, validateAgwSvmPayload } = require(path.join(root, 'packages/core/src/lib/agentic/execution/svm-payload'));
const { sendPublicSvm } = require(path.join(root, 'packages/core/src/lib/agentic/execution/svm-public'));
const { buildSvmPayloadFromParams } = require(path.join(root, 'packages/core/src/lib/orchestrator/svm-idl/build-payload'));
const hex = c => '0x' + c.repeat(32);
const program = hex('33'), token = '0x'+'55'.repeat(20);
const terms = {
 initialized:true, validUntil:1700000100, expectedCEA:hex('44'), gatewayProgram:hex('22'),
 assets:[{token,maxPerCall:5n,maxTotal:50n,spent:0n}], maxGasPerCall:10n,
 programs:[{program,discriminator:'0x0102030405060708',discriminatorLen:8,dataless:false,maxAccounts:1}],
 pins:[{ruleIndex:0,accountIndex:0,expected:hex('44')}], dataPins:[], ceaAccounts:[hex('44')],
};
const instruction = Uint8Array.from([1,2,3,4,5,6,7,8]);
const allowedPayload = encodeAgwSvmPayload(program,[{pubkey:hex('44'),isWritable:true}],instruction);
const request = {wallet:'0x'+'11'.repeat(20),gateway:'0x00000000000000000000000000000000000000c1',token,amount:1n,recipient:program,payload:allowedPayload,gasLimit:200000n,protocolFee:1n,maxPCForGas:1n};
function capture(fn) { try { fn(); throw Error('expected refusal'); } catch(e) { return { name:e.name, code:e.code, message:e.message, isAgenticRevertError:e instanceof AgenticRevertError, decodedError:e.decodedError??null, details:e.details }; } }
(async()=>{
 const expired = capture(()=>composeAgwSvmAction(request, terms, 1700000101));
 assert.equal(expired.code,'RULE_LIMIT_EXCEEDED'); assert.equal(expired.isAgenticRevertError,false); assert.equal(expired.decodedError,null);
 const payload=encodeAgwSvmPayload(program,[{pubkey:hex('66'),isWritable:true}],Uint8Array.from([1,2,3,4,5,6,7,8]));
 const wrongAccount=capture(()=>validateAgwSvmPayload(terms,program,payload));
 assert.equal(wrongAccount.details.contractError,'SvmAccountPinMismatch'); assert.equal(wrongAccount.isAgenticRevertError,false); assert.equal(wrongAccount.decodedError,null);
 const p={to:{address:program,chain:'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'},funds:{amount:1n}};
 let executions=0,ownerFundsOnly;
 try{await sendPublicSvm({execute:()=>{executions++;throw Error('must not execute');}},{wallet:'0x'+'11'.repeat(20),door:'owner',generation:{capabilities:new Set(['universalSvmRules','ownerExecute'])}},p);}catch(e){ownerFundsOnly={code:e.code,message:e.message,executions};}
 assert.equal(ownerFundsOnly.code,'INVALID_RULE');assert.equal(executions,0);
 const ordinary=buildSvmPayloadFromParams({...p,senderUea:'0x'+'11'.repeat(20)});
 assert.equal(ordinary.hasExecute,false);assert.equal(ordinary.svmPayload,'0x');
 console.log(JSON.stringify({sdkCommit:'898eda17',scope:'source-level, no transactions',expired,wrongAccount,ownerFundsOnly,ordinaryFundsOnlyPayload:ordinary},null,2));
})();
