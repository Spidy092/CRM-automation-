import type { Config } from 'jest';
import base from './jest.config';

const config: Config = {
  ...base,
  testMatch: [
    '**/campaigns.durable.integration.test.ts',
    '**/migrations.chain.integration.test.ts',
  ],
  testPathIgnorePatterns: [],
  coverageThreshold: undefined,
};

export default config;
