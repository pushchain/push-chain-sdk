/** Bypass SDK validation to verify the deployed URP refuses the same mutations. eth_call only. */
import { decodeFunctionData, encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem';
import { UNIVERSAL_GATEWAY_PC } from '../../src/lib/constants/abi';
import { v5, type Call } from '../../src/lib/agentic/contracts/v5';
import { parseAgwSvmPayload, encodeAgwSvmPayload } from '../../src/lib/agentic/execution/svm-payload';
import { decodeAgenticRevert } from '../../src/lib/agentic/revert';

export async function probeSvmWirePolicies(push: PublicClient, input: {
  from: Address; wallet: Address; rulesId: Hex; call: Call; blockNumber: bigint;
}) {
  const decodedCall = decodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, data: input.call.data });
  if (decodedCall.functionName !== 'sendUniversalTxOutbound') throw new Error('Expected a gateway outbound request');
  const request = decodedCall.args[0];
  const parsed = parseAgwSvmPayload(request.payload);
  const observations = [];
  for (const kind of ['account-pin', 'instruction-data-pin'] as const) {
    const accounts = parsed.accounts.map((account) => ({ ...account }));
    const data = new Uint8Array(parsed.instructionData);
    if (kind === 'account-pin') accounts[2].pubkey = accounts[1].pubkey;
    else {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      view.setBigUint64(8, view.getBigUint64(8, true) + BigInt(1), true);
    }
    const altered = { ...request, payload: encodeAgwSvmPayload(parsed.program, accounts, data) };
    const packet = v5.encodeExecuteAsAgent(input.rulesId, { ...input.call,
      data: encodeFunctionData({ abi: UNIVERSAL_GATEWAY_PC, functionName: 'sendUniversalTxOutbound', args: [altered] }) });
    let decoded;
    try { await push.call({ account: input.from, to: input.wallet, data: packet, blockNumber: input.blockNumber }); }
    catch (error) { decoded = decodeAgenticRevert(error); }
    if (!decoded?.name?.includes('Svm')) throw new Error(`Expected a decoded SVM policy refusal for ${kind}, got ${decoded?.name ?? 'no decoded refusal'}`);
    observations.push({ kind, reverted: true, decoded });
  }
  return { chainId: 42101, block: input.blockNumber.toString(), observations, transactionsSent: 0 };
}
