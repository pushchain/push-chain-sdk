import {
  encodeErrorResult,
  encodeFunctionData,
  getAddress,
  type Hex,
} from 'viem';
import * as core from '../../index';
import { CONSTANTS } from '../../constants';
import { PUSH_NETWORK } from '../../constants/enums';
import { UNIVERSAL_GATEWAY_PC } from '../../constants/abi';
import { PushChainExecutionError } from '../../orchestrator/internals/errors';
import { Utils } from '../../utils';
import { AGW_ABI } from '../contracts/abi/v5';
import { v5 } from '../contracts/v5';
import { resetAgenticGenerations } from '../deployments';
import { AgenticRevertError } from '../errors';
import { adaptAgenticResponse, adaptTrackedResponse } from '../response';
import { decodeAgenticRevert, decodeAgwErrorData } from '../revert';
import { ADDR, FakeChain, registerFakeGeneration, ruleId } from './fake-chain';
import { fakeResponse } from './mock-runtime';

afterEach(() => resetAgenticGenerations());

describe('response identity', () => {
  it('live adaptation keeps origin/hash/raw and records the wrapped call', () => {
    const resp = fakeResponse({
      to: ADDR.target,
      data: '0xabcd',
      from: ADDR.agent,
    });
    const origin = resp.origin;
    adaptAgenticResponse(resp, {
      wallet: ADDR.owner,
      door: 'agent',
      rulesId: ruleId(1),
      logical: { to: ADDR.other, data: '0x01', value: BigInt(2) },
    });
    expect(resp).toMatchObject({
      from: ADDR.owner,
      to: ADDR.other,
      data: '0x01',
      value: BigInt(2),
      origin,
    });
    expect(resp.raw).toMatchObject({
      from: ADDR.agent,
      to: ADDR.target,
      data: '0xabcd',
    });
    expect(resp.agentic).toMatchObject({
      rawTo: ADDR.target,
      rawData: '0xabcd',
      door: 'agent',
    });
  });

  it('replay: a tracked execute on a registered wallet is re-presented as the wallet’s call', async () => {
    registerFakeGeneration();
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w');
    const data = v5.encodeExecuteAsAgent(ruleId(4), {
      target: ADDR.target,
      value: BigInt(0),
      data: '0xd09de08a',
    });
    const tracked = await adaptTrackedResponse(
      { reader: fake, network: PUSH_NETWORK.TESTNET_DONUT },
      fakeResponse({ to: w.address, data, from: ADDR.agent })
    );
    expect(tracked).toMatchObject({
      from: w.address,
      to: ADDR.target,
      data: '0xd09de08a',
    });
    expect(tracked.agentic).toMatchObject({
      door: 'agent',
      rulesId: ruleId(4),
    });
  });

  it('replay: an outbound through the gateway restores the destination call and route', async () => {
    registerFakeGeneration();
    const fake = new FakeChain();
    const w = fake.addWallet(ADDR.owner, 'w');
    const payload = ('0x2cc2842d' +
      encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'x',
            inputs: [
              {
                type: 'tuple[]',
                components: [
                  { name: 'to', type: 'address' },
                  { name: 'value', type: 'uint256' },
                  { name: 'data', type: 'bytes' },
                ],
              },
            ],
            outputs: [],
            stateMutability: 'nonpayable',
          },
        ],
        args: [[{ to: ADDR.target, value: BigInt(0), data: '0xd09de08a' }]],
      }).slice(10)) as Hex;
    const gatewayCall = encodeFunctionData({
      abi: UNIVERSAL_GATEWAY_PC,
      functionName: 'sendUniversalTxOutbound',
      args: [
        {
          recipient: '0x',
          token: ADDR.other,
          amount: BigInt(1),
          gasLimit: BigInt(1),
          gasPrice: BigInt(0),
          maxPCForGas: BigInt(1),
          payload,
          revertRecipient: w.address,
        },
      ],
    });
    const data = v5.encodeExecuteAsAgent(ruleId(4), {
      target: ADDR.gateway,
      value: BigInt(5),
      data: gatewayCall,
    });
    const tracked = await adaptTrackedResponse(
      { reader: fake, network: PUSH_NETWORK.TESTNET_DONUT },
      fakeResponse({ to: w.address, data })
    );
    expect(tracked).toMatchObject({
      from: w.address,
      to: ADDR.target,
      data: '0xd09de08a',
      route: 'UOA_TO_CEA',
    });
    // A Push-only route inferred from an incomplete Cosmos record is replaced.
    const early = await adaptTrackedResponse(
      { reader: fake, network: PUSH_NETWORK.TESTNET_DONUT },
      fakeResponse({ to: w.address, data, route: 'UOA_TO_PUSH' })
    );
    expect(early.route).toBe('UOA_TO_CEA');
  });

  it('replay: anything not provably an AGW call is left untouched', async () => {
    const fake = new FakeChain();
    const plain = fakeResponse({ to: ADDR.target, data: '0xd09de08a' });
    expect(
      await adaptTrackedResponse(
        { reader: fake, network: PUSH_NETWORK.TESTNET_DONUT },
        plain
      )
    ).toBe(plain);
    registerFakeGeneration();
    const spoof = fakeResponse({
      to: ADDR.target,
      data: v5.encodeExecute([
        { target: ADDR.other, value: BigInt(0), data: '0x' },
      ]),
    });
    const out = await adaptTrackedResponse(
      { reader: fake, network: PUSH_NETWORK.TESTNET_DONUT },
      spoof
    );
    expect(out.from).toBe(spoof.from);
    expect(out.agentic).toBeUndefined();
  });
});

