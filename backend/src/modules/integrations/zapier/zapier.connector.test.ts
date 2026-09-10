import { zapierCredentialsSchema } from './zapier.connector';

describe('zapierCredentialsSchema', () => {
  const valid = { webhookUrl: 'https://hooks.zapier.com/hooks/catch/123/abc/' };

  it('accepts an HTTPS Zapier Catch Hook URL', () => {
    expect(zapierCredentialsSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    'http://hooks.zapier.com/hooks/catch/123/abc/',
    'https://example.com/hooks/catch/123/abc/',
    'https://user:password@hooks.zapier.com/hooks/catch/123/abc/',
  ])('rejects unsafe webhook URL %s', (webhookUrl) => {
    expect(zapierCredentialsSchema.safeParse({ webhookUrl }).success).toBe(false);
  });
});
