/**
 * Scenario 9 — external-key agents act through the UEA for their actual
 * origin chain; first-use vs subsequent gas. Solana-ORIGIN agents are covered
 * here on a Push destination; Solana-DESTINATION rules are a separate,
 * capability-gated feature (see multi-asset-svm.spec.ts).
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  createPublicClient,
  createWalletClient,
  fallback,
  getAddress,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { PushChain } from '../../src';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { createProgressTracker } from '@e2e/shared/progress-tracker';
import {
  AGW_E2E_ENABLED,
  evmClient,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const SINK = getAddress('0x000000000000000000000000000000000000dEaD');

async function ueaOf(address: string, chain: CHAIN): Promise<Address> {
  const r = await PushChain.utils.account.deriveExecutorAccount(
    PushChain.utils.account.toUniversal(address, { chain }),
    {
      skipNetworkCheck: true,
    }
  );
  return getAddress(r.address);
}

d('agw identity', () => {
  let f: AgwFixture;
  beforeAll(async () => {
    f = await setupAgw();
  }, 300_000);
  afterAll(() => f?.teardown());

  const walletFor = async (agent: Address) => {
    const created = await f.owner.agentic.create('e2e-identity', {
      rules: [
        {
          agent,
          target: SINK,
          selector: 'value-only',
          validUntil: inSeconds(3600),
          maxValuePerCall: BigInt(1000),
          maxValueTotal: BigInt(10_000),
        },
      ],
    });
    await f.fundPC(created.wallet, parseEther('0.001'));
    return created.wallet;
  };

  it('1. an EVM key on Sepolia acts through its Sepolia UEA; origin and account status stay signer-scoped', async () => {
    const key = process.env['EVM_PRIVATE_KEY'] as Hex;
    if (!key) throw new Error('EVM_PRIVATE_KEY is required');
    const uea = await ueaOf(
      privateKeyToAccount(key).address,
      CHAIN.ETHEREUM_SEPOLIA
    );
    const wallet = await walletFor(uea);
    const agent = await evmClient(
      key,
      CHAIN.ETHEREUM_SEPOLIA,
      f.manifest.network,
      wallet
    );
    expect(agent.universal.account).toBe(wallet);
    expect(agent.universal.origin.chain).toBe(CHAIN.ETHEREUM_SEPOLIA);
    expect((await agent.getAccountStatus()).uea.deployed).toBe(true);
    const tx = await agent.universal.sendTransaction({
      to: SINK,
      value: BigInt(1000),
    });
    expect((await tx.wait()).status).toBe(1);
    expect(tx.from).toBe(wallet);
    expect(tx.origin.startsWith('eip155:11155111:')).toBe(true);
    f.evidence('external-evm-agent', { wallet, uea, tx: tx.hash });
  }, 600_000);

  it('2. first use of an undeployed external UEA takes the one-time fee lock; the next action pays from the UEA', async () => {
    const key = generatePrivateKey();
    const addr = privateKeyToAccount(key).address;
    const transport = fallback(
      CHAIN_INFO[CHAIN.ETHEREUM_SEPOLIA].defaultRPC.map((url) => http(url))
    );
    const master = createWalletClient({
      account: privateKeyToAccount(process.env['EVM_PRIVATE_KEY'] as Hex),
      chain: sepolia,
      transport,
    });
    const origin = createPublicClient({ chain: sepolia, transport });
    const funded = await master.sendTransaction({
      to: addr,
      value: parseEther(process.env['AGW_E2E_FIRST_USE_ETH'] ?? '0.003'),
      account: master.account!,
      chain: sepolia,
    });
    await origin.waitForTransactionReceipt({ hash: funded });
    const uea = await ueaOf(addr, CHAIN.ETHEREUM_SEPOLIA);
    const wallet = await walletFor(uea);
    const first = createProgressTracker();
    const agent = await evmClient(
      key,
      CHAIN.ETHEREUM_SEPOLIA,
      f.manifest.network,
      wallet,
      first.hook as (e: unknown) => void
    );
    await (
      await agent.universal.sendTransaction({ to: SINK, value: BigInt(1) })
    ).wait();
    expect(first.hasEvent('SEND-TX-105-01')).toBe(true);
    const second = createProgressTracker();
    await (
      await agent.universal.sendTransaction(
        { to: SINK, value: BigInt(1) },
        { progressHook: second.hook }
      )
    ).wait();
    expect(second.hasEvent('SEND-TX-105-01')).toBe(false);
    f.evidence('first-use-uea', { wallet, uea });
  }, 900_000);

  it('3. a Solana-origin key acts through its Solana UEA on a Push destination', async () => {
    const raw = process.env['SOLANA_PRIVATE_KEY'];
    if (!raw) throw new Error('SOLANA_PRIVATE_KEY is required');
    const kp = Keypair.fromSecretKey(bs58.decode(raw));
    const uea = await ueaOf(kp.publicKey.toBase58(), CHAIN.SOLANA_DEVNET);
    const wallet = await walletFor(uea);
    const signer = await PushChain.utils.signer.toUniversalFromKeypair(kp, {
      chain: CHAIN.SOLANA_DEVNET,
      library: PushChain.CONSTANTS.LIBRARY.SOLANA_WEB3JS,
    });
    const agent = await PushChain.initialize(signer, {
      network: f.manifest.network,
      agenticWallet: wallet,
    });
    const tx = await agent.universal.sendTransaction({
      to: SINK,
      value: BigInt(1),
    });
    expect((await tx.wait()).status).toBe(1);
    expect(tx.from).toBe(wallet);
    expect(tx.origin.startsWith('solana:')).toBe(true);
    f.evidence('solana-origin-agent', { wallet, uea, tx: tx.hash });
  }, 600_000);
});
