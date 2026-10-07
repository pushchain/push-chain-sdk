/** Public SDK labels against checked Donut v5; fresh wallets only. */
import {
  decodeEventLog,
  createWalletClient,
  http,
  getAddress,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { CHAIN_INFO, getPushViemChain } from '../../src/lib/constants/chain';
import { readNativeCounters } from '@e2e/shared/agw-state';
import { privateKeyToAccount } from 'viem/accounts';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { v5, MODE_SINGLE } from '../../src/lib/agentic/contracts/v5';
import { decodeAgenticRevert } from '../../src/lib/agentic/revert';
import {
  AGW_E2E_ENABLED,
  evmClient,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
d('agw labels', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());
  const count = (address: Address) =>
    f.push.readContract({
      address,
      abi: v5.abis.wallet,
      functionName: 'checkpointCount',
    });

  it('1. default and custom deployment labels are stored and listed', async () => {
    const empty = await f.owner.agentic.create('', { rules: [] });
    const custom = await f.owner.agentic.create('e2e-v5-custom', { rules: [] });
    expect((await f.owner.agentic.wallet(empty.wallet).info()).label).toBe(
      `AGW ${empty.index + 1}`
    );
    expect((await f.owner.agentic.wallet(custom.wallet).info()).label).toBe(
      'e2e-v5-custom'
    );
    const { wallets } = await f.owner.agentic.list();
    expect(wallets.find((w) => w.address === empty.wallet)?.label).toBe(
      `AGW ${empty.index + 1}`
    );
    expect(wallets.find((w) => w.address === custom.wallet)?.label).toBe(
      'e2e-v5-custom'
    );
    const renamed = await f.owner.agentic
      .wallet(custom.wallet)
      .setLabel('isolated-rename');
    expect((await f.owner.agentic.wallet(custom.wallet).info()).label).toBe(
      'isolated-rename'
    );
    expect((await f.owner.agentic.wallet(empty.wallet).info()).label).toBe(
      `AGW ${empty.index + 1}`
    );
    expect(await count(empty.wallet)).toBe(BigInt(0));
    expect(await count(custom.wallet)).toBe(BigInt(1));
    f.evidence('v5-label-default-custom', {
      wallets: [empty.wallet, custom.wallet],
      indices: [empty.index, custom.index],
      hashes: [empty.tx.hash, custom.tx.hash, renamed.hash],
    });
  });

  it('2. owner rename and empty reset update info/list, emit LabelSet and tick the owner door', async () => {
    const made = await f.owner.agentic.create('before', { rules: [] });
    const w = f.owner.agentic.wallet(made.wallet),
      before = await count(made.wallet),
      hook = jest.fn();
    const tx = await w.setLabel('after', { progressHook: hook });
    const receipt = await tx.wait();
    const labels = receipt.logs.flatMap((log) => {
      if (log.address.toLowerCase() !== made.wallet.toLowerCase()) return [];
      try {
        const ev = decodeEventLog({
          abi: v5.abis.wallet,
          data: log.data,
          topics: log.topics,
        });
        return ev.eventName === 'LabelSet' ? [ev.args.label] : [];
      } catch {
        return [];
      }
    });
    expect(labels).toEqual(['after']);
    expect((await w.info()).label).toBe('after');
    expect(
      (await f.owner.agentic.list()).wallets.find(
        (x) => x.address === made.wallet
      )?.label
    ).toBe('after');
    expect(await count(made.wallet)).toBe(before + BigInt(1));
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'AGENTIC-TX-199-01' })
    );
    const reset = await w.setLabel('');
    expect((await w.info()).label).toBe(`AGW ${made.index + 1}`);
    expect(await count(made.wallet)).toBe(before + BigInt(2));
    f.evidence('v5-label-rename-reset', {
      wallet: made.wallet,
      hashes: [tx.hash, reset.hash],
      checkpointsBefore: before,
      checkpointsAfter: await count(made.wallet),
    });
  });

  it('3. UTF-8 byte boundaries are accepted or rejected without changing wallet state', async () => {
    const made = await f.owner.agentic.create('🙂'.repeat(16), { rules: [] });
    const w = f.owner.agentic.wallet(made.wallet);
    await w.setLabel('a'.repeat(64));
    const before = await count(made.wallet),
      next = await f.owner.agentic.derive();
    for (const label of ['a'.repeat(65), '🙂'.repeat(17)]) {
      await expect(w.setLabel(label)).rejects.toMatchObject({
        code: 'INVALID_RULE',
      });
      await expect(
        f.owner.agentic.create(label, { rules: [] })
      ).rejects.toMatchObject({ code: 'INVALID_RULE' });
      await expect(
        f.push.simulateContract({
          address: made.wallet,
          abi: v5.abis.wallet,
          functionName: 'setLabel',
          args: [label],
          account: f.ownerAddress,
        })
      ).rejects.toThrow('LabelTooLong');
    }
    expect(await f.owner.agentic.derive()).toEqual(next);
    expect((await w.info()).label).toBe('a'.repeat(64));
    expect(await count(made.wallet)).toBe(before);
    f.evidence('v5-label-byte-boundary', {
      wallet: made.wallet,
      checkpoints: before,
      unchangedNextSlot: next.index,
    });
  });

  it('4. an agent cannot rename through either the SDK or the contract', async () => {
    const made = await f.owner.agentic.create('owner-only', {
      rules: [
        {
          agent: f.agentAddress,
          target: f.ownerAddress,
          selector: 'value-only',
          validUntil: inSeconds(3600),
        },
      ],
    });
    const before = await count(made.wallet);
    const agent = await f.agent(made.wallet);
    await expect(
      agent.agentic.wallet(made.wallet).setLabel('attack')
    ).rejects.toMatchObject({ code: 'NOT_WALLET_OWNER' });
    await expect(
      f.push.simulateContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'setLabel',
        args: ['attack'],
        account: f.agentAddress,
      })
    ).rejects.toThrow('CallerIsNotOwner');
    const agentDoorError = await f.push
      .simulateContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'executeAsAgent',
        args: [
          made.rulesIds[0],
          MODE_SINGLE,
          v5.packSingle({
            target: made.wallet,
            value: BigInt(0),
            data: v5.encodeSetLabel('attack'),
          }),
        ],
        account: f.agentAddress,
      })
      .then(
        () => undefined,
        (error: unknown) => error
      );
    // Normal grants cannot authorize wallet-self: the engine rejects the
    // absent action policy before the wallet's additional dispatch guard.
    expect(decodeAgenticRevert(agentDoorError)).toMatchObject({
      name: 'NoPoliciesSet',
    });
    expect((await f.owner.agentic.wallet(made.wallet).info()).label).toBe(
      'owner-only'
    );
    expect(await count(made.wallet)).toBe(before);
    f.evidence('v5-label-agent-refused', {
      wallet: made.wallet,
      checkpoints: before,
    });
  });

  it('5. an external EVM owner creates and renames through its UEA', async () => {
    const key = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!key) throw new Error('EVM_PRIVATE_KEY is required');
    const origin = privateKeyToAccount(key).address;
    const uea = getAddress(
      (
        await PushChain.utils.account.deriveExecutorAccount(
          PushChain.utils.account.toUniversal(origin, {
            chain: CHAIN.ETHEREUM_SEPOLIA,
          }),
          { skipNetworkCheck: true }
        )
      ).address
    );
    await f.fundPC(uea, parseEther('3'));
    const owner = await evmClient(
      key,
      CHAIN.ETHEREUM_SEPOLIA,
      f.manifest.network
    );
    const made = await owner.agentic.create('e2e-uea-before', { rules: [] });
    const w = owner.agentic.wallet(made.wallet);
    expect((await w.owner()).owner).toBe(uea);
    const before = await count(made.wallet);
    const rename = await w.setLabel('e2e-uea-after');
    expect((await w.info()).label).toBe('e2e-uea-after');
    expect(
      (await owner.agentic.list()).wallets.find(
        (entry) => entry.address === made.wallet
      )?.label
    ).toBe('e2e-uea-after');
    const reset = await w.setLabel('');
    expect((await w.info()).label).toBe(`AGW ${made.index + 1}`);
    expect(await count(made.wallet)).toBe(before + BigInt(2));
    f.evidence('v5-label-uea-owner', {
      wallet: made.wallet,
      owner: uea,
      hashes: [made.tx.hash, rename.hash, reset.hash],
      checkpointsBefore: before,
      checkpointsAfter: await count(made.wallet),
    });
  });
  it('6. a Solana-origin owner creates, renames and resets through its UEA', async () => {
    const raw = process.env['SOLANA_PRIVATE_KEY'];
    if (!raw) throw new Error('SOLANA_PRIVATE_KEY is required');
    let kp: Keypair;
    try {
      kp = Keypair.fromSecretKey(bs58.decode(raw));
    } catch {
      kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    }
    const uea = getAddress(
      (
        await PushChain.utils.account.deriveExecutorAccount(
          PushChain.utils.account.toUniversal(kp.publicKey.toBase58(), {
            chain: CHAIN.SOLANA_DEVNET,
          }),
          { skipNetworkCheck: true }
        )
      ).address
    );
    await f.fundPC(uea, parseEther('3'));
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(kp, {
      chain: CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });
    const owner = await PushChain.initialize(signer, {
      network: f.manifest.network,
    });
    const made = await owner.agentic.create('', { rules: [] });
    const w = owner.agentic.wallet(made.wallet);
    expect((await w.info()).label).toBe(`AGW ${made.index + 1}`);
    expect((await w.owner()).owner).toBe(uea);
    const before = await count(made.wallet);
    const rename = await w.setLabel('Solana owner');
    expect((await w.info()).label).toBe('Solana owner');
    expect(
      (await owner.agentic.list()).wallets.find(
        (entry) => entry.address === made.wallet
      )?.label
    ).toBe('Solana owner');
    const reset = await w.setLabel('');
    expect((await w.info()).label).toBe(`AGW ${made.index + 1}`);
    expect(await count(made.wallet)).toBe(before + BigInt(2));
    f.evidence('v5-label-solana-owner', {
      wallet: made.wallet,
      owner: uea,
      hashes: [made.tx.hash, rename.hash, reset.hash],
      checkpointsBefore: before,
      checkpointsAfter: await count(made.wallet),
    });
  }, 600_000);

  it('7. renaming an active wallet preserves rules, spend and remaining agent budget', async () => {
    const made = await f.owner.agentic.create('active-before', {
      rules: [
        {
          agent: f.agentAddress,
          target: f.ownerAddress,
          selector: 'value-only',
          validUntil: inSeconds(3600),
          maxValuePerCall: BigInt(1),
          maxValueTotal: BigInt(2),
          maxCalls: 3,
        },
      ],
    });
    await f.fundPC(made.wallet, BigInt(10));
    const w = f.owner.agentic.wallet(made.wallet),
      agent = await f.agent(made.wallet);
    const first = await agent.universal.sendTransaction({
      to: f.ownerAddress,
      value: BigInt(1),
    });
    await first.wait();
    const ruleBefore = await w.rules.get(made.rulesIds[0]);
    const spendBefore = await readNativeCounters(
      f.push,
      f.manifest.addresses,
      made.wallet,
      made.rulesIds[0]
    );
    const checkpointsBefore = await count(made.wallet);
    const nonceBefore = await f.push.readContract({
      address: made.wallet,
      abi: v5.abis.wallet,
      functionName: 'grantNonce',
    });
    const rename = await w.setLabel('active-after');
    expect((await w.info()).label).toBe('active-after');
    expect(await w.rules.get(made.rulesIds[0])).toEqual(ruleBefore);
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        made.wallet,
        made.rulesIds[0]
      )
    ).toEqual(spendBefore);
    expect(
      await f.push.readContract({
        address: made.wallet,
        abi: v5.abis.wallet,
        functionName: 'grantNonce',
      })
    ).toBe(nonceBefore);
    expect(await count(made.wallet)).toBe(checkpointsBefore + BigInt(1));
    const second = await agent.universal.sendTransaction({
      to: f.ownerAddress,
      value: BigInt(1),
    });
    await second.wait();
    expect(second.agentic?.rulesId).toBe(made.rulesIds[0]);
    const spendAfter = await readNativeCounters(
      f.push,
      f.manifest.addresses,
      made.wallet,
      made.rulesIds[0]
    );
    expect(spendAfter).toMatchObject({ callsUsed: 2, valueSpent: BigInt(2) });
    const agentNonce = await f.push.getTransactionCount({
      address: f.agentAddress,
    });
    await expect(
      agent.universal.sendTransaction({ to: f.ownerAddress, value: BigInt(1) })
    ).rejects.toMatchObject({
      decodedError: { name: 'PolicyCheckReverted(TotalValueExceeded)' },
    });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      agentNonce
    );
    expect(
      await readNativeCounters(
        f.push,
        f.manifest.addresses,
        made.wallet,
        made.rulesIds[0]
      )
    ).toEqual(spendAfter);
    expect(await count(made.wallet)).toBe(checkpointsBefore + BigInt(1));
    f.evidence('v5-label-active-rule', {
      wallet: made.wallet,
      rulesId: made.rulesIds[0],
      hashes: [first.hash, rename.hash, second.hash],
      spendBefore,
      spendAfter,
      grantNonce: nonceBefore,
    });
  });

  it('8. a failed owner batch rolls back the earlier rename and all checkpoints', async () => {
    const made = await f.owner.agentic.create('batch-before', { rules: [] });
    const w = f.owner.agentic.wallet(made.wallet),
      before = await count(made.wallet);
    const key = process.env['PUSH_PRIVATE_KEY'] as Hex;
    const owner = await evmClient(
      key,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      made.wallet
    );
    const calls = [
      {
        to: made.wallet,
        value: BigInt(0),
        data: v5.encodeSetLabel('temporary'),
      },
      {
        to: made.wallet,
        value: BigInt(0),
        data: v5.encodeSetLabel('a'.repeat(65)),
      },
    ];
    await expect(
      owner.universal.sendTransaction({ to: made.wallet, data: calls })
    ).rejects.toMatchObject({ decodedError: { name: 'LabelTooLong' } });
    expect((await w.info()).label).toBe('batch-before');
    // The SDK refuses this during simulation. A bounded raw transaction using
    // the same SDK encoding additionally proves rollback in a mined receipt.
    const client = createWalletClient({
      account: privateKeyToAccount(key),
      chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT),
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    const hash = await client.sendTransaction({
      chain: client.chain,
      to: made.wallet,
      gas: BigInt(400_000),
      data: v5.encodeExecute(
        calls.map((call) => ({
          target: call.to,
          value: call.value,
          data: call.data,
        }))
      ),
    });
    const receipt = await f.push.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('reverted');
    expect(receipt.logs).toHaveLength(0);
    expect((await w.info()).label).toBe('batch-before');
    expect(await count(made.wallet)).toBe(before);
    f.evidence('v5-label-batch-rollback', {
      wallet: made.wallet,
      hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      status: receipt.status,
      checkpoints: before,
    });
  });
});
