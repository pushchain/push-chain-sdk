import { Validator } from '../../src';
import {
  PingReply,
  TokenReply,
  ActiveValidator,
} from '../../src/lib/validator/validator.types';
import { config } from '../config';

describe('Validator Class', () => {
  const env = config.ENV;

  it('Initialize Validator', async () => {
    const validatorInstance = await Validator.initalize({ env });
    const activeValidators = (
      (await validatorInstance[
        'validatorContractClient'
      ].read.getActiveVNodes()) as []
    ).map((each) => {
      return (each as ActiveValidator).nodeApiBaseUrl;
    });
    expect(activeValidators).toContain(validatorInstance['activeValidatorURL']);
  });

  it('Ping every active validator node', async () => {
    const validatorInstance = await Validator.initalize({ env });

    const activeValidators: ActiveValidator[] = await validatorInstance[
      'validatorContractClient'
    ].read.getActiveVNodes();

    for (const each of activeValidators) {
      const pingReply = await validatorInstance.call<'true' | 'false'>(
        'push_listening',
        [],
        each.nodeApiBaseUrl
      );
      expect(pingReply === 'true').toBe(true);
      // expect(pingReply).not.toBeNull();
      // expect(pingReply?.nodeId).toBe(each.nodeWallet);
      // expect(pingReply?.status).toBe(1);
    }
  });

  it('Ping active read validator node', async () => {
    const validatorInstance = await Validator.initalize({ env });
    // default active read validator
    const pingReply = await validatorInstance.call<'true' | 'false'>(
      'push_listening'
    );
    expect(pingReply === 'true' || pingReply === 'false').toBe(true);
    // expect(pingReply).not.toBeNull();
    // expect(pingReply?.status).toBe(1);
  });

  it('Get token from random active validator node', async () => {
    const validatorInstance = await Validator.initalize({ env });
    const token = await validatorInstance.call<TokenReply>('push_getApiToken');
    expect(token).not.toBeNull();
    expect(typeof token?.apiToken).toBe('string');
    expect(typeof token?.apiUrl).toBe('string');
  });
});
