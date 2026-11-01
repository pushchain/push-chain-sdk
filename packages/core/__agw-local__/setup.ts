/** Actual RPC/actions with a local poll interval, not mocked transactions. */
jest.mock('viem', () => {
  const actual = jest.requireActual('viem');
  return {
    ...actual,
    // viem 2.27 poll() leaves an already-scheduled wait alive after unwatch.
    // Its production 4s default needlessly delays local Jest shutdown. Keep
    // real receipt/replacement logic, and configure short local polling.
    createPublicClient: (options: {
      pollingInterval?: number;
      [key: string]: unknown;
    }) =>
      actual.createPublicClient({
        ...options,
        pollingInterval: options?.pollingInterval ?? 25,
      }),
  };
});
