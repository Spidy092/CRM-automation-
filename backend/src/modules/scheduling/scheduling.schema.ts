import { z } from 'zod';

export const availabilitySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
    slotDurationMin: z.number().int().min(15).max(480).default(30),
    isActive: z.boolean().default(true),
  })
  .refine((data) => !data.isActive || data.startTime < data.endTime, {
    message: 'Start time must be before end time',
    path: ['endTime'],
  });

export const bulkAvailabilitySchema = z.object({
  slots: z.array(availabilitySchema),
});

export const createBookingUrlSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  locationType: z.enum(['google_meet', 'phone', 'custom']).default('google_meet'),
  locationDetails: z.string().max(500).optional(),
  bufferBeforeMin: z.number().int().min(0).max(60).default(0),
  bufferAfterMin: z.number().int().min(0).max(60).default(0),
  maxAdvanceDays: z.number().int().min(1).max(90).default(30),
});

export const updateBookingUrlSchema = createBookingUrlSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createBookingSchema = z.object({
  bookerName: z.string().min(1).max(200),
  bookerEmail: z.string().email(),
  bookerPhone: z.string().max(30).optional(),
  startsAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
  leadId: z.string().uuid().optional(),
});

export const createInternalBookingSchema = z.object({
  leadId: z.string().uuid().optional(),
  bookingUrlId: z.string().uuid().optional(),
  bookerName: z.string().min(1).max(200),
  bookerEmail: z.string().email(),
  bookerPhone: z.string().max(30).optional(),
  startsAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
  forceOverride: z.boolean().default(false),
});

export const bookingUrlSlugParamSchema = z.object({
  slug: z.string().min(1).max(100),
});

export const bookingIdParamSchema = z.object({
  bookingId: z.string().uuid(),
});

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: z.string().uuid().optional(),
});

export const createDateOverrideSchema = z.object({
  overrideDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  isBlocked: z.boolean().default(true),
  startTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  endTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  reason: z.string().max(255).optional(),
});

export const overrideIdParamSchema = z.object({
  overrideId: z.string().uuid(),
});
