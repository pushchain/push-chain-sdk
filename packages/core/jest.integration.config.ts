export default {
  displayName: 'core-integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/core-integration',
  testTimeout: 300000, // Allow long-running integration tests (5 min)
  // Only run integration tests (files that make real network calls)
  testMatch: [
    '<rootDir>/src/lib/push-chain/push-chain.spec.ts',
    '<rootDir>/src/lib/push-chain/push-chain.readonly.spec.ts',
    '<rootDir>/src/lib/push-chain/push-chain.signing.spec.ts',
    '<rootDir>/src/lib/push-chain/push-chain.addresses.spec.ts',
    '<rootDir>/src/lib/push-chain/push-chain.reinitialize.spec.ts',
    '<rootDir>/src/lib/push-chain/push-chain.explorer.spec.ts',
    '<rootDir>/src/lib/vm-client/evm-client.spec.ts',
    '<rootDir>/src/lib/vm-client/svm-client.spec.ts',
    '<rootDir>/src/lib/orchestrator/orchestrator.spec.ts',
    '<rootDir>/src/lib/price-fetch/price-fetch.spec.ts',
  ],
};
