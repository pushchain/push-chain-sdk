/**
 * Scenarios 7 and 8 — positive-amount EVM universal execution from the
 * wallet, and destination failure classification.
 *
 * Rules are created through the public v4 UniversalRule SDK path. Destination
 * receipt/replay checks remain opt-in funded live tests.
 *
 * creditRevert accounting is inert on the current executor (gap G07): a
 * destination revert after URP passed still counts the spend.
 */
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  fallback,
  http,
  parseAbi,
  parseEventLogs,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';
import { CHAIN } from '../../src/lib/constants/enums';
import { CHAIN_INFO } from '../../src/lib/constants/chain';
import { MOVEABLE_TOKEN_CONSTANTS } from '../../src/lib/constants/tokens';
import { getCEAAddress } from '../../src/lib/orchestrator/cea-utils';
import { getNativePRC20ForChain } from '../../src/lib/orchestrator/internals/helpers';
import { v4 } from '../../src/lib/agentic/contracts/v4';
import { EVM_CHAIN_FIXTURES } from '@e2e/shared/chain-fixtures';
import { COUNTER_ABI } from '@e2e/shared/outbound-helpers';
import { verifyExternalTransaction } from '@e2e/shared/external-tx-verifier';
import {
  AGW_E2E_ENABLED,
  evmClient,
  inSeconds,
  setupAgw,
  type AgwFixture,
} from './_fixture';

const d = AGW_E2E_ENABLED ? describe : describe.skip;
const SEPOLIA = CHAIN.ETHEREUM_SEPOLIA;
const counter = EVM_CHAIN_FIXTURES.find((x) => x.chain === SEPOLIA)!.contracts
  .counter as Address;
const INCREMENT = '0xd09de08a' as Hex;
const MISSING = '0xdeadbeef' as Hex; // not implemented by the counter → destination revert
const AMOUNT = BigInt(10) ** BigInt(12); // 0.000001 pETH
const MAX_PC = parseEther(process.env['AGW_E2E_MAX_PC_PER_CALL'] ?? '20');

