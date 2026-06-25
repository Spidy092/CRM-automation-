import {
  createSequenceSchema,
  updateSequenceSchema,
  leadIdParamSchema,
  listLogsQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  taskIdParamSchema,
  launchCampaignSchema,
} from './outreach.schema';

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe('createSequenceSchema', () => {
  it('accepts valid input', () => {
    const result = createSequenceSchema.safeParse({
      name: 'Welcome Series',
      steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: uuid }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createSequenceSchema.safeParse({
      name: '',
      steps: [{ stepNumber: 1, channel: 'email', delayHours: 0, templateId: uuid }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty steps array', () => {
    const result = createSequenceSchema.safeParse({ name: 'Test', steps: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid channel', () => {
    const result = createSequenceSchema.safeParse({
      name: 'Test',
      steps: [{ stepNumber: 1, channel: 'invalid', delayHours: 0, templateId: uuid }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid channels', () => {
    for (const channel of ['whatsapp', 'email', 'sms', 'phone_call']) {
      const result = createSequenceSchema.safeParse({
        name: 'Test',
        steps: [{ stepNumber: 1, channel, delayHours: 0, templateId: uuid }],
      });
      expect(result.success).toBe(true);
    }
  });
});

describe('updateSequenceSchema', () => {
  it('accepts partial update', () => {
    const result = updateSequenceSchema.safeParse({ name: 'Updated' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = updateSequenceSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('leadIdParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(leadIdParamSchema.safeParse({ leadId: uuid }).success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    expect(leadIdParamSchema.safeParse({ leadId: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('listLogsQuerySchema', () => {
  it('accepts valid query', () => {
    const result = listLogsQuerySchema.safeParse({ limit: '50', channel: 'email' });
    expect(result.success).toBe(true);
  });

  it('accepts empty query', () => {
    expect(listLogsQuerySchema.safeParse({}).success).toBe(true);
  });
});

describe('createTaskSchema', () => {
  it('accepts valid task', () => {
    const result = createTaskSchema.safeParse({
      leadId: uuid,
      type: 'phone_call',
      title: 'Call lead',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createTaskSchema.safeParse({ leadId: uuid, type: 'phone_call' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type', () => {
    const result = createTaskSchema.safeParse({
      leadId: uuid,
      type: 'invalid',
      title: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid types', () => {
    for (const type of ['phone_call', 'follow_up', 'meeting_prep', 'other']) {
      const result = createTaskSchema.safeParse({ leadId: uuid, type, title: 'Test' });
      expect(result.success).toBe(true);
    }
  });
});

describe('updateTaskSchema', () => {
  it('accepts valid update', () => {
    const result = updateTaskSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updateTaskSchema.safeParse({ status: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('taskIdParamSchema', () => {
  it('accepts valid UUID', () => {
    expect(taskIdParamSchema.safeParse({ id: uuid }).success).toBe(true);
  });

  it('rejects invalid UUID', () => {
    expect(taskIdParamSchema.safeParse({ id: 'bad' }).success).toBe(false);
  });
});

describe('launchCampaignSchema', () => {
  it('accepts valid input', () => {
    const result = launchCampaignSchema.safeParse({
      campaignId: uuid,
      sequenceId: uuid,
    });
    expect(result.success).toBe(true);
  });

  it('defaults mockMode to false', () => {
    const result = launchCampaignSchema.safeParse({
      campaignId: uuid,
      sequenceId: uuid,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mockMode).toBe(false);
  });
});
