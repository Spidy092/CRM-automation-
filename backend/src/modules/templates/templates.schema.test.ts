import {
  templateIdParamSchema,
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  approveTemplateSchema,
  duplicateTemplateSchema,
  previewTemplateSchema,
  testSendTemplateSchema,
} from './templates.schema';

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('templateIdParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(templateIdParamSchema.safeParse({ id: uuid }).success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    expect(templateIdParamSchema.safeParse({ id: 'bad' }).success).toBe(false);
  });
});

describe('createTemplateSchema', () => {
  it('accepts valid template', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Welcome',
      channel: 'email',
      body: 'Hello {{name}}',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Welcome',
      channel: 'whatsapp',
      subject: 'Hi',
      body: 'Hello',
      variables: ['name'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createTemplateSchema.safeParse({
      name: '',
      channel: 'email',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty body', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Test',
      channel: 'email',
      body: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Test',
      channel: 'invalid',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateTemplateSchema', () => {
  it('accepts partial update', () => {
    const result = updateTemplateSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    expect(updateTemplateSchema.safeParse({}).success).toBe(true);
  });
});

describe('listTemplatesQuerySchema', () => {
  it('accepts valid query', () => {
    const result = listTemplatesQuerySchema.safeParse({
      limit: '20',
      channel: 'email',
      approval_status: 'approved',
      search: 'welcome',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty query', () => {
    expect(listTemplatesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid approval_status', () => {
    const result = listTemplatesQuerySchema.safeParse({ approval_status: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('approveTemplateSchema', () => {
  it('accepts approval', () => {
    const result = approveTemplateSchema.safeParse({ approved: true });
    expect(result.success).toBe(true);
  });

  it('accepts rejection with reason', () => {
    const result = approveTemplateSchema.safeParse({
      approved: false,
      rejection_reason: 'Bad grammar',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean approved', () => {
    const result = approveTemplateSchema.safeParse({ approved: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('design-system schemas', () => {
  it('create accepts editor_mode, design, and preheader', () => {
    const result = createTemplateSchema.safeParse({
      name: 'Visual',
      channel: 'email',
      body: 'fallback',
      editor_mode: 'visual',
      design: { version: 1, blocks: [] },
      preheader: 'Hi',
    });
    expect(result.success).toBe(true);
  });

  it('create rejects unknown editor_mode values', () => {
    expect(
      createTemplateSchema.safeParse({
        name: 'X',
        channel: 'email',
        body: 'b',
        editor_mode: 'dragdrop',
      }).success,
    ).toBe(false);
  });

  it('list accepts archive and mine filters', () => {
    const result = listTemplatesQuerySchema.safeParse({
      include_archived: 'true',
      archived_only: false,
      mine: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include_archived).toBe(true);
      expect(result.data.mine).toBe(true);
    }
  });

  it('duplicate accepts an optional rename', () => {
    expect(duplicateTemplateSchema.safeParse({}).success).toBe(true);
    expect(duplicateTemplateSchema.safeParse({ name: 'Copy' }).success).toBe(true);
    expect(duplicateTemplateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('preview accepts optional sample values', () => {
    expect(previewTemplateSchema.safeParse({}).success).toBe(true);
    expect(previewTemplateSchema.safeParse({ sample_values: { first_name: 'Sam' } }).success).toBe(
      true,
    );
  });

  it('test-send requires a valid recipient email', () => {
    expect(testSendTemplateSchema.safeParse({ to: 'owner@example.com' }).success).toBe(true);
    expect(testSendTemplateSchema.safeParse({ to: 'not-an-email' }).success).toBe(false);
    expect(testSendTemplateSchema.safeParse({}).success).toBe(false);
  });
});

it('parses false query strings as false and rejects unsupported boolean values', () => {
  const parsed = listTemplatesQuerySchema.parse({
    include_archived: 'false',
    archived_only: 'false',
    mine: 'false',
  });
  expect(parsed).toMatchObject({ include_archived: false, archived_only: false, mine: false });
  expect(listTemplatesQuerySchema.safeParse({ mine: 'no' }).success).toBe(false);
});
