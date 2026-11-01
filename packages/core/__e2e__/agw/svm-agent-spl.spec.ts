/** Public agent SPL delivery, wallet ATA pin and amount enforcement on devnet.
 * Uses the verified test_counter.receive_spl harness; no third-party protocol
 * support is implied. Two sends exercise omitted gas on first/subsequent use.
 */
import '@e2e/shared/setup';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import type { Idl } from '@coral-xyz/anchor';
import { encodeFunctionData, erc20Abi, numberToHex, parseEther } from 'viem';
import { PushChain, CHAIN } from '../../src';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { getPRC20Address } from '../../src/lib/universal/prc20-address';
import { deriveAgwSvmCea } from '../../src/lib/agentic/codec/svm-accounts';
import { AGW_E2E_ENABLED, setupAgw, inSeconds } from './_fixture';
import {
  inspectSvmWirePrograms,
  svmWireConnection,
  SVM_WIRE_CHAIN,
  SVM_WIRE_GATEWAY,
  SVM_WIRE_PROGRAM,
  SVM_WIRE_COUNTER,
} from '../shared/agw-svm-preflight';
import { observeAgwGas, recordAgwPushGas } from '../shared/agw-gas-evidence';
import counterIdl from '../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';
const d = AGW_E2E_ENABLED ? describe : describe.skip;
const SPL = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const amount = BigInt(1000);
const hex = (key: PublicKey | string) =>
  `0x${new PublicKey(key).toBuffer().toString('hex')}`;
const ataFor = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), SPL.toBuffer(), mint.toBuffer()],
    ATA
  )[0];

