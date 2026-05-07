import 'dotenv/config';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

const CEA_FILE3 = new PublicKey('XSfc6oBtrLbc8F3AgyJgbDpdBFh5GprjxsSLN6hmjyA');
const CEA_FILE4 = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');

async function main() {
  const sk = process.env['SOLANA_PRIVATE_KEY'];
  if (!sk) throw new Error('SOLANA_PRIVATE_KEY not set');
  const rpcUrl = process.env['SOLANA_RPC_URL'] || 'https://api.devnet.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');

  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(bs58.decode(sk));
  } catch {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(sk)));
  }

  console.log(`Solana signer: ${kp.publicKey.toBase58()}`);
  const lam = await conn.getBalance(kp.publicKey);
  console.log(`Signer SOL:    ${lam / LAMPORTS_PER_SOL} SOL  (${lam} lamports)`);

  for (const cea of [
    { label: 'CEA file 3 (UEA 0x4A70...)', pk: CEA_FILE3 },
    { label: 'CEA file 4 (EOA 0xBa8F...)', pk: CEA_FILE4 },
  ]) {
    const sol = await conn.getBalance(cea.pk);
    console.log(`${cea.label.padEnd(28)} ${cea.pk.toBase58()}  ${sol / LAMPORTS_PER_SOL} SOL`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
