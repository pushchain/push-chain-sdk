import { PublicKey } from '@solana/web3.js';
import { CHAIN } from '../../constants/enums';
import { sendPublicSvm } from '../execution/svm-public';
import { resetAgenticGenerations } from '../deployments';
import { ADDR, FakeChain, registerFakeGeneration } from './fake-chain';
import { mockRuntime } from './mock-runtime';

const mockPrepare = jest.fn();
jest.mock('../execution/svm-send', () => ({
  ...jest.requireActual('../execution/svm-send'),
  prepareSvmAgentExecution: (...args: unknown[]) => mockPrepare(...args),
}));
jest.mock('../reads/rules', () => ({
  ...jest.requireActual('../reads/rules'),
  selectRuleForSend: async () => ({ rulesId: `0x${'ab'.repeat(32)}` }),
}));
jest.mock('../reads/svm', () => ({
  ...jest.requireActual('../reads/svm'),
  readSvmConfig: async () => ({
    config: { expectedCEA: `0x${'cc'.repeat(32)}`, assets: [] },
  }),
}));

afterEach(resetAgenticGenerations);
it.each([undefined, BigInt(0), BigInt(5000)])(
  'agent Solana sends pass gasLimit %s to route sizing unchanged, defaulting to 0',
  async (gasLimit) => {
    const gen = registerFakeGeneration();
    mockPrepare.mockReset().mockResolvedValue({
      data: '0x1234',
      instruction: {
        recipient: `0x${'22'.repeat(32)}`,
        instructionData: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        accounts: [],
      },
    });
    const rt = mockRuntime(new FakeChain(), {
      signer: ADDR.agent,
      resolvePrc20: () => ADDR.target,
      svmMetadata: {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_DEVNET,
          program: `0x${'22'.repeat(32)}`,
        }),
        mint: async () => {
          throw new Error('No mint read in this send');
        },
      },
    });
    await sendPublicSvm(
      rt,
      {
        wallet: ADDR.other,
        door: 'agent',
        signerPushAccount: ADDR.agent,
        signerOrigin: { chain: CHAIN.PUSH_TESTNET_DONUT, address: ADDR.agent },
        generation: gen,
      },
      {
        to: {
          address: PublicKey.default.toBase58(),
          chain: CHAIN.SOLANA_DEVNET,
        },
        data: '0x0102030405060708',
        funds: { token: ADDR.target as never, amount: BigInt(1) },
        ...(gasLimit === undefined ? {} : { gasLimit }),
      }
    );
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockPrepare.mock.calls[0][2]).toMatchObject({
      wallet: ADDR.other,
      amount: BigInt(1),
      gasLimit: gasLimit ?? BigInt(0),
    });
    expect(rt.executeMock).toHaveBeenCalledTimes(1);
  }
);
