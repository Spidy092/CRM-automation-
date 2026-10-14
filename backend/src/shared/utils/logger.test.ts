import { sanitizeUrlForLogging } from './logger';

describe('sanitizeUrlForLogging', () => {
  it('redacts ?ticket query parameter', () => {
    const raw = '/api/v1/events?ticket=019349c2-51a8-7798-94df-7411bc277dc6';
    expect(sanitizeUrlForLogging(raw)).toBe('/api/v1/events?ticket=[REDACTED]');
  });

  it('redacts &ticket query parameter when multiple params are present', () => {
    const raw = '/api/v1/events?mode=live&ticket=secret-ticket-value&version=2';
    expect(sanitizeUrlForLogging(raw)).toBe(
      '/api/v1/events?mode=live&ticket=[REDACTED]&version=2',
    );
  });

  it('redacts other sensitive parameters (tokens, secrets, passwords)', () => {
    expect(sanitizeUrlForLogging('/oauth/token?code=auth-code-123')).toBe(
      '/oauth/token?code=[REDACTED]',
    );
    expect(sanitizeUrlForLogging('/api?apiKey=my-secret-key')).toBe(
      '/api?apiKey=[REDACTED]',
    );
    expect(sanitizeUrlForLogging('/api?token=jwt.token.value')).toBe(
      '/api?token=[REDACTED]',
    );
    expect(sanitizeUrlForLogging('/api?password=plaintextpass')).toBe(
      '/api?password=[REDACTED]',
    );
  });

  it('preserves non-sensitive query parameters unchanged', () => {
    const raw = '/api/v1/leads?page=1&limit=50&status=open';
    expect(sanitizeUrlForLogging(raw)).toBe(raw);
  });

  it('redacts tickets embedded within full Morgan combined log line', () => {
    const morganLine =
      '127.0.0.1 - - [10/Oct/2026:12:00:00 +0000] "GET /api/v1/events?ticket=uuid-value HTTP/1.1" 200 120 "http://localhost/events?ticket=uuid-value" "Mozilla/5.0"';
    const sanitized = sanitizeUrlForLogging(morganLine);
    expect(sanitized).not.toContain('uuid-value');
    expect(sanitized).toBe(
      '127.0.0.1 - - [10/Oct/2026:12:00:00 +0000] "GET /api/v1/events?ticket=[REDACTED] HTTP/1.1" 200 120 "http://localhost/events?ticket=[REDACTED]" "Mozilla/5.0"',
    );
  });

  it('handles empty strings safely', () => {
    expect(sanitizeUrlForLogging('')).toBe('');
  });
});
