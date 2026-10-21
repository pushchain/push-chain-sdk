// Independent read-only Solana devnet probe. No keys, no signing.
const fs = require('node:fs');
const SDK = '/Users/shoaibmohammed/Desktop/work/PUSH/push-chain-sdk';
const { Connection, PublicKey } = require(SDK + '/node_modules/@solana/web3.js');
const RPC = 'https://api.devnet.solana.com';
const SIGS = {
  'spl:first-use': 'y8hK7xQWVs4mRupJAJDRBkbt1EnVmtQNxAhPhTbvJbfULrwARFimjvygaDskPawH44dntUaq5Tq6ubDDp7592q1',
  'spl:subsequent': '3G782PfUtqv3THZGt7vH5J9xoscMMFvKwUo215J2Hoh4APYHEHMGDcKBjix6je5y3M2DhoeuENkmqWEFrJgUjmLe',
};
const PROGRAMS = {
  gatewayCFVS: 'CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS',
  gatewayDJoF_pinnedSource: 'DJoFYDpgbTfxbXBv1QYhYGc9FK4J5FUKpYXAfSkHryXp',
  testCounter_sdkFixture: '8yNqjrMnFiFbVTVQcKij8tNWWTMdFkrDf9abCGgc2sgx',
  testCounter_sourceDeclareId: '4mpHkerNsaJPp35fyT5bkoXxuEBczGq6HUKTtrzFcptx',
  testCounter_anchorToml: '9LfpvcY2CYcNWEc2ip2ZwwKivEALbF3knwimXrbLubT2',
  splMemoV2: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  splMemoV1: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  associatedToken: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
};
const CEA = 'DKbAi4YmS5EfdvKHzS2zHKSSPfgiffu3ZddXoY4N2VuX';
const CEA_ATA = 'GuKBtW2xo53yMyj915CMCziHyyz1LaGxnfZBUDRJPd9K';
const WALLET = '0xED6bFE825b8d84A1E6f4F7c9067398F8985CC372';
const err = (e) => (e && e.message || String(e)).slice(0, 300);

async function main() {
  const c = new Connection(RPC, 'confirmed');
  const out = { at: new Date().toISOString(), rpc: RPC, readOnly: true };
  out.slot = await c.getSlot();
  out.genesisHash = await c.getGenesisHash();
  out.rent = {};
  for (const n of [0, 8, 165, 82]) out.rent[n] = await c.getMinimumBalanceForRentExemption(n);
  // CEA derivation as the gateway does it: ["push_identity", wallet20] under CFVS.
  const [cea] = PublicKey.findProgramAddressSync(
    [Buffer.from('push_identity'), Buffer.from(WALLET.slice(2), 'hex')],
    new PublicKey(PROGRAMS.gatewayCFVS)
  );
  out.ceaDerived = cea.toBase58();
  out.ceaMatchesEvidence = cea.toBase58() === CEA;
  out.programs = {};
  for (const [k, id] of Object.entries(PROGRAMS)) {
    try {
      const info = await c.getAccountInfo(new PublicKey(id));
      out.programs[k] = info ? { id, executable: info.executable, owner: info.owner.toBase58(), dataLen: info.data.length } : { id, exists: false };
    } catch (e) { out.programs[k] = { id, error: err(e) }; }
  }
  out.ceaAta = {};
  try {
    const info = await c.getParsedAccountInfo(new PublicKey(CEA_ATA));
    out.ceaAta = info.value ? info.value.data : { exists: false };
  } catch (e) { out.ceaAta.error = err(e); }
  out.txs = {};
  for (const [k, sig] of Object.entries(SIGS)) {
    const r = { sig };
    try {
      const tx = await c.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (!tx) { r.missing = true; out.txs[k] = r; continue; }
      r.slot = tx.slot; r.blockTime = tx.blockTime && new Date(tx.blockTime * 1000).toISOString();
      r.err = tx.meta.err; r.fee = tx.meta.fee; r.computeUnitsConsumed = tx.meta.computeUnitsConsumed;
      r.signers = tx.transaction.message.accountKeys.filter((a) => a.signer).map((a) => a.pubkey.toBase58());
      r.programsInvoked = [...new Set([
        ...tx.transaction.message.instructions.map((i) => i.programId.toBase58()),
        ...(tx.meta.innerInstructions || []).flatMap((x) => x.instructions.map((i) => i.programId.toBase58())),
      ])];
      const tb = (arr) => (arr || []).map((b) => ({ account: tx.transaction.message.accountKeys[b.accountIndex].pubkey.toBase58(), mint: b.mint, owner: b.owner, amount: b.uiTokenAmount.amount, programId: b.programId }));
      r.preTokenBalances = tb(tx.meta.preTokenBalances);
      r.postTokenBalances = tb(tx.meta.postTokenBalances);
      r.innerTransfers = (tx.meta.innerInstructions || []).flatMap((x) => x.instructions)
        .filter((i) => i.parsed && /transfer|create|initializeAccount/i.test(i.parsed.type || ''))
        .map((i) => ({ program: i.programId.toBase58(), type: i.parsed.type, info: i.parsed.info }));
      r.logTail = (tx.meta.logMessages || []).filter((l) => /Program log|invoke|success|failed/i.test(l)).slice(0, 40);
    } catch (e) { r.error = err(e); }
    out.txs[k] = r;
  }
  fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  console.log('ok slot', out.slot);
}
main().catch((e) => { console.error(err(e)); process.exitCode = 1; });
