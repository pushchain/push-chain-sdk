/** Real viem RPC/actions, with local-fork timeouts and polling instead of production defaults. */
jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    createPublicClient: (options: {
      pollingInterval?: number;
      [key: string]: unknown;
    }) =>
      actual.createPublicClient({
        ...options,
        pollingInterval: options.pollingInterval ?? 25,
      }),
    http: (url?: string, options?: Record<string, unknown>) =>
      actual.http(url, {
        ...(url?.startsWith('http://127.0.0.1:') ? { timeout: 120000 } : {}),
        ...options,
      }),
    createWalletClient: (options: {
      chain?: { rpcUrls?: { default?: { http?: string[] } } };
      [key: string]: unknown;
    }) => {
      const client = actual.createWalletClient(options);
      const url = options.chain?.rpcUrls?.default?.http?.[0];
      if (url?.startsWith('http://127.0.0.1:')) {
        const send = client.sendTransaction;
        const local = actual.createPublicClient({
          transport: actual.http(url, { timeout: 120000 }),
        });
        client.sendTransaction = async (params: unknown) => {
          const hash = await send(params);
          // Anvil may return the hash before its receipt is indexed, then forward a
          // premature receipt query to the public fork RPC. Mine confirmation blocks locally before
          // handing the real hash to SDK receipt polling. No result is mocked.
          await local.request({ method: 'anvil_mine', params: ['0x4'] });
          return hash;
        };
      }
      return client;
    },
  };
});
