/** Funds-only SPL delivery through the public AGW owner path on Donut/devnet. */
import '@e2e/shared/setup';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { encodeFunctionData, erc20Abi, parseEther, type Hex } from 'viem';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { getPRC20Address } from '../../src/lib/universal/prc20-address';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import {
  AGW_E2E_ENABLED,
  evmClient,
  setupAgw,
  type AgwFixture,
} from './_fixture';
import { loadAgwManifest } from './_manifest';
import {
  inspectSvmWirePrograms,
  svmWireConnection,
} from '@e2e/shared/agw-svm-preflight';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const TOKEN_PROGRAM = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);
const ATA_PROGRAM = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);
const amount = BigInt(1000); // 0.001 USDT; fixture funding is bounded to this.

d('agw svm spl transfer', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    if (loadAgwManifest().network !== PUSH_NETWORK.TESTNET_DONUT)
      throw new Error('SPL fixture requires Donut');
    await inspectSvmWirePrograms(svmWireConnection());
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. owner funds-only SPL delivery credits the recipient ATA and preserves burn, allowance and replay', async () => {
    const sol = svmWireConnection(),
      raw = process.env['SOLANA_PRIVATE_KEY'];
    if (!raw) throw new Error('SOLANA_PRIVATE_KEY is required');
    let kp: Keypair;
    try {
      kp = Keypair.fromSecretKey(bs58.decode(raw));
    } catch {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    const recipient = kp.publicKey,
      asset = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;
    const mint = new PublicKey(asset.address);
    const mintInfo = await sol.getAccountInfo(mint);
    if (!mintInfo?.owner.equals(TOKEN_PROGRAM))
      throw new Error('Fixture mint is not a standard SPL mint');
    const ata = PublicKey.findProgramAddressSync(
      [recipient.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
      ATA_PROGRAM
    )[0];
    const recipientBalance = async () => {
      const info = await sol.getAccountInfo(ata);
      if (!info) return BigInt(0);
      if (!info.owner.equals(TOKEN_PROGRAM))
        throw new Error('Recipient ATA has unexpected owner');
      return BigInt((await sol.getTokenAccountBalance(ata)).value.amount);
    };
    const token = getPRC20Address(
      { chain: CHAIN.SOLANA_DEVNET, address: asset.address },
      { network: f.manifest.network }
    ).address;
    if (
      (await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [f.ownerAddress],
      })) < amount
    )
      throw new Error('Insufficient mapped SPL fixture funds');
    if (
      (await f.push.getBalance({ address: f.ownerAddress })) < parseEther('22')
    )
      throw new Error('Insufficient bounded PC fixture funds');
    const made = await f.owner.agentic.create('v5-spl-owner-transfer', {
      rules: [],
    });
    await f.fundPC(made.wallet, parseEther('21'));
    await (
      await f.owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [made.wallet, amount],
        }),
      })
    ).wait();
    const owner = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      made.wallet
    );
    await (
      await owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [f.manifest.addresses.gateway, amount],
        }),
      })
    ).wait();
    const beforeRecipient = await recipientBalance();
    const beforeCheckpoints = await f.push.readContract({
      address: made.wallet,
      abi: v5.abis.wallet,
      functionName: 'checkpointCount',
    });
    const tx = await owner.universal.sendTransaction({
      to: { chain: CHAIN.SOLANA_DEVNET, address: recipient.toBase58() },
      funds: { token: asset, amount },
      gasLimit: BigInt(0),
    });
    expect(tx.value).toBe(BigInt(0));
    expect(tx.agentic).toMatchObject({
      door: 'owner',
      destinationTransfer: {
        recipient: `0x${recipient.toBuffer().toString('hex')}`,
        token,
        amount,
      },
    });
    expect(tx.agentic?.destinationInstruction).toBeUndefined();
    f.evidence('v5-spl-owner-submitted', {
      wallet: made.wallet,
      hash: tx.hash,
      mint: mint.toBase58(),
      recipient: recipient.toBase58(),
      ata: ata.toBase58(),
      amount,
    });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.externalStatus).toBe('success');
    expect(receipt.from).toBe(made.wallet);
    expect(await recipientBalance()).toBe(beforeRecipient + amount);
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [made.wallet],
      })
    ).toBe(BigInt(0));
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [made.wallet, f.manifest.addresses.gateway],
      })
    ).toBe(BigInt(0));
    expect(
      await f.push.readContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'checkpointCount',
      })
    ).toBe(beforeCheckpoints + BigInt(1));
    let external = await sol.getParsedTransaction(receipt.externalTxHash!, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    for (let retry = 0; !external && retry < 5; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      external = await sol.getParsedTransaction(receipt.externalTxHash!, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    }
    expect(external?.meta?.err).toBeNull();
    const accountIndex = external?.transaction.message.accountKeys.findIndex(
      (entry) => entry.pubkey.equals(ata)
    );
    expect(accountIndex).toBeGreaterThanOrEqual(0);
    const prior = external?.meta?.preTokenBalances?.find(
      (balance) =>
        balance.accountIndex === accountIndex &&
        balance.mint === mint.toBase58()
    );
    const credited = external?.meta?.postTokenBalances?.find(
      (balance) =>
        balance.accountIndex === accountIndex &&
        balance.mint === mint.toBase58()
    );
    expect(credited?.owner).toBe(recipient.toBase58());
    expect(
      BigInt(credited?.uiTokenAmount.amount ?? '0') -
        BigInt(prior?.uiTokenAmount.amount ?? '0')
    ).toBe(amount);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(made.wallet);
    expect(replay.to).toBe(tx.to);
    expect(replay.value).toBe(BigInt(0));
    expect(replay.agentic?.destinationTransfer).toEqual(
      tx.agentic?.destinationTransfer
    );
    expect(
      (await replay.wait({ outboundTimeoutMs: 600_000 })).externalTxHash
    ).toBe(receipt.externalTxHash);
    f.evidence('v5-spl-owner-delivered', {
      wallet: made.wallet,
      hash: tx.hash,
      destinationHash: receipt.externalTxHash,
      mint: mint.toBase58(),
      recipient: recipient.toBase58(),
      ata: ata.toBase58(),
      beforeRecipient,
      afterRecipient: await recipientBalance(),
      amount,
    });
  }, 900_000);
});
