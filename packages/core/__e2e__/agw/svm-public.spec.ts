/** Public named-IDL lifecycle and destination delivery on Donut/Solana devnet. */
import '@e2e/shared/setup';
import { PushChain, type SolanaRule } from '../../src';
import type { Idl } from '@coral-xyz/anchor';
import { PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  createPublicClient,
  http,
  erc20Abi,
  encodeFunctionData,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, PUSH_NETWORK } from '../../src/lib/constants/enums';
import { CHAIN_INFO, getPushViemChain } from '../../src/lib/constants/chain';
import counterIdl from '../../src/lib/orchestrator/svm-idl/__fixtures__/test_counter.idl.json';
import { v5 } from '../../src/lib/agentic/contracts/v5';
import { setupAgw, evmClient, inSeconds, type AgwFixture } from './_fixture';
import { loadAgwManifest, verifyAgwManifest } from './_manifest';
import {
  inspectSvmWirePrograms,
  svmWireConnection,
  SVM_WIRE_CHAIN,
  SVM_WIRE_PROGRAM,
  SVM_WIRE_COUNTER,
} from '../shared/agw-svm-preflight';

const d = process.env['AGW_E2E'] === '1' ? describe : describe.skip;
const amount = BigInt(10_000),
  pc = parseEther('41');
