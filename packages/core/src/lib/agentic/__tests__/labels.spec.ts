import { decodeFunctionData, encodeErrorResult } from 'viem';
import { PUSH_NETWORK } from '../../constants/enums';
import { PROGRESS_HOOK } from '../../progress-hook/progress-hook.types';
import { v5 } from '../contracts/v5';
import { currentGeneration, resetAgenticGenerations } from '../deployments';
import { AGENTIC_ERROR_CODE } from '../errors';
import { createWallet } from '../management/create';
import { assertLabel } from '../management/label';
import { setLabel } from '../management/rules-write';
import { decodeAgwErrorData } from '../revert';
import { AgenticWalletHandle } from '../wallet';
import { ADDR, FakeChain, registerFakeGeneration } from './fake-chain';
import { mockRuntime } from './mock-runtime';

beforeEach(() => {
  registerFakeGeneration();
});
afterEach(resetAgenticGenerations);
const gen = () => currentGeneration(PUSH_NETWORK.TESTNET_DONUT);

describe('v5 wallet labels', () => {
  it('allows empty, 64 ASCII bytes and sixteen four-byte emoji without altering the label', () => {
    for (const label of ['', 'a'.repeat(64), '🙂'.repeat(16), '  label  ']) {
      expect(() => assertLabel(label)).not.toThrow();
    }
  });

  it('refuses non-strings and overlong UTF-8 labels before a create reads or signs', async () => {
    const chain = new FakeChain();
    const rt = mockRuntime(chain, { signer: ADDR.owner });
    for (const label of [null, 123, 'a'.repeat(65), '🙂'.repeat(17)]) {
      await expect(
        createWallet(rt, label as never, { rules: [] })
      ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.INVALID_RULE });
    }
    expect(rt.executeMock).not.toHaveBeenCalled();
    expect(chain.calls).toEqual([]);
  });

  it('encodes a direct reset and forwards the per-call progress hook', async () => {
    const chain = new FakeChain();
    const w = chain.addWallet(ADDR.owner, 'custom');
    const rt = mockRuntime(chain, { signer: ADDR.owner });
    const hook = jest.fn();
    const tx = await new AgenticWalletHandle(rt, w.address).setLabel('', {
      progressHook: hook,
    });
    const sent = rt.executeMock.mock.calls[0][0];
    expect(sent).toMatchObject({ to: w.address, value: BigInt(0) });
    expect(
      decodeFunctionData({ abi: v5.abis.wallet, data: sent.data })
    ).toMatchObject({ functionName: 'setLabel', args: [''] });
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROGRESS_HOOK.AGENTIC_TX_106 })
    );
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROGRESS_HOOK.AGENTIC_TX_199_01 })
    );
    expect(tx.hash).toBeTruthy();
  });

  it('refuses non-owner and read-only renames before signing', async () => {
    const chain = new FakeChain();
    const w = chain.addWallet(ADDR.owner, 'x');
    const stranger = mockRuntime(chain, { signer: ADDR.agent });
    await expect(
      setLabel(stranger, gen(), w.address, 'y')
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.NOT_WALLET_OWNER });
    const readOnly = mockRuntime(chain, { signer: ADDR.owner, readOnly: true });
    await expect(
      setLabel(readOnly, gen(), w.address, 'y')
    ).rejects.toMatchObject({ code: AGENTIC_ERROR_CODE.READ_ONLY });
    expect(stranger.executeMock).not.toHaveBeenCalled();
    expect(readOnly.executeMock).not.toHaveBeenCalled();
  });

  it('uses a direct label call for an external owner identity', async () => {
    const chain = new FakeChain();
    const w = chain.addWallet(ADDR.owner, 'x');
    const rt = mockRuntime(chain, {
      signer: ADDR.owner,
      signerIsPushNative: () => false,
    });
    await setLabel(rt, gen(), w.address, 'UEA label');
    expect(
      decodeFunctionData({
        abi: v5.abis.wallet,
        data: rt.executeMock.mock.calls[0][0].data,
      }).functionName
    ).toBe('setLabel');
  });

  it('maps the new contract length error and emits a failed operation hook', async () => {
    const chain = new FakeChain();
    const w = chain.addWallet(ADDR.owner, 'x');
    const data = encodeErrorResult({
      abi: v5.abis.wallet,
      errorName: 'LabelTooLong',
      args: [BigInt(65)],
    });
    expect(decodeAgwErrorData(data)).toMatchObject({
      name: 'LabelTooLong',
      decoded: '["65"]',
    });
    const rt = mockRuntime(chain, {
      signer: ADDR.owner,
      execute: async () => {
        throw new Error(`reverted ${data}`);
      },
    });
    await expect(setLabel(rt, gen(), w.address, 'valid')).rejects.toMatchObject(
      { decodedError: { name: 'LabelTooLong' } }
    );
    expect(rt.events.at(-1)?.id).toBe(PROGRESS_HOOK.AGENTIC_TX_199_02);
  });
});
