import 'dotenv/config';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

async function main() {
  const sk = process.env['SOLANA_PRIVATE_KEY'];
  if (!sk) throw new Error('SOLANA_PRIVATE_KEY not set');
  const rpcUrl = process.env['SOLANA_RPC_URL'] || 'https://api.devnet.solana.com';

  const ceaArg = process.argv[2];
  const amountArg = process.argv[3];
  if (!ceaArg || !amountArg) {
    throw new Error('Usage: ts-node fund-cea-sol.ts <CEA_PUBKEY> <AMOUNT_SOL>');
  }
  const cea = new PublicKey(ceaArg);
  const lamports = Math.round(Number(amountArg) * LAMPORTS_PER_SOL);

  const conn = new Connection(rpcUrl, 'confirmed');
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(bs58.decode(sk));
  } catch {
    kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(sk)));
  }

  const signerBalBefore = await conn.getBalance(kp.publicKey);
  const ceaBalBefore = await conn.getBalance(cea);
  console.log(`Signer:        ${kp.publicKey.toBase58()}`);
  console.log(`Signer SOL:    ${signerBalBefore / LAMPORTS_PER_SOL} SOL`);
  console.log(`CEA:           ${cea.toBase58()}`);
  console.log(`CEA SOL:       ${ceaBalBefore / LAMPORTS_PER_SOL} SOL`);
  console.log(`Sending:       ${amountArg} SOL  (${lamports} lamports)`);

  if (signerBalBefore < lamports + 5_000_000) {
    throw new Error(
      `Signer SOL too low: ${signerBalBefore / LAMPORTS_PER_SOL} < ${amountArg} + 0.005 SOL fee buffer`
    );
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: cea,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
  console.log(`Tx sig:        ${sig}`);

  const ceaBalAfter = await conn.getBalance(cea);
  console.log(`CEA SOL new:   ${ceaBalAfter / LAMPORTS_PER_SOL} SOL`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