describe('revert decoding', () => {
  it('decodes AGW errors with arguments', () => {
    const data = encodeErrorResult({
      abi: AGW_ABI,
      errorName: 'CallerIsNotAgent',
      args: [ruleId(1), ADDR.other],
    });
    expect(decodeAgwErrorData(data)).toMatchObject({
      name: 'CallerIsNotAgent',
    });
  });

  it('names a truncated PolicyCheckReverted by its inner selector', () => {
    expect(
      decodeAgwErrorData(`0xf4270752${'8bb88ba1'.padEnd(64, '0')}`)
    ).toMatchObject({
      name: 'PolicyCheckReverted(CallLimitReached)',
      selector: '0xf4270752',
    });
  });

  it('finds revert data through error causes and viem-style messages', () => {
    const inner = new Error('outer', {
      cause: {
        data: encodeErrorResult({
          abi: AGW_ABI,
          errorName: 'UnsupportedExecutionMode',
        }),
      },
    });
    expect(decodeAgenticRevert(inner)?.name).toBe('UnsupportedExecutionMode');
    expect(decodeAgenticRevert(new Error('nothing here'))).toBeUndefined();
  });
  it('decodes viem simulation errors whose full revert lives in raw', () => {
    const raw = `0xf4270752${'8bb88ba1'.padEnd(64, '0')}` as Hex;
    expect(
      decodeAgenticRevert({
        message: 'Unknown signature 0xf4270752',
        cause: { raw },
      })?.name
    ).toBe('PolicyCheckReverted(CallLimitReached)');
  });
});

describe('public surface', () => {
  it('exports the AGW errors, and the base execution error for instanceof checks', () => {
    expect(core.AgenticError).toBeDefined();
    expect(new core.AgenticRevertError('x')).toBeInstanceOf(
      core.PushChainExecutionError
    );
    expect(core.PushChainExecutionError).toBe(PushChainExecutionError);
    expect(core.AGENTIC_ERROR_CODE.NO_RULES_FOR_CHAIN).toBe(
      'NO_RULES_FOR_CHAIN'
    );
    expect(new AgenticRevertError('x', { cause: 'c' }).cause).toBe('c');
  });

  it('CONSTANTS.AGENTIC carries the checked Donut v5 proxies', () => {
    expect(CONSTANTS.AGENTIC.TESTNET_DONUT).toMatchObject({
      FACTORY: '0x8137F96A50EBF41d904e3678c84c391a0D1BCcc5',
      RULES_POLICY: '0x603E7f0aF6e1aAFf46DDfb28b1e99364f8BC59af',
      ENVELOPE_VERSION: 1,
    });
    expect(Object.isFrozen(CONSTANTS.AGENTIC)).toBe(true);
  });

  it('PushChain.utils.agentic is the pure helper set', () => {
    expect(Object.keys(Utils.agentic).sort()).toEqual(
      ['actionId', 'configId', 'decodeRules'].sort()
    );
    // @ts-expect-error generation context helpers are not public
    expect(Utils.agentic.rulesId).toBeUndefined();
    // @ts-expect-error the marketplace compiler is outside AGW
    expect(Utils.agentic.compileCard).toBeUndefined();
    for (const name of [
      'rulesId',
      'deriveWallet',
      'encodeRules',
      'compileCard',
    ]) {
      expect(Utils.agentic).not.toHaveProperty(name);
    }
  });
});
