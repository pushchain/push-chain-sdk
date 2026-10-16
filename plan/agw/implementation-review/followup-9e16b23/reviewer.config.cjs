const path = require('path');
const root = path.resolve(__dirname, '../../../..');
module.exports = {
  ...require(path.join(root, 'jest.preset.js')),
  rootDir: root,
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: path.join(root, 'packages/core/tsconfig.agw-local.json') }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/plan/agw/implementation-review/followup-9e16b23/*.spec.ts'],
  testTimeout: 30000,
};
