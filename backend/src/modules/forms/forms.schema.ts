import { z } from 'zod';

const formFieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_]+$/, 'field name must be alphanumeric with underscores')
    .refine(
      (val) => !['__proto__', 'constructor', 'prototype'].includes(val),
      'Reserved field name',
    ),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'email', 'phone', 'number', 'textarea', 'select', 'checkbox', 'hidden']),
  required: z.boolean(),
  placeholder: z.string().max(200).optional(),
  options: z.array(z.string()).optional(),
  defaultValue: z.string().optional(),
  leadField: z.string().max(100).optional(),
});

export const createFormSchema = z
  .object({
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
    email_settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.submit_action === 'redirect') {
        return Boolean(data.redirect_url && data.redirect_url.trim().length > 0);
      }
      return true;
    },
    {
      message: 'redirect_url is required when submit_action is redirect',
      path: ['redirect_url'],
    },
  );

export const updateFormSchema = z
  .object({
    name: z.string().min(1, 'name is required').max(255).optional(),
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens')
      .optional(),
    description: z.string().max(2000).optional().nullable(),
    fields: z.array(formFieldSchema).min(1).optional(),
    submit_action: z.enum(['create_lead', 'send_email', 'redirect']).optional(),
    submit_message: z.string().max(500).optional(),
    redirect_url: z.string().url().max(500).optional().nullable(),
    is_active: z.boolean().optional(),
    theme: z.record(z.string(), z.unknown()).optional(),
    email_settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      if (data.submit_action === 'redirect' && data.redirect_url !== undefined) {
        return Boolean(data.redirect_url && data.redirect_url.trim().length > 0);
      }
      return true;
    },
    {
      message: 'redirect_url is required when submit_action is redirect',
      path: ['redirect_url'],
    },
  );

export const formIdParamSchema = z.object({
  formId: z.string().uuid(),
});

export const submitFormBodySchema = z.record(
  z.string().min(1, 'key must not be empty').max(100, 'key name too long'),
  z.union([
    z.string().max(5000, 'field value too long'),
    z.number(),
    z.boolean(),
    z.array(z.string().max(1000)),
    z.null(),
  ]),
);

export const listFormsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export type CreateFormBody = z.infer<typeof createFormSchema>;
export type UpdateFormBody = z.infer<typeof updateFormSchema>;
export type SubmitFormBody = z.infer<typeof submitFormBodySchema>;
