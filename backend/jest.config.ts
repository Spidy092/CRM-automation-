import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  collectCoverageFrom: ['**/*.ts', '!**/*.d.ts', '!**/index.ts', '!**/*.test.ts', '!**/*.spec.ts'],
  coverageThreshold: process.env.CI
    ? {
        global: {
          branches: 70,
          functions: 70,
          lines: 70,
          statements: 70,
        },
      }
    : undefined,
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@modules/(.*)$': '<rootDir>/modules/$1',
    '^@workers/(.*)$': '<rootDir>/workers/$1',
    '^@webhooks/(.*)$': '<rootDir>/webhooks/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  setupFilesAfterEnv: ['<rootDir>/../jest.setup.ts'],
};

export default config;
