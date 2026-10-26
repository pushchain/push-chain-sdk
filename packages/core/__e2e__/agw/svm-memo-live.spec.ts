/** A second Solana program through the public API: SPL Memo v2 (non-Anchor).
 * The owner door proves the gateway CPI with the wallet CEA as the signer; the
 * agent door proves a rule with a raw 8-byte data prefix plus a CEA account pin
 * is accepted, and that a different prefix is refused before broadcast.
 */
import '@e2e/shared/setup';
import { Connection, PublicKey } from '@solana/web3.js';
import { erc20Abi, parseEther, toHex, type Hex } from 'viem';
import { PushChain, CHAIN } from '../../src';
import { deriveAgwSvmCea } from '../../src/lib/agentic/codec/svm-accounts';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { AGW_E2E_ENABLED, evmClient, inSeconds, setupAgw } from './_fixture';
import { SVM_WIRE_GATEWAY } from '../shared/agw-svm-preflight';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
// The rule matches this 8-byte prefix; Memo accepts any UTF-8 after it.
const PREFIX = 'PUSHAGW:';
const OTHER = 'OTHERPFX';
const bytes = (s: string) => Array.from(Buffer.from(s, 'utf8'));
// Memo has no Anchor IDL; this one only lets the SDK place the CEA signer.
PushChain.utils.svm.registerIdl({
  address: MEMO,
  metadata: { name: 'spl_memo', version: '2.0.0', spec: '0.1.0' },
  instructions: [PREFIX, OTHER].map((p) => ({
    name: p === PREFIX ? 'memo' : 'other',
    discriminator: bytes(p),
    accounts: [{ name: 'cea_authority', signer: true }],
    args: [],
  })),
});

d('agw svm memo', () => {
  async function expectMemo(sig: string, text: string, cea: string) {
    const sol = new Connection('https://api.devnet.solana.com', 'confirmed');
    let tx = await sol.getParsedTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    for (let retry = 0; !tx && retry < 5; retry++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      tx = await sol.getParsedTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    }
    expect(tx?.meta?.err).toBeNull();
    const memo = (tx?.meta?.innerInstructions ?? [])
      .flatMap((g) => g.instructions)
      .find((ix) => ix.programId.toBase58() === MEMO);
    expect(memo && 'parsed' in memo ? memo.parsed : undefined).toBe(text);
    expect(tx?.meta?.logMessages?.join('\n')).toContain(`Signed by ${cea}`);
  }

  it('1. owner door: the gateway runs Memo with the wallet CEA as signer', async () => {
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      const made = await f.owner.agentic.create('svm-memo-owner', {
        rules: [],
      });
      await f.fundPC(made.wallet, parseEther('21'));
      const owner = await evmClient(
        process.env['PUSH_PRIVATE_KEY'] as Hex,
        CHAIN.PUSH_TESTNET_DONUT,
        f.manifest.network,
        made.wallet
      );
      const cea = new PublicKey(
        Buffer.from(
          deriveAgwSvmCea(
            made.wallet,
            `0x${new PublicKey(SVM_WIRE_GATEWAY).toBuffer().toString('hex')}`
          ).address.slice(2),
          'hex'
        )
      ).toBase58();
      const text = `${PREFIX}owner ${Date.now()}`;
      const tx = await owner.universal.sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: MEMO },
        data: toHex(text),
      });
      f.evidence('svm-memo-owner-submitted', {
        wallet: made.wallet,
        hash: tx.hash,
      });
      const receipt = await tx.wait({ outboundTimeoutMs: 180000 });
      expect(receipt.externalStatus).toBe('success');
      await expectMemo(receipt.externalTxHash!, text, cea);
      f.evidence('svm-memo-owner-delivered', {
        hash: tx.hash,
        destinationHash: receipt.externalTxHash,
      });
    } finally {
      f.teardown();
    }
  }, 600000);

  it('2. agent door: a raw-prefix rule with a CEA pin runs, another prefix is refused', async () => {
    const f = await setupAgw({ deferAgentFunding: true });
    try {
      const made = await f.owner.agentic.create('svm-memo-agent', {
        rules: [
          {
            agent: f.agentAddress,
            chainNamespace: CHAIN.SOLANA_DEVNET,
            validUntil: inSeconds(3600),
            assets: [],
            maxGasPerCall: parseEther('20'),
            allowedCalls: [
              {
                target: MEMO,
                selector: toHex(PREFIX) as `0x${string}`,
                pins: [{ account: 0, expected: 'agentic:wallet' as const }],
              },
            ],
          },
        ],
      });
      await f.fundPC(made.wallet, parseEther('21'));
      await f.fundAgent();
      const agent = await f.agent(made.wallet);
      const cea = new PublicKey(
        Buffer.from(
          deriveAgwSvmCea(
            made.wallet,
            `0x${new PublicKey(SVM_WIRE_GATEWAY).toBuffer().toString('hex')}`
          ).address.slice(2),
          'hex'
        )
      ).toBase58();
      const startNonce = await f.push.getTransactionCount({
        address: f.agentAddress,
      });
      await expect(
        agent.universal.sendTransaction({
          to: { chain: CHAIN.SOLANA_DEVNET, address: MEMO },
          data: toHex(`${OTHER}not allowed`),
        })
      ).rejects.toMatchObject({ name: 'AgenticRevertError' });
      expect(
        await f.push.getTransactionCount({ address: f.agentAddress })
      ).toBe(startNonce);
      const text = `${PREFIX}agent ${Date.now()}`;
      const tx = await agent.universal.sendTransaction({
        to: { chain: CHAIN.SOLANA_DEVNET, address: MEMO },
        data: toHex(text),
      });
      f.evidence('svm-memo-agent-submitted', {
        wallet: made.wallet,
        hash: tx.hash,
      });
      const receipt = await tx.wait({ outboundTimeoutMs: 180000 });
      expect(receipt.externalStatus).toBe('success');
      await expectMemo(receipt.externalTxHash!, text, cea);
      // A zero-amount send names the zero-cap gas token and spends nothing.
      const stored = await f.owner.agentic
        .wallet(made.wallet)
        .rules.get(made.rulesIds[0]);
      if (stored.spent?.kind !== 'universal') throw new Error('Missing spend');
      expect(stored.spent.assets.every((a) => a.spent === BigInt(0))).toBe(
        true
      );
      expect(
        await f.push.readContract({
          address: getNativePRC20ForChain(
            CHAIN.SOLANA_DEVNET,
            f.manifest.network
          ),
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [made.wallet],
        })
      ).toBe(BigInt(0));
      f.evidence('svm-memo-agent-delivered', {
        hash: tx.hash,
        destinationHash: receipt.externalTxHash,
      });
    } finally {
      f.teardown();
    }
  }, 600000);
});
