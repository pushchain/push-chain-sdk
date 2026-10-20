export default {
  displayName: 'marketplace-local',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/__market-local__/setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.marketplace-local.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  testTimeout: 180000,
  testMatch: ['<rootDir>/__market-local__/**/*.spec.ts'],
};
