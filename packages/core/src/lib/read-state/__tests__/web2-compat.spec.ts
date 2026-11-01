/**
 * READ.CHAIN / Web2 compatibility (AGW SDK page §4, confirmed 2026-09-28):
 * new enumerable READ.CHAIN.WEB2 = 'web2'; CHAIN.WEB2 and READ.WEB2 stay as
 * deprecated aliases; the legacy 'web2:https' literal is still accepted; the
 * wire identity the node routes on stays web2:https.
 */
import { PushChain } from '../../index';
import { CHAIN } from '../../constants/enums';
import { validateRouteParams } from '../../orchestrator/route-detector';
import { resolveDestination } from '../destination';
import { toBuildReadSpecParams, toReadDestination, toReadQuery } from '../read-params';
import type { ReadChain } from '../read-state.types';

const R = PushChain.CONSTANTS.READ;
const web2 = { web2: { extract: [{ path: '$.a', valueType: 'string' as const }] } };

describe('READ.CHAIN', () => {
  it('is an enumerable superset of CHAIN with WEB2 = "web2"', () => {
    const values = Object.values(R.CHAIN);
    for (const c of Object.values(CHAIN)) expect(values).toContain(c);
    expect(values).toContain('web2');
    expect(Object.keys(R.CHAIN)).toContain('WEB2');
    expect(R.CHAIN.ETHEREUM_SEPOLIA).toBe(CHAIN.ETHEREUM_SEPOLIA);
  });

  it('CHAIN itself still enumerates only blockchains', () => {
    expect(Object.keys(CHAIN)).not.toContain('WEB2');
    expect(CHAIN.WEB2).toBe(R.CHAIN.WEB2);
    expect(R.WEB2).toBe(R.CHAIN.WEB2);
  });
});

describe.each([
  ['READ.CHAIN.WEB2', R.CHAIN.WEB2],
  ['deprecated CHAIN.WEB2', CHAIN.WEB2],
  ['legacy literal', 'web2:https'],
] as const)('%s', (_name, chain) => {
  it('normalizes to the unchanged wire identity', () => {
    const dest = resolveDestination(toReadDestination(chain as ReadChain));
    expect(dest).toMatchObject({ chainNamespace: 'web2', chainId: 'https', caip2: 'web2:https', namespace: 'web2' });
    expect(resolveDestination({ chain: chain as ReadChain })).toMatchObject({ caip2: 'web2:https' });
  });

  it('builds an http query and spec params', () => {
    expect(toReadQuery('https://x.test/a', { chain: chain as ReadChain, ...web2 })).toMatchObject({ type: 'http', url: 'https://x.test/a' });
    expect(toBuildReadSpecParams('https://x.test/a', { chain: chain as ReadChain, ...web2 }).destination).toEqual({
      chainNamespace: 'web2',
      chainId: 'https',
    });
  });

  it('is rejected by transaction routing', () => {
    expect(() => validateRouteParams({ to: { address: '0x0000000000000000000000000000000000000001', chain: chain as never } })).toThrow(
      /read-only destination/
    );
  });
});

describe('type-level separation', () => {
  it('compiles', () => {
    const a: ReadChain = 'web2';
    const b: ReadChain = 'web2:https';
    const c: ReadChain = CHAIN.ETHEREUM_SEPOLIA;
    const d: ReadChain = R.CHAIN.WEB2;
    // @ts-expect-error — a transaction ChainTarget never accepts the Web2 read source
    const t: import('../../orchestrator/orchestrator.types').ChainTarget = { address: '0x', chain: R.CHAIN.WEB2 };
    expect([a, b, c, d, t].length).toBe(5);
  });
});
