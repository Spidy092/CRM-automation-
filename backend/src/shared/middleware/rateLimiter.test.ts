describe('rateLimiter', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('builds authenticatedLimiter and publicLimiter middleware functions using default limits', () => {
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_AUTHENTICATED;
    delete process.env.RATE_LIMIT_MAX_PUBLIC;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { authenticatedLimiter, publicLimiter } = require('./rateLimiter');

    expect(typeof authenticatedLimiter).toBe('function');
    expect(typeof publicLimiter).toBe('function');
  });

  it('honors RATE_LIMIT_* environment overrides without throwing', () => {
    process.env.RATE_LIMIT_WINDOW_MS = '30000';
    process.env.RATE_LIMIT_MAX_AUTHENTICATED = '5';
    process.env.RATE_LIMIT_MAX_PUBLIC = '2';

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { authenticatedLimiter, publicLimiter } = require('./rateLimiter');

    expect(typeof authenticatedLimiter).toBe('function');
    expect(typeof publicLimiter).toBe('function');
  });
});
