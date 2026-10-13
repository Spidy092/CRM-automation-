import { createFormSchema, submissionDefinitionSchema } from './forms.schema';

describe('form schema compatibility', () => {
  it('preserves safe legacy leadField mappings when forms are updated', () => {
    const result = createFormSchema.safeParse({
      name: 'Legacy form',
      fields: [
        {
          name: 'legacy',
          label: 'Legacy field',
          type: 'text',
          required: false,
          leadField: 'legacy_custom_column',
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts whitespace-only optional numbers as empty while keeping required numbers strict', () => {
    const optional = submissionDefinitionSchema([
      { name: 'count', label: 'Count', type: 'number', required: false },
    ]);
    const required = submissionDefinitionSchema([
      { name: 'count', label: 'Count', type: 'number', required: true },
    ]);

    expect(optional.parse({ count: '   ' })).toEqual({ count: '' });
    expect(required.safeParse({ count: '   ' }).success).toBe(false);
  });
});
