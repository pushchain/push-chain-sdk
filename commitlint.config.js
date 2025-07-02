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
    'scope-empty': [2, 'never'],
    'subject-empty': [2, 'never'],
  },
};
