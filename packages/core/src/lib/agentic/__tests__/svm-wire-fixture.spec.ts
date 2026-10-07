import { Connection, PublicKey, type AccountInfo } from '@solana/web3.js';
import { decodeWireCounter, inspectSvmWirePrograms, SVM_WIRE_COUNTER, SVM_WIRE_GATEWAY, SVM_WIRE_PROGRAM } from '../../../../__e2e__/shared/agw-svm-preflight';

const gateway = new PublicKey(SVM_WIRE_GATEWAY), program = new PublicKey(SVM_WIRE_PROGRAM);
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const config = PublicKey.findProgramAddressSync([Buffer.from('config')], gateway)[0];
function fixture() {
  const rows = new Map<string, AccountInfo<Buffer>>();
  [gateway, program].forEach((key, i) => {
    const programData = new PublicKey(Buffer.alloc(32, i + 1));
    const data = Buffer.alloc(36); data.writeUInt32LE(2); programData.toBuffer().copy(data, 4);
    rows.set(key.toBase58(), { data, owner: loader, executable: true, lamports: 1, rentEpoch: 0 });
    const implementation = Buffer.alloc(49); implementation.writeUInt32LE(3); implementation.writeBigUInt64LE(BigInt(42), 4);
    rows.set(programData.toBase58(), { data: implementation, owner: loader, executable: false, lamports: 1, rentEpoch: 0 });
  });
  const counter = Buffer.alloc(48); Buffer.from([255, 176, 4, 245, 188, 253, 124, 25]).copy(counter); counter.writeBigUInt64LE(BigInt(7), 8);
  rows.set(SVM_WIRE_COUNTER.toBase58(), { data: counter, owner: program, executable: false, lamports: 1, rentEpoch: 0 });
  const data = Buffer.alloc(279); Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]).copy(data);
  rows.set(config.toBase58(), { data, owner: gateway, executable: false, lamports: 1, rentEpoch: 0 });
  const rpc = {
    getGenesisHash: jest.fn().mockResolvedValue('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
    getMultipleAccountsInfoAndContext: jest.fn(async (keys: PublicKey[]) => ({ context: { slot: 99 }, value: keys.map((k) => rows.get(k.toBase58()) ?? null) })),
  };
  return { rows, rpc, connection: rpc as unknown as Connection };
}

describe('unfunded AGW SVM wire fixture gate', () => {
  it('records program fingerprints, slot and the actual IDL-decoded counter/config', async () => {
    const { connection } = fixture();
    const result = await inspectSvmWirePrograms(connection);
    expect(result.counter.value).toBe('7'); expect(result.gatewayConfig.paused).toBe(false);
    expect(result.programs).toHaveLength(2); expect(result.programs[0].lastUpgradeSlot).toBe('42');
    expect(result.programs[0].dataSha256).toMatch(/^[0-9a-f]{64}$/); expect(result.slot).toBe(99);
  });
  it('rejects an RPC for another cluster before reading account state', async () => {
    const { rpc, connection } = fixture(); rpc.getGenesisHash.mockResolvedValue('other-cluster');
    await expect(inspectSvmWirePrograms(connection)).rejects.toThrow('selected devnet');
    expect(rpc.getMultipleAccountsInfoAndContext).not.toHaveBeenCalled();
  });
  it('rejects a non-executable program before reading ProgramData', async () => {
    const { rows, rpc, connection } = fixture(); rows.get(gateway.toBase58())!.executable = false;
    await expect(inspectSvmWirePrograms(connection)).rejects.toThrow('executable upgradeable');
    expect(rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledTimes(1);
  });
  it('rejects a paused gateway using the actual Config decoder', async () => {
    const { rows, connection } = fixture(); rows.get(config.toBase58())!.data[136] = 1;
    await expect(inspectSvmWirePrograms(connection)).rejects.toThrow('paused');
  });
  it('rejects a substituted counter owner and an incompatible discriminator', async () => {
    const { rows, connection } = fixture(); rows.get(SVM_WIRE_COUNTER.toBase58())!.owner = gateway;
    await expect(inspectSvmWirePrograms(connection)).rejects.toThrow('wrong owner');
    expect(() => decodeWireCounter(Buffer.alloc(48))).toThrow('selected IDL');
    expect(() => decodeWireCounter(Buffer.alloc(8))).toThrow('selected IDL');
  });
  it('rejects missing ProgramData rather than treating program metadata as delivery proof', async () => {
    const { rows, connection } = fixture(); rows.delete(new PublicKey(Buffer.alloc(32, 1)).toBase58());
    await expect(inspectSvmWirePrograms(connection)).rejects.toThrow('ProgramData');
  });
});