d('agw universal evm', () => {
  let f: AgwFixture;
  let wallet: Address;
  let token: Address;
  let rulesId: Hex;
  let cea: Address;

  beforeAll(async () => {
    f = await setupAgw();
    const created = await f.owner.agentic.create('e2e-universal', {
      rules: [
        {
          agent: f.agentAddress,
          chainNamespace: SEPOLIA,
          assets: [
            {
              token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH,
              maxPerCall: AMOUNT * BigInt(2),
              maxTotal: AMOUNT * BigInt(10),
            },
          ],
          validUntil: inSeconds(3600),
          maxGasPerCall: MAX_PC,
          allowedCalls: [
            { target: counter, selector: INCREMENT },
            { target: counter, selector: MISSING },
          ],
        },
      ],
    });
    wallet = created.wallet;
    rulesId = created.rulesIds[0];
    token = getNativePRC20ForChain(SEPOLIA, f.manifest.network);
    cea = (await getCEAAddress(wallet, SEPOLIA)).cea as Address;
    // Separate funding: wallet PC for outbound fees and pETH to burn.
    await f.fundPC(wallet, MAX_PC + parseEther('1'));
    await (
      await f.owner.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [wallet, AMOUNT * BigInt(3)],
        }),
      })
    ).wait();
    // Bounded allowance through the owner door.
    const ownerAgw = await evmClient(
      process.env['PUSH_PRIVATE_KEY'] as Hex,
      CHAIN.PUSH_TESTNET_DONUT,
      f.manifest.network,
      wallet
    );
    await (
      await ownerAgw.universal.sendTransaction({
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'approve',
          args: [f.manifest.addresses.gateway, AMOUNT * BigInt(2)],
        }),
      })
    ).wait();
  }, 900_000);
  afterAll(() => f?.teardown());

  it('1. positive-amount outbound: allowance pull/burn, the wallet CEA executes on Sepolia, receipts and replay identity', async () => {
    const sep = createPublicClient({
      chain: sepolia,
      transport: fallback(
        CHAIN_INFO[SEPOLIA].defaultRPC.map((url) => http(url))
      ),
    });
    const countBefore = (await sep.readContract({
      address: counter,
      abi: COUNTER_ABI,
      functionName: 'count',
    })) as bigint;
    const balBefore = await f.push.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [wallet],
    });
    const agent = await f.agent(wallet);
    const ceaBefore = await sep.getBalance({ address: cea });
    // Explicit call array: the bridged ETH lands in the wallet's CEA and the
    // allow-listed call runs as given (a single `data` would forward the value
    // to the non-payable counter, as Route 2 does for ordinary accounts).
    const tx = await agent.universal.sendTransaction({
      to: { address: counter, chain: SEPOLIA },
      data: [{ to: counter, value: BigInt(0), data: INCREMENT }],
      funds: {
        amount: AMOUNT,
        token: MOVEABLE_TOKEN_CONSTANTS.ETHEREUM_SEPOLIA.ETH,
      },
    });
    expect(tx).toMatchObject({ from: wallet, route: 'UOA_TO_CEA' });
    expect(tx.agentic).toMatchObject({
      door: 'agent',
      rulesId,
      destinationAccount: cea,
    });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.status).toBe(1);
    expect(receipt.from).toBe(wallet);
    expect(receipt.externalTxHash).toBeTruthy();
    await verifyExternalTransaction(receipt.externalTxHash as string, SEPOLIA);
    const destinationReceipt = await sep.getTransactionReceipt({
      hash: receipt.externalTxHash as Hex,
    });
    // Attribute the call to this wallet's CEA, independently of a shared
    // counter increase. The event is emitted by CEA for each executed step.
    const executed = parseEventLogs({
      abi: parseAbi([
        'event UniversalTxExecuted(bytes32 indexed subTxId, bytes32 indexed universalTxId, address indexed originCaller, address target, bytes data)',
      ]),
      logs: destinationReceipt.logs,
    });
    expect(
      executed.some(
        (event) =>
          event.address.toLowerCase() === cea.toLowerCase() &&
          event.args.originCaller.toLowerCase() === wallet.toLowerCase() &&
          event.args.target.toLowerCase() === counter.toLowerCase() &&
          event.args.data === INCREMENT
      )
    ).toBe(true);
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [wallet],
      })
    ).toBe(balBefore - AMOUNT);
    expect(
      await f.push.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [wallet, f.manifest.addresses.gateway],
      })
    ).toBe(AMOUNT);
    expect(
      (await sep.readContract({
        address: counter,
        abi: COUNTER_ABI,
        functionName: 'count',
      })) as bigint
    ).toBeGreaterThan(countBefore);
    // Independent destination check: the wallet's own CEA received the bridged amount.
    expect(await sep.getBalance({ address: cea })).toBe(ceaBefore + AMOUNT);
    const replay = await f.owner.universal.trackTransaction(tx.hash);
    expect(replay.from).toBe(wallet);
    expect(replay.agentic).toMatchObject({ door: 'agent', rulesId });
    f.evidence('universal-outbound', {
      wallet,
      cea,
      rulesId,
      pushTx: tx.hash,
      externalTx: receipt.externalTxHash,
      amount: AMOUNT,
    });
  }, 900_000);

  it('2. destination revert is classified on the receipt; the Push leg succeeded', async () => {
    const agent = await f.agent(wallet);
    const tx = await agent.universal.sendTransaction({
      to: { address: counter, chain: SEPOLIA },
      data: MISSING,
    });
    const receipt = await tx.wait({ outboundTimeoutMs: 600_000 });
    expect(receipt.status).toBe(1);
    expect(receipt.externalStatus).toMatch(/fail|revert/i);
    f.evidence('universal-destination-revert', {
      wallet,
      pushTx: tx.hash,
      externalStatus: receipt.externalStatus,
    });
  }, 900_000);
});
