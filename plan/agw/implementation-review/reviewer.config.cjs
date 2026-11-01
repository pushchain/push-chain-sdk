const path = require('path');
const root = path.resolve(__dirname, '../../..');
module.exports = {
  rootDir: root,
  ...require(path.join(root, 'jest.preset.js')),
  testEnvironment: 'node',
  transform: { '^.+\\.[tj]s$': ['ts-jest', { tsconfig: path.join(root, 'packages/core/tsconfig.agw-local.json') }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/plan/agw/implementation-review/*.spec.ts'],
  testTimeout: 120000,
};
