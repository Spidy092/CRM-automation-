import { z } from 'zod';
import type { FormFieldDef } from './forms.types';

const formFieldSchema = z
  .object({
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
    leadField: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9_]*$/, 'Lead field must be alphanumeric with underscores')
      .refine(
        (value) => !['__proto__', 'constructor', 'prototype'].includes(value),
        'Reserved lead field',
      )
      .optional(),
  })
  .refine((field) => field.type !== 'select' || Boolean(field.options?.length), {
    message: 'Dropdown fields need at least one option',
    path: ['options'],
  });

const fieldsSchema = z
  .array(formFieldSchema)
  .min(1, 'At least one field is required')
  .max(100)
  .refine(
    (fields) => new Set(fields.map((field) => field.name)).size === fields.length,
    'Field names must be unique',
  );
const redirectSchema = z
  .string()
  .url()
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'Redirect must use HTTP or HTTPS');

const notificationSchema = z
  .object({
    enabled: z.boolean(),
    emails: z.string().max(2000).optional(),
    subject: z.string().max(500).optional(),
    body: z.string().max(20000).optional(),
  })
  .refine(
    (value) =>
      !value.enabled ||
      Boolean(value.emails?.trim() && value.subject?.trim() && value.body?.trim()),
    'Enabled notifications need recipients, a subject, and a message',
  );
export const emailSettingsSchema = z.object({
  autoReply: z
    .object({
      enabled: z.boolean(),
      fromName: z.string().max(255).optional(),
      fromEmail: z.string().max(255).optional(),
      subject: z.string().max(500).optional(),
      body: z.string().max(20000).optional(),
    })
    .refine(
      (value) => !value.enabled || Boolean(value.subject?.trim() && value.body?.trim()),
      'Enabled confirmation emails need a subject and message',
    )
    .refine(
      (value) => !value.fromEmail || z.string().email().safeParse(value.fromEmail).success,
      'Invalid sender email address',
    )
    .optional(),
  teamNotification: notificationSchema.optional(),
  partnerNotification: notificationSchema.optional(),
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
    fields: fieldsSchema,
    submit_action: z
      .enum(['create_lead', 'send_email', 'redirect'])
      .optional()
      .default('create_lead'),
    submit_message: z.string().max(500).optional().default('Thank you for your submission!'),
    redirect_url: redirectSchema.optional().nullable(),
    is_active: z.boolean().optional(),
    theme: z.record(z.string(), z.unknown()).optional(),
    email_settings: emailSettingsSchema.optional(),
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
    fields: fieldsSchema.optional(),
    submit_action: z.enum(['create_lead', 'send_email', 'redirect']).optional(),
    submit_message: z.string().max(500).optional(),
    redirect_url: redirectSchema.optional().nullable(),
    is_active: z.boolean().optional(),
    theme: z.record(z.string(), z.unknown()).optional(),
    email_settings: emailSettingsSchema.optional(),
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

/** Build validation from the saved definition; public clients can bypass HTML rules. */
export function submissionDefinitionSchema(
  fields: FormFieldDef[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let value: z.ZodTypeAny;
    if (field.type === 'checkbox') {
      value = field.required
        ? z.literal(true, { errorMap: () => ({ message: `${field.label} must be checked` }) })
        : z.boolean();
    } else if (field.type === 'number') {
      value = z.union([
        z.number().finite(),
        z
          .string()
          .trim()
          .refine(
            (text) =>
              (!field.required && text === '') ||
              (text.length > 0 && Number.isFinite(Number(text))),
            `${field.label} must be a number`,
          ),
      ]);
    } else {
      let text = z.string().trim().max(5000);
      if (field.required) text = text.min(1, `${field.label} is required`);
      if (field.type === 'email') text = text.email(`${field.label} must be a valid email address`);
      value = text;
      if (field.type === 'select' && field.options?.length) {
        value = text.refine(
          (option) => field.options!.includes(option),
          `Invalid selection for ${field.label}`,
        );
      }
    }
    if (!field.required) value = z.union([value, z.literal(''), z.null()]).optional();
    // Definitions created before reserved-name checks must never affect object prototypes.
    if (!['__proto__', 'constructor', 'prototype'].includes(field.name)) shape[field.name] = value;
  }
  return z.object(shape).strict();
}

export const formSubmissionParamSchema = formIdParamSchema.extend({
  submissionId: z.string().uuid(),
});