d('agw public agent spl', () => {
  it('1. exact wallet ATA and amount constraints survive create and two omitted-gas deliveries', async () => {
    const sol = svmWireConnection();
    await inspectSvmWirePrograms(sol);
    const raw = process.env['SOLANA_PRIVATE_KEY'];
    if (!raw)
      throw new Error('SOLANA_PRIVATE_KEY is required for the owned recipient');
    let recipient: PublicKey;
    try {
      recipient = Keypair.fromSecretKey(bs58.decode(raw)).publicKey;
    } catch {
      recipient = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(raw))
      ).publicKey;
    }
    const asset = MOVEABLE_TOKEN_CONSTANTS.SOLANA_DEVNET.USDT;
    const mint = new PublicKey(asset.address),
      recipientATA = ataFor(recipient, mint);
    const info = await sol.getAccountInfo(recipientATA);
    if (!info || !info.owner.equals(SPL))
      throw new Error(
        'SPL_PREREQUISITE: owned recipient needs an existing standard USDT ATA'
      );
    const f = await setupAgw();
    try {
      const mapped = getPRC20Address({
        chain: SVM_WIRE_CHAIN,
        address: asset.address,
      });
      if (
        (await f.push.readContract({
          address: mapped.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [f.ownerAddress],
        })) <
        amount * BigInt(2)
      )
        throw new Error('SPL_PREREQUISITE: owner lacks bounded USDT PRC20');
      const rule = {
        agent: f.agentAddress,
        chainNamespace: SVM_WIRE_CHAIN,
        validUntil: inSeconds(3600),
        assets: [
          {
            token: asset.address,
            maxPerCall: amount,
            maxTotal: amount * BigInt(2),
          },
        ],
        maxGasPerCall: parseEther('20'),
        allowedCalls: [
          {
            target: SVM_WIRE_PROGRAM,
            selector: 'receive_spl(u64)' as const,
            pins: [
              { account: 0, expected: SVM_WIRE_COUNTER.toBase58() },
              {
                account: 1,
                expected: 'agentic:wallet' as const,
                token: asset.address,
              },
              { account: 2, expected: recipientATA.toBase58() },
              { account: 3, expected: 'agentic:wallet' as const },
              { account: 4, expected: SPL.toBase58() },
              { arg: 0, max: amount },
            ],
          },
        ],
      };
      const made = await f.owner.agentic.create('agent-spl-acceptance', {
        rules: [rule],
      });
      const cea = new PublicKey(
        Buffer.from(
          deriveAgwSvmCea(
            made.wallet,
            `0x${new PublicKey(SVM_WIRE_GATEWAY).toBuffer().toString('hex')}`
          ).address.slice(2),
          'hex'
        )
      );
      const ceaATA = ataFor(cea, mint);
      const record = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (!('dataPins' in record.rule))
        throw new Error('Expected a decoded Solana rule');
      expect(record.rule).toMatchObject({
        format: 'decoded',
        expectedCEA: hex(cea),
        maxGasPerCall: parseEther('20'),
        assets: [
          {
            token: hex(mint),
            maxPerCall: amount,
            maxTotal: amount * BigInt(2),
          },
        ],
      });
      // Every authored pin survives exactly; none is dropped or widened.
      expect(record.rule.ceaAccounts).toEqual([hex(cea), hex(ceaATA)]);
      expect(record.rule.programs).toEqual([
        {
          program: hex(SVM_WIRE_PROGRAM),
          discriminator: '0xb654fa2e8aa449c4',
          discriminatorLen: 8,
          dataless: false,
          maxAccounts: 255,
        },
      ]);
      expect(record.rule.pins).toEqual(
        [SVM_WIRE_COUNTER, ceaATA, recipientATA, cea, SPL].map((key, i) => ({
          ruleIndex: 0,
          accountIndex: i,
          expected: hex(key),
        }))
      );
      expect(record.rule.dataPins).toEqual([
        {
          ruleIndex: 0,
          fromEnd: false,
          offset: 8,
          offsetB: 0,
          len: 8,
          mode: 2,
          expected: numberToHex(amount, { size: 32 }),
          num: BigInt(0),
          den: BigInt(0),
        },
      ]);
      await f.fundPC(made.wallet, parseEther('41'));
      await (
        await f.owner.universal.sendTransaction({
          to: mapped.address,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [made.wallet, amount * BigInt(2)],
          }),
        })
      ).wait();
      const agent = await f.agent(made.wallet);
      const idl = JSON.parse(JSON.stringify(counterIdl)) as Idl;
      const instruction = idl.instructions.find(
        (i) => i.name === 'receive_spl'
      )!;
      Object.assign(instruction.accounts.find((a) => a.name === 'cea_ata')!, {
        address: ceaATA.toBase58(),
      });
      Object.assign(
        instruction.accounts.find((a) => a.name === 'recipient_ata')!,
        { address: recipientATA.toBase58() }
      );
      const encoded = (n: bigint, source = idl) =>
        PushChain.utils.helpers.encodeTxData({
          abi: source,
          functionName: 'receive_spl',
          args: [n],
        });
      const send = (n: bigint, source = idl, burnAmount = n) =>
        agent.universal.sendTransaction({
          to: { chain: CHAIN.SOLANA_DEVNET, address: SVM_WIRE_PROGRAM },
          data: encoded(n, source),
          funds: { token: asset, amount: burnAmount },
        });
      const startNonce = await f.push.getTransactionCount({
        address: f.agentAddress,
      });
      await expect(
        send(amount + BigInt(1), idl, BigInt(1))
      ).rejects.toMatchObject({
        name: 'AgenticRevertError',
        decodedError: { name: 'PolicyCheckReverted(SvmDataCeilingExceeded)' },
      });
      const wrong = JSON.parse(JSON.stringify(idl)) as Idl;
      Object.assign(
        wrong.instructions
          .find((i) => i.name === 'receive_spl')!
          .accounts.find((a) => a.name === 'cea_ata')!,
        { address: recipientATA.toBase58() }
      );
      await expect(send(BigInt(1), wrong)).rejects.toMatchObject({
        name: 'AgenticRevertError',
        decodedError: { name: 'PolicyCheckReverted(SvmAccountPinMismatch)' },
      });
      // Funds may only reach the pinned recipient account.
      const misdirected = JSON.parse(JSON.stringify(idl)) as Idl;
      Object.assign(
        misdirected.instructions
          .find((i) => i.name === 'receive_spl')!
          .accounts.find((a) => a.name === 'recipient_ata')!,
        {
          address: ataFor(
            new PublicKey('11111111111111111111111111111112'),
            mint
          ).toBase58(),
        }
      );
      await expect(send(BigInt(1), misdirected)).rejects.toMatchObject({
        name: 'AgenticRevertError',
        decodedError: { name: 'PolicyCheckReverted(SvmAccountPinMismatch)' },
      });
      expect(
        await f.push.getTransactionCount({ address: f.agentAddress })
      ).toBe(startNonce);
      for (const stage of ['first-use', 'subsequent']) {
        const balance = BigInt(
          (await sol.getTokenAccountBalance(recipientATA)).value.amount
        );
        const stop = observeAgwGas(agent, f, `agent-spl:${stage}`);
        try {
          const tx = await send(amount);
          f.evidence('agent-spl-submitted', {
            stage,
            wallet: made.wallet,
            cea: cea.toBase58(),
            ceaATA: ceaATA.toBase58(),
            hash: tx.hash,
          });
          const result = await tx.wait({ outboundTimeoutMs: 180000 });
          expect(result.externalStatus).toBe('success');
          expect(
            BigInt(
              (await sol.getTokenAccountBalance(recipientATA)).value.amount
            )
          ).toBe(balance + amount);
          const parsed = await sol.getParsedTransaction(
            result.externalTxHash!,
            { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
          );
          expect(parsed?.meta?.err).toBeNull();
          expect(
            parsed?.meta?.innerInstructions?.some((g) =>
              g.instructions.some(
                (ix) =>
                  'parsed' in ix &&
                  ix.program === 'spl-token' &&
                  ['transfer', 'transferChecked'].includes(ix.parsed.type) &&
                  ix.parsed.info.source === ceaATA.toBase58() &&
                  ix.parsed.info.destination === recipientATA.toBase58() &&
                  BigInt(
                    ix.parsed.info.amount ?? ix.parsed.info.tokenAmount?.amount
                  ) === amount
              )
            )
          ).toBe(true);
          await recordAgwPushGas(f, tx.hash, `agent-spl:${stage}`);
          f.evidence('agent-spl-delivered', {
            stage,
            wallet: made.wallet,
            hash: tx.hash,
            destinationHash: result.externalTxHash,
            destinationFeeLamports: parsed?.meta?.fee,
            computeUnitsConsumed: parsed?.meta?.computeUnitsConsumed,
          });
        } finally {
          stop();
        }
      }
      const updated = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (updated.spent?.kind !== 'universal')
        throw new Error('Expected per-asset spend');
      expect(updated.spent.assets[0].spent).toBe(amount * BigInt(2));
    } finally {
      f.teardown();
    }
  }, 600000);
});
