module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'fix',
        'feat',
        'chore',
        'docs',
        'test',
        'refactor',
        'ci',
        'perf',
        'build',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // list all packages here
        'core',
        'ui-kit',
        // list all monorepo-level scopes here
        'repo',
      ],
    ],
    'scope-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
  },
};
