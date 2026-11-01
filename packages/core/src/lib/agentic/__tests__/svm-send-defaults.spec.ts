import { PublicKey } from '@solana/web3.js';
import { CHAIN } from '../../constants/enums';
import { sendPublicSvm } from '../execution/svm-public';
import { resetAgenticGenerations } from '../deployments';
import { ADDR, FakeChain, registerFakeGeneration } from './fake-chain';
import { mockRuntime } from './mock-runtime';

afterEach(resetAgenticGenerations);
it.each([undefined, BigInt(0), BigInt(5000)])(
  'sizes a public SVM owner transfer through the route quote, preserving explicit gas: %s',
  async (gasLimit) => {
    const gen = registerFakeGeneration();
    const fake = new FakeChain();
    fake.getBalance = async () => BigInt(10) ** BigInt(20);
    fake.readContract = async ({ functionName }) => {
      if (functionName === 'SOURCE_CHAIN_NAMESPACE') return CHAIN.SOLANA_DEVNET;
      if (functionName === 'gasTokenPRC20ByChainNamespace') return ADDR.target;
      if (functionName === 'balanceOf') return BigInt(1000000);
      throw new Error(`Unexpected read: ${functionName}`);
    };
    const quoteOutbound = jest.fn(async (_token, budget) => ({
      protocolFee: BigInt(0),
      nativeValueForGas: BigInt(10),
      gasLimitUsed: budget || BigInt(1052),
    }));
    const rt = mockRuntime(fake, {
      signer: ADDR.owner,
      resolvePrc20: () => ADDR.target,
      quoteOutbound,
      svmMetadata: {
        gateway: async () => ({
          chainNamespace: CHAIN.SOLANA_DEVNET,
          program: `0x${'22'.repeat(32)}`,
        }),
        mint: async () => {
          throw new Error('No mint read for native SOL');
        },
      },
    });
    await sendPublicSvm(
      rt,
      {
        wallet: ADDR.other,
        door: 'owner',
        signerPushAccount: ADDR.owner,
        signerOrigin: { chain: CHAIN.PUSH_TESTNET_DONUT, address: ADDR.owner },
        generation: gen,
      },
      {
        to: {
          address: PublicKey.default.toBase58(),
          chain: CHAIN.SOLANA_DEVNET,
        },
        value: BigInt(1),
        ...(gasLimit === undefined ? {} : { gasLimit }),
      }
    );
    expect(quoteOutbound).toHaveBeenCalledWith(
      ADDR.target,
      gasLimit ?? BigInt(0),
      CHAIN.SOLANA_DEVNET,
      { wallet: ADDR.other, splMintBase58: undefined, burnAmount: BigInt(1) }
    );
    expect(rt.executeMock).toHaveBeenCalledTimes(1);
  }
);
