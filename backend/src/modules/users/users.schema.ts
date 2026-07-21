import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
});

export type UpdateProfileSchemaInput = z.infer<typeof updateProfileSchema>;

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or fewer'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  role: z.enum(['admin', 'manager', 'sales', 'marketing', 'viewer']),
  is_active: z.boolean().optional().default(true),
});

export type CreateUserSchemaInput = z.infer<typeof createUserSchema>;

export const updatePermissionsSchema = z
  .object({
    role: z.enum(['admin', 'manager', 'sales', 'marketing', 'viewer']).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => data.role !== undefined || data.is_active !== undefined, {
    message: 'At least one of role or is_active must be provided',
  });

export type UpdatePermissionsSchemaInput = z.infer<typeof updatePermissionsSchema>;
