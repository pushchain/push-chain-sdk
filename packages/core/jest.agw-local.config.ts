/**
 * Local AGW contract harness (review-only). Runs the SDK against the real
 * pinned v4 contracts on anvil. Requires Foundry and AGW_LOCAL_DIR from
 * scripts/agw-local/prepare.sh. Never part of the unit or E2E runs.
 *
 *   AGW_LOCAL_DIR=$(packages/core/scripts/agw-local/prepare.sh | tail -1) \
 *     node node_modules/jest/bin/jest.js --config packages/core/jest.agw-local.config.ts --runInBand
 */
export default {
  displayName: 'core-agw-local',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/__agw-local__/setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.agw-local.json' },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testTimeout: 120000,
  testMatch: ['<rootDir>/__agw-local__/**/*.spec.ts'],
};
