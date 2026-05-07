import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const USDT_SPL_MINT = new PublicKey('EiXDnrAg9ea2Q6vEPV7E5TpTU1vh41jcuZqKjU5Dc4ZF');

function deriveAta(owner: PublicKey, mint: PublicKey, allowOffCurve = false): PublicKey {
  // For PDA owners (off-curve), we still derive the ATA the same way; the
  // associated-token-program permits the owner to be off-curve. allowOffCurve
  // is purely informational.
  void allowOffCurve;
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOC_TOKEN_PROGRAM_ID
  );
  return pda;
}

async function readUsdtBal(conn: Connection, owner: PublicKey, label: string, allowOffCurve = false): Promise<bigint> {
  const ata = deriveAta(owner, USDT_SPL_MINT, allowOffCurve);
  const info = await conn.getAccountInfo(ata, 'confirmed');
  if (!info) {
    console.log(`${label}: ATA ${ata.toBase58()} — does not exist (0 USDT)`);
    return BigInt(0);
  }
  // SPL Token account layout: mint(32) | owner(32) | amount(u64 LE @64..72)
  const amountLe = info.data.subarray(64, 72);
  // u64 LE → bigint
  let amt = BigInt(0);
  for (let i = 7; i >= 0; i--) {
    amt = (amt << BigInt(8)) | BigInt(amountLe[i]);
  }
  console.log(
    `${label}: ATA ${ata.toBase58()} — ${Number(amt) / 1e6} USDT  (${amt} units)`
  );
  return amt;
}

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
  await readUsdtBal(conn, kp.publicKey, 'Signer  USDT-SPL');

  const cea3 = new PublicKey('XSfc6oBtrLbc8F3AgyJgbDpdBFh5GprjxsSLN6hmjyA');
  const cea4 = new PublicKey('CFVSincHYbETh2k7w6u1ENEkjbSLtveRCEBupKidw2VS');
  await readUsdtBal(conn, cea3, 'CEA file 3 USDT', true);
  await readUsdtBal(conn, cea4, 'CEA file 4 USDT', true);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
