export default {
  displayName: 'core',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/core',
  testTimeout: 30000,
  // Only run unit tests under src/
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.test.ts'],
  // Exclude integration tests that make real network calls
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/src/lib/push-chain/push-chain\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.readonly\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.signing\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.addresses\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.reinitialize\\.spec\\.ts$',
    '<rootDir>/src/lib/push-chain/push-chain\\.explorer\\.spec\\.ts$',
    '<rootDir>/src/lib/vm-client/evm-client\\.spec\\.ts$',
    '<rootDir>/src/lib/vm-client/svm-client\\.spec\\.ts$',
    '<rootDir>/src/lib/orchestrator/orchestrator\\.spec\\.ts$',
    '<rootDir>/src/lib/price-fetch/price-fetch\\.spec\\.ts$',
  ],
};
