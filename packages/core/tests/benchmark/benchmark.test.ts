import { Validator } from '../../src';
import {
  ActiveValidator,
  TokenReply,
} from '../../src/lib/validator/validator.types';
import { config } from '../config';

/**
 * @dev - This test is for benchmarking the network performance of validators and
 * should be skipped in CI
 */
describe.skip('Network Benchmark Tests', () => {
  const THREAD_COUNTS = [10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];

  const env = config.ENV;
  const DELAY_BETWEEN_TESTS_MS = 5000; // 2-second delay between tests
  let validators: ActiveValidator[] = []; // Shared validators

  async function executeWithConcurrency(
    tasks: (() => Promise<any>)[],
    concurrency: number
  ) {
    const executing: Promise<any>[] = [];
    for (const task of tasks) {
      const promise = task();
      executing.push(promise);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }

      // Clean up completed tasks
      promise.finally(() => executing.splice(executing.indexOf(promise), 1));
    }
    return Promise.all(executing);
  }

  async function measureExecutionTime(
    threads: number,
    taskFn: () => Promise<void>
  ) {
    const tasks = Array(threads).fill(taskFn);
    const start = performance.now();
    await executeWithConcurrency(tasks, threads);
    const end = performance.now();
    return end - start;
  }

  async function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Calculate random validators only ONCE before all tests
  beforeAll(async () => {
    const validatorInstance = await Validator.initalize({ env });

    validators = await validatorInstance[
      'validatorContractClient'
    ].read.getActiveVNodes();
  });

  it('Ping Validator Nodes', async () => {
    const validatorInstance = await Validator.initalize({ env });
    for (const threads of THREAD_COUNTS) {
      const timeTaken = await measureExecutionTime(threads, async () => {
        const validatorIndex = Math.floor(Math.random() * validators.length);
        const validator = validators[validatorIndex].nodeApiBaseUrl; // Read without removing
        if (!validator) throw new Error('No validators available');
        await validatorInstance.call<'true' | 'false'>(
          'push_listening',
          [],
          validator
        );
      });
      console.log(
        `Ping Validators - Threads: ${threads}, Time Taken: ${timeTaken.toFixed(
          2
        )} ms`
      );

      // Introduce delay between tests
      if (threads !== THREAD_COUNTS[THREAD_COUNTS.length - 1]) {
        console.log(
          `Waiting ${DELAY_BETWEEN_TESTS_MS / 1000} seconds before next test...`
        );
        await delay(DELAY_BETWEEN_TESTS_MS);
      }
    }
  });

  it('Get Access Tokens from Validator Nodes', async () => {
    const validatorInstance = await Validator.initalize({ env });
    for (const threads of THREAD_COUNTS) {
      const timeTaken = await measureExecutionTime(threads, async () => {
        const validatorIndex = Math.floor(Math.random() * validators.length);
        const validator = validators[validatorIndex].nodeApiBaseUrl; // Read without removing
        if (!validator) throw new Error('No validators available');
        await validatorInstance.call<TokenReply>(
          'push_getApiToken',
          [],
          validator
        );
      });
      console.log(
        `Get Access Tokens from Validators - Threads: ${threads}, Time Taken: ${timeTaken.toFixed(
          2
        )} ms`
      );

      // Introduce delay between tests
      if (threads !== THREAD_COUNTS[THREAD_COUNTS.length - 1]) {
        console.log(
          `Waiting ${DELAY_BETWEEN_TESTS_MS / 1000} seconds before next test...`
        );
        await delay(DELAY_BETWEEN_TESTS_MS);
      }
    }
  });

  // it.only('Send Tx to Validator Nodes', async () => {
  //   const recipients = [
  //     `eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4`,
  //     `eip155:137:${privateKeyToAddress(generatePrivateKey())}`,
  //     `eip155:97:${privateKeyToAddress(generatePrivateKey())}`,
  //   ];
  //   const pk = generatePrivateKey();
  //   const account = privateKeyToAccount(pk);
  //   const signer = {
  //     account: Address.toPushCAIP(account.address, PushChainEnvironment.devnet),
  //     signMessage: async (data: Uint8Array) => {
  //       const signature = await account.signMessage({
  //         message: { raw: data },
  //       });
  //       return hexToBytes(signature);
  //     },
  //   };
  //
  //   for (const threads of THREAD_COUNTS) {
  //     const timeTaken = await measureExecutionTime(threads, async () => {
  //       const txInstance = await Tx.initialize(env);
  //       const tx = txInstance.createUnsigned(
  //         'CUSTOM:BENCHMARK',
  //         recipients,
  //         new Uint8Array([1, 2, 3, 4, 5])
  //       );
  //       const validatorIndex = Math.floor(Math.random() * validators.length);
  //       const validator = validators[validatorIndex].nodeApiBaseUrl; // Read without removing
  //       await txInstance.send(tx, signer, validator);
  //     });
  //     console.log(
  //       `Send Tx to Validators - Threads: ${threads}, Time Taken: ${timeTaken.toFixed(
  //         2
  //       )} ms`
  //     );
  //
  //     // Introduce delay between tests
  //     if (threads !== THREAD_COUNTS[THREAD_COUNTS.length - 1]) {
  //       console.log(
  //         `Waiting ${DELAY_BETWEEN_TESTS_MS / 1000} seconds before next test...`
  //       );
  //       await delay(DELAY_BETWEEN_TESTS_MS);
  //     }
  //   }
  // });

  // it('Get Tx from Validator Nodes', async () => {
  //   for (const threads of THREAD_COUNTS) {
  //     const timeTaken = await measureExecutionTime(threads, async () => {
  //       const txInstance = await Tx.initialize(env);
  //       await txInstance.getTransactionsFromVNode(
  //         `eip155:1:${privateKeyToAddress(generatePrivateKey())}`,
  //         'CUSTOM:BENCHMARK'
  //       );
  //     });
  //     console.log(
  //       `Get Tx from Validators - Threads: ${threads}, Time Taken: ${timeTaken.toFixed(
  //         2
  //       )} ms`
  //     );
  //
  //     // Introduce delay between tests
  //     if (threads !== THREAD_COUNTS[THREAD_COUNTS.length - 1]) {
  //       console.log(
  //         `Waiting ${DELAY_BETWEEN_TESTS_MS / 1000} seconds before next test...`
  //       );
  //       await delay(DELAY_BETWEEN_TESTS_MS);
  //     }
  //   }
  // });

  it('Get Account Info from Validator Nodes', async () => {
    const validatorInstance = await Validator.initalize({ env });
    for (const threads of THREAD_COUNTS) {
      const timeTaken = await measureExecutionTime(threads, async () => {
        const validatorIndex = Math.floor(Math.random() * validators.length);
        const validator = validators[validatorIndex].nodeApiBaseUrl; // Read without removing
        if (!validator) throw new Error('No validators available');
        await validatorInstance.call<any>(
          'push_accountInfo',
          ['eip155:1:0x35B84d6848D16415177c64D64504663b998A6ab4'],
          validator
        );
      });
      console.log(
        `Get account info from Validators - Threads: ${threads}, Time Taken: ${timeTaken.toFixed(
          2
        )} ms`
      );

      // Introduce delay between tests
      if (threads !== THREAD_COUNTS[THREAD_COUNTS.length - 1]) {
        console.log(
          `Waiting ${DELAY_BETWEEN_TESTS_MS / 1000} seconds before next test...`
        );
        await delay(DELAY_BETWEEN_TESTS_MS);
      }
    }
  });
});
