/**
 * Scenario 2 — funding and bounded gateway allowance are ordinary sends,
 * separate from create, and wallet PC is separate from signer gas.
 */
import { encodeFunctionData, erc20Abi, parseEther, type Address, type Hex } from 'viem';
import { CHAIN } from '../../src/lib/constants/enums';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { AGW_E2E_ENABLED, evmClient, setupAgw, type AgwFixture } from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;

d('agw funding', () => {
  let f: AgwFixture;
  let wallet: Address;
  beforeAll(async () => {
    f = await setupAgw();
    wallet = (await f.owner.agentic.create('e2e-funding', { rules: [] })).wallet;
  }, 300_000);
  afterAll(() => f?.teardown());

  it('1. wallet PC is funded by an ordinary send and is separate from the signer balance', async () => {
    const signerBefore = await f.push.getBalance({ address: f.ownerAddress });
    await f.fundPC(wallet, parseEther('0.01'));
    expect(await f.push.getBalance({ address: wallet })).toBe(parseEther('0.01'));
    expect(await f.push.getBalance({ address: f.ownerAddress })).toBeLessThan(signerBefore);
  });

  it('2. owner sets and removes a bounded gateway allowance through the owner door', async () => {
    const token = getNativePRC20ForChain(CHAIN.ETHEREUM_SEPOLIA, f.manifest.network);
    const ownerAgw = await evmClient(process.env['PUSH_PRIVATE_KEY'] as Hex, CHAIN.PUSH_TESTNET_DONUT, f.manifest.network, wallet);
    const allowance = () =>
      f.push.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [wallet, f.manifest.addresses.gateway] });
    const approve = (amount: bigint) =>
      ownerAgw.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [f.manifest.addresses.gateway, amount] }),
      });
    const set = await approve(BigInt(1000));
    expect((await set.wait()).status).toBe(1);
    expect(set.from).toBe(wallet);
    expect(set.agentic?.door).toBe('owner');
    expect(await allowance()).toBe(BigInt(1000));
    await (await approve(BigInt(0))).wait();
    expect(await allowance()).toBe(BigInt(0));
    f.evidence('allowance-set-remove', { wallet, token, setTx: set.hash });
  });
});
