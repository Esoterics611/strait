// Phase 0 integration oracle — a SEPARATE jest project so it never slows the
// unit suite (`npm test`). Run with `npm run test:integration`. Requires a
// real Postgres (docker-compose `postgres`, or a local strait cluster).
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { isolatedModules: true, tsconfig: '<rootDir>/tsconfig.json' },
    ],
  },
  moduleNameMapper: {
    '^@strait/contract$': '<rootDir>/packages/contract/src/index.ts',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@secrets/(.*)$': '<rootDir>/src/secrets/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@events/(.*)$': '<rootDir>/src/events/$1',
  },
  globalSetup: '<rootDir>/test/integration/global-setup.ts',
  maxWorkers: 1,
  testTimeout: 30_000,
};
