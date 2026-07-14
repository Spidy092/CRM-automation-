import { z } from 'zod';

const formFieldSchema = z.object({
  name: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'email', 'phone', 'number', 'textarea', 'select', 'checkbox', 'hidden']),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  leadField: z.string().max(100).optional(),
});

export const createFormSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens')
    .optional(),
  description: z.string().max(2000).optional().nullable(),
  fields: z.array(formFieldSchema).min(1, 'At least one field is required'),
  submit_action: z
    .enum(['create_lead', 'send_email', 'redirect'])
    .optional()
    .default('create_lead'),
  submit_message: z.string().max(500).optional().default('Thank you for your submission!'),
  redirect_url: z.string().url().max(500).optional().nullable(),
  is_active: z.boolean().optional(),
  theme: z.record(z.string(), z.unknown()).optional(),
});

export const updateFormSchema = createFormSchema.partial();

export const formIdParamSchema = z.object({
  formId: z.string().uuid(),
});

export const submitFormBodySchema = z.record(z.string(), z.unknown());

export const listFormsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateFormBody = z.infer<typeof createFormSchema>;
export type UpdateFormBody = z.infer<typeof updateFormSchema>;
export type SubmitFormBody = z.infer<typeof submitFormBodySchema>;
