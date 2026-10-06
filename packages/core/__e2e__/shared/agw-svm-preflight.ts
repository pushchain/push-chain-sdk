/** Read-only checks for the internal AGW Solana wire acceptance suite. */
import { createHash } from 'node:crypto';
import { BorshAccountsCoder, type Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { CHAIN } from '../../src/lib/constants/enums';
import gatewayIdl from '../../src/lib/constants/abi/universalGatewayV0.json';
import counterIdl from '../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';

export const SVM_WIRE_CHAIN = CHAIN.SOLANA_DEVNET;
export const SVM_WIRE_PROGRAM = counterIdl.address;
export const SVM_WIRE_GATEWAY = CHAIN_INFO[SVM_WIRE_CHAIN].lockerContract!;
export const SVM_WIRE_COUNTER = PublicKey.findProgramAddressSync(
  [Buffer.from('counter')], new PublicKey(SVM_WIRE_PROGRAM)
)[0];
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const COUNTER_DISC = Buffer.from(counterIdl.accounts.find((a) => a.name === 'Counter')!.discriminator);

export function decodeWireCounter(data: Buffer) {
  if (data.length < 48 || !data.subarray(0, 8).equals(COUNTER_DISC))
    throw new Error('Counter data does not match the selected IDL');
  return { value: data.readBigUInt64LE(8), authority: new PublicKey(data.subarray(16, 48)).toBase58() };
}

export function svmWireConnection(url = CHAIN_INFO[SVM_WIRE_CHAIN].defaultRPC[0]) {
  return new Connection(url, {
    commitment: 'confirmed',
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
  });
}

export async function inspectSvmWirePrograms(connection: Connection) {
  const genesis = await connection.getGenesisHash();
  if (`solana:${genesis.slice(0, 32)}` !== SVM_WIRE_CHAIN)
    throw new Error('Solana RPC is not the selected devnet cluster');
  const gateway = new PublicKey(SVM_WIRE_GATEWAY), program = new PublicKey(SVM_WIRE_PROGRAM);
  if (gatewayIdl.address !== gateway.toBase58()) throw new Error('Gateway registry and IDL disagree');
  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], gateway)[0];
  const keys = [gateway, program, SVM_WIRE_COUNTER, config];
  const info = await connection.getMultipleAccountsInfoAndContext(keys);
  const fingerprint = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  const programDataKeys = info.value.slice(0, 2).map((account, i) => {
    if (!account?.executable || account.owner.toBase58() !== LOADER ||
        account.data.length !== 36 || account.data.readUInt32LE(0) !== 2)
      throw new Error(`Program ${keys[i].toBase58()} is not an executable upgradeable program`);
    return new PublicKey(account.data.subarray(4, 36));
  });
  const counter = info.value[2], configuration = info.value[3];
  if (!counter || counter.executable || !counter.owner.equals(program)) throw new Error('Counter account is missing or has the wrong owner');
  const counterState = decodeWireCounter(counter.data);
  if (!configuration || configuration.executable || !configuration.owner.equals(gateway)) throw new Error('Gateway configuration is missing or has the wrong owner');
  const decoded = new BorshAccountsCoder(gatewayIdl as unknown as Idl).decode('Config', configuration.data);
  if (decoded.paused !== false) throw new Error('Gateway is paused');
  const implementations = await connection.getMultipleAccountsInfoAndContext(programDataKeys);
  const programs = implementations.value.map((account, i) => {
    if (!account || account.owner.toBase58() !== LOADER || account.data.readUInt32LE(0) !== 3 || account.data.length <= 45)
      throw new Error('ProgramData account is missing or invalid');
    return {
      address: keys[i].toBase58(), programData: programDataKeys[i].toBase58(),
      lastUpgradeSlot: account.data.readBigUInt64LE(4).toString(),
      dataLength: account.data.length, dataSha256: fingerprint(account.data),
    };
  });
  return {
    checkedAt: new Date().toISOString(), chain: SVM_WIRE_CHAIN, genesis,
    slot: info.context.slot, programDataSlot: implementations.context.slot, programs,
    gatewayConfig: { address: config.toBase58(), paused: decoded.paused, dataSha256: fingerprint(configuration.data) },
    counter: { address: SVM_WIRE_COUNTER.toBase58(), value: counterState.value.toString(), authority: counterState.authority, dataSha256: fingerprint(counter.data) },
    counterIdlSha256: fingerprint(Buffer.from(JSON.stringify(counterIdl))),
    gatewayIdlSha256: fingerprint(Buffer.from(JSON.stringify(gatewayIdl))),
  };
}
