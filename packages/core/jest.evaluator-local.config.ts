/** Opt-in, unfunded local SDK → pinned evaluator/kernel/AGW contract execution. */
export default {
  displayName: 'evaluator-local',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/__agw-local__/setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.evaluator-local.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
  testTimeout: 180000,
  testMatch: ['<rootDir>/__evaluator-local__/**/*.spec.ts'],
};
