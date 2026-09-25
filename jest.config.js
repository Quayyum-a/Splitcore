module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.spec.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/test/**',
    '!**/prisma/migrations/**',
    '!**/prisma/seed.ts',
    '!**/*.config.ts',
    '!**/main.ts',
    '!**/worker.ts',
    // Nest module files are declarative wiring with no branches to exercise;
    // the e2e suite proves the graph resolves, which is the only thing that
    // can actually be wrong in them.
    '!**/*.module.ts',
    // Documentation, not shipped behaviour.
    '!**/*.example.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['json', 'lcov', 'text', 'html'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
  testEnvironment: 'node',
  // Pins REDIS_* before @prisma/client can load a developer .env; see the file.
  setupFiles: ['<rootDir>/../test/setup-unit-env.ts'],
  // nanoid ships ESM only; it must be transformed rather than skipped as a
  // node_modules dependency. test/jest-e2e.json carries the same exception.
  transformIgnorePatterns: ['node_modules/(?!(nanoid)/)'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
  },
};