d('agw public svm', () => {
  let f: AgwFixture,
    wallet: Address,
    id: Hex,
    token: Address,
    agent: PushChain,
    recipient: PublicKey,
    cea: PublicKey,
    idl: Idl;
  const sol = svmWireConnection();
  const rule = (): SolanaRule => ({
    agent: f.agentAddress,
    chainNamespace: SVM_WIRE_CHAIN,
    validUntil: inSeconds(3600),
    assets: [{ token: zeroAddress, maxPerCall: amount, maxTotal: amount }],
    maxGasPerCall: parseEther('20'),
    allowedInstructions: [
      {
        program: SVM_WIRE_PROGRAM,
        instruction: { idl, name: 'receive_sol' },
        accounts: [
          {
            name: 'counter',
            expected: { kind: 'address', address: SVM_WIRE_COUNTER.toBase58() },
          },
          {
            name: 'recipient',
            expected: { kind: 'address', address: recipient.toBase58() },
          },
          { name: 'cea_authority', expected: { kind: 'walletCEA' } },
          {
            name: 'system_program',
            expected: {
              kind: 'address',
              address: PublicKey.default.toBase58(),
            },
          },
        ],
        fields: [{ name: 'amount', max: amount }],
      },
    ],
  });
  const data = (value = amount, source = idl) =>
    PushChain.utils.helpers.encodeTxData({
      abi: source,
      functionName: 'receive_sol',
      args: [value],
    });
  beforeAll(async () => {
    await inspectSvmWirePrograms(sol);
    const manifest = loadAgwManifest();
    if (manifest.network !== PUSH_NETWORK.TESTNET_DONUT)
      throw new Error('Public SVM fixture requires Donut');
    if (
      parseEther(process.env['AGW_E2E_AGENT_PC'] ?? '0.5') > parseEther('0.5')
    )
      throw new Error('Agent funding exceeds fixture budget');
    const key = process.env['SOLANA_PRIVATE_KEY'];
    if (!key) throw new Error('Missing recipient identity');
    try {
      recipient = Keypair.fromSecretKey(bs58.decode(key)).publicKey;
    } catch {
      recipient = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(key))
      ).publicKey;
    }
    const recipientInfo = await sol.getAccountInfo(recipient);
    if (
      !recipientInfo ||
      recipientInfo.executable ||
      !recipientInfo.owner.equals(PublicKey.default)
    )
      throw new Error('Owned recipient must be an existing System account');
    const push = createPublicClient({
      chain: getPushViemChain(CHAIN.PUSH_TESTNET_DONUT),
      transport: http(CHAIN_INFO[CHAIN.PUSH_TESTNET_DONUT].defaultRPC[0]),
    });
    await verifyAgwManifest(push, manifest);
    const ownerKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    if (!ownerKey) throw new Error('Missing owner');
    const ownerAddress = privateKeyToAccount(ownerKey).address;
    token = await push.readContract({
      address: '0x00000000000000000000000000000000000000C0',
      abi: parseAbi([
        'function gasTokenPRC20ByChainNamespace(string) view returns (address)',
      ]),
      functionName: 'gasTokenPRC20ByChainNamespace',
      args: [SVM_WIRE_CHAIN],
    });
    if (
      (await push.getBalance({ address: ownerAddress })) <
        pc + parseEther('2') ||
      (await push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerAddress],
      })) <
        amount * BigInt(2) + BigInt(1)
    )
      throw new Error('Insufficient bounded fixture funds');
    idl = JSON.parse(JSON.stringify(counterIdl)) as Idl;
    const receive = idl.instructions.find((i) => i.name === 'receive_sol')!;
    const destination = receive.accounts.find((a) => a.name === 'recipient')!;
    Object.assign(destination, { address: recipient.toBase58() });
    f = await setupAgw();
    const made = await f.owner.agentic.create('public-idl-svm', {
      rules: [rule()],
    });
    wallet = made.wallet;
    id = made.rulesIds[0];
    const record = await f.owner.agentic.wallet(wallet).rules.get(id);
    if (!('expectedCEA' in record.rule))
      throw new Error('Missing decoded destination account');
    cea = new PublicKey(Buffer.from(record.rule.expectedCEA.slice(2), 'hex'));
    await f.fundPC(wallet, pc);
    await (
      await f.owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [wallet, amount * BigInt(2)],
        }),
      })
    ).wait();
    const owner = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      manifest.network,
      wallet
    );
    await (
      await owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [manifest.addresses.gateway, amount * BigInt(2)],
        }),
      })
    ).wait();
    agent = await f.agent(wallet);
    f.evidence('public-svm-setup', {
      wallet,
      id,
      grantHash: made.tx.hash,
      cea: cea.toBase58(),
      recipient: recipient.toBase58(),
    });
  }, 900_000);
  afterAll(() => f?.teardown());
  it('1. named IDL grant reads exact constraints and replaces atomically', async () => {
    const handle = f.owner.agentic.wallet(wallet),
      record = await handle.rules.get(id);
    expect(record).not.toHaveProperty('ref');
    expect(record.rule).toMatchObject({
      format: 'decoded',
      dataPins: [{ offset: 8, len: 8, mode: 2 }],
    });
    const count = (await handle.checkpoints()).checkpoints.length;
    const updated = await handle.rules.update({
      rules: [{ rulesId: id, rule: rule() }],
    });
    const previous = id;
    id = updated.rules[0].rulesId;
    await expect(handle.rules.get(previous)).rejects.toMatchObject({
      code: 'RULE_NOT_FOUND',
    });
    expect((await handle.checkpoints()).checkpoints.length).toBe(count + 5);
    f.evidence('public-svm-replacement', {
      wallet,
      id,
      txHash: updated.tx.hash,
    });
  });
  it('2. public send confirms actual CEA transfer and preserves replay identity', async () => {
    const tx = await agent.universal.sendTransaction({
      to: { chain: SVM_WIRE_CHAIN, address: SVM_WIRE_PROGRAM },
      value: amount,
      gasLimit: BigInt(0),
      data: data(),
    });
    f.evidence('public-svm-submitted', { wallet, id, hash: tx.hash });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.externalStatus).toBe('success');
    expect(receipt.from).toBe(wallet);
    const destination = await sol.getParsedTransaction(
      receipt.externalTxHash!,
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }
    );
    expect(destination?.meta?.err).toBeNull();
    expect(
      destination?.meta?.innerInstructions?.some((g) =>
        g.instructions.some(
          (ix) =>
            'parsed' in ix &&
            ix.program === 'system' &&
            ix.parsed.type === 'transfer' &&
            ix.parsed.info.source === cea.toBase58() &&
            ix.parsed.info.destination === recipient.toBase58() &&
            BigInt(ix.parsed.info.lamports) === amount
        )
      )
    ).toBe(true);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(wallet);
    expect(replay.agentic?.destinationInstruction).toEqual(
      tx.agentic?.destinationInstruction
    );
    expect(
      (await replay.wait({ outboundTimeoutMs: 600_000 })).externalTxHash
    ).toBe(receipt.externalTxHash);
    f.evidence('public-svm-delivered', {
      wallet,
      hash: tx.hash,
      destinationHash: receipt.externalTxHash,
      instruction: tx.agentic?.destinationInstruction,
    });
  }, 900_000);
  it('3. contract simulation maps account and data refusals without state changes', async () => {
    const config = PushChain.utils.agentic.configId(
      wallet,
      id,
      PushChain.utils.agentic.actionId(
        f.manifest.addresses.gateway,
        '0x77b86bec'
      )
    );
    const state = async () => {
      const [tokens, pcBalance, checkpoints, cfg] = await Promise.all([
        f.push.readContract({
          address: token,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [wallet],
        }),
        f.push.getBalance({ address: wallet }),
        f.push.readContract({
          address: wallet,
          abi: v5.abis.wallet,
          functionName: 'checkpointCount',
        }),
        f.push.readContract({
          address: f.manifest.addresses.rulesPolicy,
          abi: v5.abis.policy,
          functionName: 'getSvmConfig',
          args: [config, wallet],
        }),
      ]);
      return {
        tokens,
        pcBalance,
        checkpoints,
        spent: cfg.assets.map((a) => a.spent),
      };
    };
    const before = await state();
    const nonce = await f.push.getTransactionCount({ address: f.agentAddress });
    const wrong = JSON.parse(JSON.stringify(idl)) as Idl;
    Object.assign(
      wrong.instructions
        .find((i) => i.name === 'receive_sol')!
        .accounts.find((a) => a.name === 'recipient')!,
      { address: PublicKey.default.toBase58() }
    );
    await expect(
      agent.universal.sendTransaction({
        to: { chain: SVM_WIRE_CHAIN, address: SVM_WIRE_PROGRAM },
        gasLimit: BigInt(0),
        data: data(BigInt(1), wrong),
      })
    ).rejects.toMatchObject({
      name: 'AgenticRevertError',
      decodedError: { name: 'PolicyCheckReverted(SvmAccountPinMismatch)' },
    });
    await expect(
      agent.universal.sendTransaction({
        to: { chain: SVM_WIRE_CHAIN, address: SVM_WIRE_PROGRAM },
        gasLimit: BigInt(0),
        data: data(amount + BigInt(1)),
      })
    ).rejects.toMatchObject({
      name: 'AgenticRevertError',
      decodedError: { name: 'PolicyCheckReverted(SvmDataCeilingExceeded)' },
    });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      nonce
    );
    expect(await state()).toEqual(before);
    f.evidence('public-svm-contract-refusals', {
      wallet,
      id,
      agentNonce: nonce,
      state: before,
    });
  });
  it('4. public revoke removes the Solana rule and subsequent sends are refused', async () => {
    const handle = f.owner.agentic.wallet(wallet);
    await (await handle.rules.revoke([id])).wait();
    expect((await handle.rules.list()).rules).toHaveLength(0);
    await expect(
      agent.universal.sendTransaction({
        to: { chain: SVM_WIRE_CHAIN, address: SVM_WIRE_PROGRAM },
        data: data(),
      })
    ).rejects.toMatchObject({ code: 'NO_RULES_FOR_CHAIN' });
  });
  it('5. owner funds-only transfer reaches the recipient and replays with the same amount', async () => {
    const ownerKey = process.env['PUSH_PRIVATE_KEY'] as Hex;
    const sender = await evmClient(
      ownerKey,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      wallet
    );
    const before = await sol.getBalance(recipient);
    const balance = await f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    });
    const tx = await sender.universal.sendTransaction({
      to: { chain: SVM_WIRE_CHAIN, address: recipient.toBase58() },
      value: amount,
      gasLimit: BigInt(0),
    });
    f.evidence('public-svm-owner-transfer-submitted', {
      wallet,
      hash: tx.hash,
    });
    expect(tx.agentic?.door).toBe('owner');
    expect(tx.agentic?.rulesId).toBeUndefined();
    expect(tx.agentic?.destinationInstruction).toBeUndefined();
    expect(tx.agentic?.destinationTransfer).toMatchObject({ token, amount });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.externalStatus).toBe('success');
    expect(receipt.from).toBe(wallet);
    expect(await sol.getBalance(recipient)).toBe(before + Number(amount));
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet],
      })
    ).toBe(balance - amount);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.to).toBe(tx.to);
    expect(replay.data).toBe('0x');
    expect(replay.value).toBe(amount);
    expect(replay.agentic?.destinationTransfer).toEqual(
      tx.agentic?.destinationTransfer
    );
    expect(
      (await replay.wait({ outboundTimeoutMs: 600_000 })).externalTxHash
    ).toBe(receipt.externalTxHash);
    f.evidence('public-svm-owner-transfer-delivered', {
      wallet,
      hash: tx.hash,
      destinationHash: receipt.externalTxHash,
      recipient: recipient.toBase58(),
      amount,
    });
  }, 900_000);
  it('6. agents still require an instruction and owner allowance failures do not sign', async () => {
    const agentNonce = await f.push.getTransactionCount({
      address: f.agentAddress,
    });
    await expect(
      agent.universal.sendTransaction({
        to: { chain: SVM_WIRE_CHAIN, address: recipient.toBase58() },
        value: amount,
      })
    ).rejects.toMatchObject({ code: 'INVALID_RULE' });
    expect(await f.push.getTransactionCount({ address: f.agentAddress })).toBe(
      agentNonce
    );
    // Both funded sends have consumed the bounded allowance. Funding only the
    // token lets this case isolate the separate allowance guard.
    await (
      await f.owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [wallet, BigInt(1)],
        }),
      })
    ).wait();
    const sender = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      wallet
    );
    const nonce = await f.push.getTransactionCount({ address: f.ownerAddress });
    await expect(
      sender.universal.sendTransaction({
        to: { chain: SVM_WIRE_CHAIN, address: recipient.toBase58() },
        value: BigInt(1),
        gasLimit: BigInt(0),
      })
    ).rejects.toMatchObject({ code: 'GATEWAY_ALLOWANCE_INSUFFICIENT' });
    expect(await f.push.getTransactionCount({ address: f.ownerAddress })).toBe(
      nonce
    );
  });
});
