import { MetamaskProvider } from './metamask';
import { ChainType } from '../../../types/wallet.types';

const CHAIN_ID_HEX = '0xaa36a7'; // sepolia (11155111)

/**
 * A provider double that models the real EIP-3326 / EIP-3085 handshake:
 * switching to an unknown chain rejects with 4902, adding it registers the
 * chain but does NOT switch, and the chain is only active after an explicit
 * `wallet_switchEthereumChain`.
 */
function makeProvider(opts: { switchErrorOnFirst?: boolean } = {}) {
  const added: string[] = [];
  const switched: string[] = [];
  let current = '0x1';
  let firstSwitch = true;

  const request = jest.fn(async ({ method, params }: any) => {
    if (method === 'eth_chainId') return current;
    if (method === 'wallet_switchEthereumChain') {
      const id = params[0].chainId;
      if (firstSwitch && opts.switchErrorOnFirst !== false) {
        firstSwitch = false;
        const err: any = new Error('Unrecognized chain ID');
        err.code = 4902;
        throw err;
      }
      switched.push(id);
      current = id;
      return null;
    }
    if (method === 'wallet_addEthereumChain') {
      added.push(params[0].chainId);
      return null;
    }
    if (method === 'eth_requestAccounts') {
      return ['0x1111111111111111111111111111111111111111'];
    }
    throw new Error(`unexpected method ${method}`);
  });

  return { request, added, switched, currentChainId: () => current };
}

function providerWith(getProvider: () => any) {
  const p = new MetamaskProvider() as any;
  p.getProvider = getProvider;
  return p;
}

describe('MetamaskProvider.switchNetwork', () => {
  it('switches again after adding an unknown chain', async () => {
    const mock = makeProvider();
    const provider = providerWith(() => mock);

    await provider.switchNetwork(ChainType.ETHEREUM);

    expect(mock.added).toEqual([CHAIN_ID_HEX]);
    // EIP-3085 add does not switch; without a second switch the wallet is
    // still on the old chain and the next transaction goes to the wrong network.
    expect(mock.switched).toEqual([CHAIN_ID_HEX]);
    expect(mock.currentChainId()).toBe(CHAIN_ID_HEX);
  });

  it('passes blockExplorerUrls as an array', async () => {
    const mock = makeProvider();
    const provider = providerWith(() => mock);

    await provider.switchNetwork(ChainType.ETHEREUM);

    const add = mock.request.mock.calls.find(
      ([a]: any) => a.method === 'wallet_addEthereumChain'
    );
    const params = add![0].params[0];
    // EIP-3085 declares blockExplorerUrls as string[]; a bare string is rejected.
    expect(Array.isArray(params.blockExplorerUrls)).toBe(true);
    expect(params.blockExplorerUrls).toEqual(['https://sepolia.etherscan.io']);
  });

  it('does not call add when the wallet is already on the chain', async () => {
    const mock = makeProvider({ switchErrorOnFirst: false });
    const provider = providerWith(() => mock);

    await provider.switchNetwork(ChainType.ETHEREUM);

    expect(mock.added).toEqual([]);
    expect(mock.switched).toEqual([CHAIN_ID_HEX]);
  });
});
