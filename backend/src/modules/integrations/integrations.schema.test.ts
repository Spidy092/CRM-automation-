import {
  integrationIdParamSchema,
  integrationCredentialsSchema,
  updateIntegrationSchema,
} from './integrations.schema';

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('integrationIdParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(integrationIdParamSchema.safeParse({ id: uuid }).success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    expect(integrationIdParamSchema.safeParse({ id: 'bad' }).success).toBe(false);
  });
});

describe('integrationCredentialsSchema', () => {
  it('accepts non-empty object', () => {
    const result = integrationCredentialsSchema.safeParse({ apiKey: 'key123' });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = integrationCredentialsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-object', () => {
    expect(integrationCredentialsSchema.safeParse('string').success).toBe(false);
    expect(integrationCredentialsSchema.safeParse(null).success).toBe(false);
  });
});

describe('updateIntegrationSchema', () => {
  it('accepts is_enabled only', () => {
    const result = updateIntegrationSchema.safeParse({ is_enabled: true });
    expect(result.success).toBe(true);
  });

  it('accepts credentials only', () => {
    const result = updateIntegrationSchema.safeParse({ credentials: { key: 'val' } });
    expect(result.success).toBe(true);
  });

  it('accepts null credentials', () => {
    const result = updateIntegrationSchema.safeParse({ credentials: null });
    expect(result.success).toBe(true);
  });

  it('accepts both fields', () => {
    const result = updateIntegrationSchema.safeParse({
      is_enabled: false,
      credentials: { key: 'val' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = updateIntegrationSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
