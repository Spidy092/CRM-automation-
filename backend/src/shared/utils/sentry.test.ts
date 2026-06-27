/**
 * Sentry wiring tests.
 *
 * Covers the four critical behaviors of initSentry():
 *   (a) When SENTRY_DSN is undefined, logs a message and skips Sentry.init
 *   (b) When SENTRY_DSN is set, calls Sentry.init with the DSN,
 *       default tracesSampleRate=0.1, and environment from NODE_ENV
 *   (c) When NODE_ENV=test, passes enabled=false to Sentry.init
 *   (d) Reads SENTRY_TRACES_SAMPLE_RATE from env (e.g. "0.5" -> 0.5)
 */

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

// Mock the logger to silence real log output and let us assert log calls
jest.mock('./logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';
import { logger } from './logger';

const mockedSentryInit = Sentry.init as jest.MockedFunction<typeof Sentry.init>;
const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('initSentry', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset env to a known state; tests mutate NODE_ENV, SENTRY_DSN, SENTRY_TRACES_SAMPLE_RATE
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('when SENTRY_DSN is missing', () => {
    it('logs a message and skips Sentry.init', () => {
      delete process.env.SENTRY_DSN;
      delete process.env.NODE_ENV;
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;

      initSentry();

      expect(mockedSentryInit).not.toHaveBeenCalled();
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringMatching(/SENTRY_DSN/i),
      );
    });

    it('logs even when NODE_ENV=test but DSN is missing', () => {
      delete process.env.SENTRY_DSN;
      process.env.NODE_ENV = 'test';

      initSentry();

      expect(mockedSentryInit).not.toHaveBeenCalled();
      expect(mockedLogger.info).toHaveBeenCalled();
    });
  });

  describe('when SENTRY_DSN is set', () => {
    beforeEach(() => {
      process.env.SENTRY_DSN = 'https://abc123@sentry.example.com/1';
    });

    it('calls Sentry.init with the DSN, default tracesSampleRate=0.1, and environment from NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;

      initSentry();

      expect(mockedSentryInit).toHaveBeenCalledTimes(1);
      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.dsn).toBe('https://abc123@sentry.example.com/1');
      expect(config.tracesSampleRate).toBe(0.1);
      expect(config.environment).toBe('production');
    });

    it('defaults environment to "development" when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.environment).toBe('development');
    });

    it('parses SENTRY_TRACES_SAMPLE_RATE=0.5 correctly', () => {
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0.5';
      process.env.NODE_ENV = 'staging';

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.tracesSampleRate).toBe(0.5);
      expect(config.environment).toBe('staging');
    });

    it('handles SENTRY_TRACES_SAMPLE_RATE=1 (full tracing)', () => {
      process.env.SENTRY_TRACES_SAMPLE_RATE = '1';

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.tracesSampleRate).toBe(1);
    });

    it('handles SENTRY_TRACES_SAMPLE_RATE=0 (tracing disabled)', () => {
      process.env.SENTRY_TRACES_SAMPLE_RATE = '0';

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.tracesSampleRate).toBe(0);
    });

    it('logs that Sentry was initialized', () => {
      process.env.NODE_ENV = 'production';

      initSentry();

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Sentry initialized',
        expect.objectContaining({ environment: 'production' }),
      );
    });
  });

  describe('NODE_ENV=test short-circuit', () => {
    it('passes enabled=false to Sentry.init when NODE_ENV=test', () => {
      process.env.SENTRY_DSN = 'https://abc123@sentry.example.com/1';
      process.env.NODE_ENV = 'test';
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;

      initSentry();

      expect(mockedSentryInit).toHaveBeenCalledTimes(1);
      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.enabled).toBe(false);
    });

    it('sets enabled=true in production', () => {
      process.env.SENTRY_DSN = 'https://abc123@sentry.example.com/1';
      process.env.NODE_ENV = 'production';

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.enabled).toBe(true);
    });

    it('sets enabled=true in development', () => {
      process.env.SENTRY_DSN = 'https://abc123@sentry.example.com/1';
      process.env.NODE_ENV = 'development';

      initSentry();

      const config = mockedSentryInit.mock.calls[0][0]!;
      expect(config.enabled).toBe(true);
    });
  });
});
