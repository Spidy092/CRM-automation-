import { z } from 'zod';
import { CustomFieldType } from '../../shared/types';

export const fieldTypeEnum = z.enum([
  'text',
  'number',
  'date',
  'dropdown',
  'checkbox',
]) as z.ZodEnum<[CustomFieldType, ...CustomFieldType[]]>;

const baseSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255),
  field_key: z
    .string()
    .min(1, 'field_key is required')
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'field_key must be lowercase letters, numbers, and underscores'),
  field_type: fieldTypeEnum,
  options: z.array(z.string().min(1)).optional().nullable(),
  is_required: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

const dropdownRefine = (data: {
  field_type?: CustomFieldType;
  options?: string[] | null;
}): boolean =>
  data.field_type !== 'dropdown' || (Array.isArray(data.options) && data.options.length > 0);

export const createDefinitionSchema = baseSchema.refine(dropdownRefine, {
  message: 'dropdown fields require at least one option',
  path: ['options'],
});

export const updateDefinitionSchema = baseSchema.partial().refine(dropdownRefine, {
  message: 'dropdown fields require at least one option',
  path: ['options'],
});
