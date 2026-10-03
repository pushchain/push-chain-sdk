/**
 * Scenarios 3 and 4 — native owner and agent execution with independent
 * state checks, and unauthorized / revoked / expired / over-cap failures with
 * unchanged protected state.
 */
import { getAddress, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { AgenticError, AgenticRevertError } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { AGENTIC_ERROR_CODE } from '../../src/lib/agentic/errors';
import { AGW_E2E_ENABLED, evmClient, inSeconds, setupAgw, type AgwFixture } from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const CAP = parseEther('0.001');

d('agw native', () => {
  let f: AgwFixture;
  let wallet: Address;
  let rulesId: Hex;
  const recipient = getAddress(privateKeyToAccount(generatePrivateKey()).address);

  beforeAll(async () => {
    f = await setupAgw();
    const created = await f.owner.agentic.create('e2e-native', {
      rules: [
        {
          agent: f.agentAddress,
          target: recipient,
          selector: 'value-only',
          validUntil: inSeconds(3600),
          maxValuePerCall: CAP,
          maxValueTotal: CAP * BigInt(3),
        },
      ],
    });
    wallet = created.wallet;
    rulesId = created.rulesIds[0];
    await f.fundPC(wallet, parseEther('0.01'));
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. agent door: value moves from the wallet under its rule; signer is origin, wallet is from', async () => {
    const agent = await f.agent(wallet);
    expect(agent.universal.account).toBe(wallet);
    const before = await f.push.getBalance({ address: recipient });
    const tx = await agent.universal.sendTransaction({ to: recipient, value: CAP });
    const receipt = await tx.wait();
    expect(receipt.status).toBe(1);
    expect(await f.push.getBalance({ address: recipient })).toBe(before + CAP);
    expect(tx.from).toBe(wallet);
    expect(receipt.from).toBe(wallet);
    expect(tx.origin.toLowerCase()).toContain(f.agentAddress.toLowerCase());
    expect(tx.agentic).toMatchObject({ door: 'agent', rulesId });
    f.evidence('native-agent-send', { wallet, rulesId, tx: tx.hash, block: tx.blockNumber });
  });

  it('2. owner door: value moves from the wallet without rules', async () => {
    const owner = await evmClient(process.env['PUSH_PRIVATE_KEY'] as Hex, CHAIN.PUSH_TESTNET_DONUT, f.manifest.network, wallet);
    const before = await f.push.getBalance({ address: recipient });
    const tx = await owner.universal.sendTransaction({ to: recipient, value: CAP * BigInt(2) });
    expect((await tx.wait()).status).toBe(1);
    expect(await f.push.getBalance({ address: recipient })).toBe(before + CAP * BigInt(2));
    expect(tx.agentic?.door).toBe('owner');
  });

  it('3. over-cap value reverts with the decoded policy gate and moves nothing', async () => {
    const agent = await f.agent(wallet);
    const before = await f.push.getBalance({ address: recipient });
    const err = await agent.universal.sendTransaction({ to: recipient, value: CAP + BigInt(1) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRevertError);
    expect(err.decodedError?.name).toMatch(/^PolicyCheckReverted/);
    expect(await f.push.getBalance({ address: recipient })).toBe(before);
  });

  it('4. an unrelated signer cannot initialize against the wallet', async () => {
    const stranger = generatePrivateKey();
    await expect(evmClient(stranger, CHAIN.PUSH_TESTNET_DONUT, f.manifest.network, wallet)).rejects.toMatchObject({
      code: AGENTIC_ERROR_CODE.NOT_OWNER_OR_AGENT,
    });
  });

  it('5. after revocation the agent fails before signing with NO_RULES_FOR_CHAIN', async () => {
    const agent = await f.agent(wallet);
    await (await f.owner.agentic.wallet(wallet).rules.revoke([rulesId])).wait();
    const err = await agent.universal.sendTransaction({ to: recipient, value: BigInt(1) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgenticError);
    expect(err.code).toBe(AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN);
  });

  it('6. an expired rule still identifies the agent; the send is refused on-chain', async () => {
    const created = await f.owner.agentic.create('e2e-expiry', {
      rules: [{ agent: f.agentAddress, target: recipient, selector: 'value-only', validUntil: inSeconds(45), maxValuePerCall: CAP, maxValueTotal: CAP }],
    });
    await f.fundPC(created.wallet, CAP * BigInt(2));
    await new Promise((r) => setTimeout(r, 60_000));
    const agent = await f.agent(created.wallet);
    const err = await agent.universal.sendTransaction({ to: recipient, value: BigInt(1) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgenticRevertError);
    expect(err.decodedError?.name).toBe('PolicyCheckReverted(RulesExpired)');
  }, 300_000);
});
