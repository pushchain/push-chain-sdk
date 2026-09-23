import '@e2e/shared/setup';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BorshAccountsCoder, type Idl, type BN } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { bytesToHex } from 'viem';
import { PushChain } from '../../../src';
import { CHAIN } from '../../../src/lib/constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../../src/lib/constants/tokens';
import { deriveAssociatedTokenAddress } from '../../../src/lib/read-state/envelopes/svm';
import counterIdl from '../../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';
import { makePushEoaClient, pushKey, solanaKey, SLOW_PATH } from '../_shared';

const d = pushKey && solanaKey ? describe : describe.skip;
const counter = new PublicKey('6Kg1NF5RRytjGwR6USttBLEYJrqwm65xtJzdPbbFwJKg');
const idl = counterIdl as Idl;
const connection = () => new Connection(process.env['SOLANA_RPC_URL'] ?? 'https://api.devnet.solana.com', 'finalized');

d('read state › Solana automatic token and IDL account reads', () => {
  it('detects the mint program and returns the SPL balance without tokenProgram', async () => {
    const owner = Keypair.fromSecretKey(bs58.decode(solanaKey!)).publicKey;
    const mint = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT.address;
    const rpc = connection();
    const mintInfo = await rpc.getAccountInfo(new PublicKey(mint));
    expect(mintInfo).not.toBeNull();
    const ata = deriveAssociatedTokenAddress(owner, mint, mintInfo!.owner);
    const before = await rpc.getTokenAccountBalance(ata);
    const { client } = await makePushEoaClient(pushKey!);
    const prepared = await client.universal.prepareRead(owner.toBase58(), {
      chain: CHAIN.SOLANA_DEVNET, token: mint, expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(prepared.spec.account.owner).toBe(bytesToHex(ata.toBytes()));
    const batch = await client.universal.executeReads([prepared], { waitForCompletion: false });
    const [done] = await batch.wait(SLOW_PATH.wait);
    expect(done.callbackDelivered).toBe(true);
    expect(done.raw?.status).toBe(PushChain.CONSTANTS.READ.RESULT_STATUS.SUCCESS);
    const after = await rpc.getTokenAccountBalance(ata);
    expect(after.value.amount).toBe(before.value.amount);
    expect(done.value).toBe(BigInt(after.value.amount));
  }, SLOW_PATH.jestTimeoutMs);

  it('decodes a real Anchor account by discriminator and by PDA seeds, through batch, wait and resume', async () => {
    const rpc = connection();
    const before = await rpc.getAccountInfo(counter);
    expect(before?.owner.toBase58()).toBe(idl.address);
    const { client } = await makePushEoaClient(pushKey!);
    // 1. The account itself, no layout name: decoded with the layout its discriminator names.
    const inferred = await client.universal.prepareRead(counter.toBase58(), {
      chain: CHAIN.SOLANA_DEVNET, idl, expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(inferred.resultShape).toEqual({ kind: 'svmAccount', idl });
    // 2. The program id + functionName: the SDK derives the PDA from the IDL's seeds ("counter").
    const byPda = await client.universal.prepareRead(idl.address, {
      chain: CHAIN.SOLANA_DEVNET, idl, functionName: 'counter', args: [], expiryBlocks: SLOW_PATH.expiryBlocks,
    });
    expect(byPda.spec.account.owner).toBe(bytesToHex(counter.toBytes()));
    expect(byPda.resultShape).toEqual({ kind: 'svmAccount', idl, accountName: 'Counter' });

    const batch = await client.universal.executeReads([inferred, byPda], { waitForCompletion: false });
    const results = await batch.wait(SLOW_PATH.wait);
    const after = await rpc.getAccountInfo(counter);
    // This test never changes the counter. Detect concurrent external mutations.
    expect(after!.data.equals(before!.data)).toBe(true);
    const truth = new BorshAccountsCoder(idl).decode<{ value: BN; authority: PublicKey }>('Counter', after!.data);

    for (const [done, prepared] of [[results[0], inferred], [results[1], byPda]] as const) {
      expect(done.callbackDelivered).toBe(true);
      expect(done.raw?.status).toBe(PushChain.CONSTANTS.READ.RESULT_STATUS.SUCCESS);
      expect(done.outcome).toBe(PushChain.CONSTANTS.READ.OUTCOME.SUCCESS);
      expect(done.decodeError).toBeUndefined();
      expect(done.raw!.resultData).toBe(bytesToHex(after!.data));
      expect(done.decoded).toMatchObject({ kind: 'svmAccount', accountName: 'Counter' });
      for (const result of [done, await done.refresh(), await client.universal.trackRead({ requestId: done.requestId }, { resultShape: prepared.resultShape })]) {
        const value = result.value as { value: BN; authority: PublicKey };
        expect(value.value.toString()).toBe(truth.value.toString());
        expect(value.authority.toBase58()).toBe(truth.authority.toBase58());
      }
    }

    const mismatched = { ...idl, accounts: idl.accounts!.map(a => ({ ...a, discriminator: a.discriminator.map(() => 0) })) };
    const bad = await client.universal.trackRead({ requestId: results[0].requestId }, {
      resultShape: { kind: 'svmAccount', idl: mismatched },
    });
    expect(bad.value).toBeUndefined();
    expect(bad.decodeError).toMatch(/discriminator/);
    expect(bad.outcome).toBe(PushChain.CONSTANTS.READ.OUTCOME.DECODE_FAILED);
  }, SLOW_PATH.jestTimeoutMs);
});
