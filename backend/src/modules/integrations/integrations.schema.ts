import { z } from 'zod';

export const integrationIdParamSchema = z.object({
  id: z.string().uuid('Integration id must be a valid UUID'),
});

/**
 * Each vendor has its own credential shape. We accept any non-empty object
 * here and let the connector (added in Sprint 3b — S3-07/08/09) validate
 * vendor-specific required keys.
 */
export const integrationCredentialsSchema = z
  .record(z.unknown())
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'credentials object must contain at least one field',
  });

export const updateIntegrationSchema = z
  .object({
    is_enabled: z.boolean().optional(),
    credentials: integrationCredentialsSchema.nullable().optional(),
  })
  .refine((data) => data.is_enabled !== undefined || data.credentials !== undefined, {
    message: 'Provide at least one of: is_enabled, credentials',
  });

export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;
