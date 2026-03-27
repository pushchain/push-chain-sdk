export default {
  displayName: 'core-e2e',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  globalSetup: '<rootDir>/__e2e__/shared/global-setup.ts',
  setupFiles: [
    'dotenv/config',
    '<rootDir>/__e2e__/shared/setup-logger.ts',
  ],
  reporters: [
    'default',
    '<rootDir>/__e2e__/shared/e2e-file-reporter.js',
  ],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/packages/core-e2e',
  testTimeout: 300000, // Allow long-running e2e tests (5 min)
  testMatch: ['<rootDir>/__e2e__/**/*.spec.ts'],
  moduleNameMapper: {
    '^@e2e/shared/(.*)$': '<rootDir>/__e2e__/shared/$1',
  },
};
