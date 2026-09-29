import { PhantomProvider } from './phantom';
import { ChainType } from '../../../types/wallet.types';

function injected() {
  return {
    request: jest.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_accounts' || method === 'eth_requestAccounts')
        return ['0x1111111111111111111111111111111111111111'];
      if (method === 'eth_chainId') return '0xaa36a7';
      if (method === 'eth_signTypedData_v4') return '0x' + 'ab'.repeat(65);
      return null;
    }),
  };
}

const typedData = {
  domain: {
    name: 'Push',
    version: '1',
    chainId: 11155111,
    verifyingContract: '0x' + '11'.repeat(20),
  },
  primaryType: 'UniversalPayload',
  types: { UniversalPayload: [] },
  message: {},
} as never;

const methods = (m: { request: { mock: { calls: any[][] } } }) =>
  m.request.mock.calls.map((c) => c[0].method);

describe('PhantomProvider.signTypedData', () => {
  afterEach(() => {
    delete (global as any).window.phantom;
    delete (global as any).window.ethereum;
  });

  it('signs through Phantom when it is the only injected EVM wallet', async () => {
    const phantomEth = injected();
    (global as any).window = { phantom: { ethereum: phantomEth } };

    const provider = new PhantomProvider();
    await provider.connect(ChainType.ETHEREUM);

    const signature = await provider.signTypedData(typedData);

    expect(signature).toHaveLength(65);
    expect(methods(phantomEth as never)).toContain('eth_signTypedData_v4');
  });

  it('does not fall through to a different wallet that owns window.ethereum', async () => {
    const phantomEth = injected();
    const otherEth = injected();
    (global as any).window = {
      phantom: { ethereum: phantomEth },
      ethereum: otherEth,
    };

    const provider = new PhantomProvider();
    await provider.connect(ChainType.ETHEREUM);

    await provider.signTypedData(typedData);

    expect(methods(phantomEth as never)).toContain('eth_signTypedData_v4');
    expect(methods(otherEth as never)).not.toContain('eth_signTypedData_v4');
  });
});
