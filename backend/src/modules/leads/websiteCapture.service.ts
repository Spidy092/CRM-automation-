import { randomUUID, createHash } from 'crypto';
import { z } from 'zod';
import { createLeadSchema } from './leads.schema';
import { findExistingForDedup, insertLead } from './leads.repository';
import type { LeadInput, LeadRow } from './leads.types';
import { AppError } from '../../shared/middleware/errorHandler';
import { normalizePhone } from '../../shared/utils/phone';
import { withAdvisoryLocks } from '../../shared/utils/db';
import { err, ok, type Result } from '../../shared/utils/result';

const websiteLeadSchema = createLeadSchema
  .omit({
    assigned_to: true,
    pipeline_stage_id: true,
    custom_fields: true,
    country: true,
    google_rating: true,
    review_count: true,
    social_links: true,
    tags: true,
    deal_value: true,
    next_follow_up_at: true,
  })
  .extend({
    source_platform: z.literal('website_form'),
    email: z.union([z.string().trim().email().max(255), z.literal('')]),
    phone: z.string().trim().max(50),
  });

/** Public capture cannot assign owners, stages, or overwrite an existing lead. */
export async function captureWebsiteLead(input: LeadInput): Promise<Result<LeadRow, AppError>> {
  const parsed = websiteLeadSchema.safeParse({ ...input, source_platform: 'website_form' });
  if (!parsed.success) return err(new AppError('Contact details are invalid', 422));
  const prepared = {
    ...parsed.data,
    email: parsed.data.email.toLowerCase(),
    phone: normalizePhone(parsed.data.phone),
  };
  // Hash contact identifiers so lock keys never contain PII.
  const lockKeys = [prepared.email, prepared.phone]
    .filter(Boolean)
    .map((value) => `website-capture:${createHash('sha256').update(value).digest('hex')}`)
    .sort();
  try {
    return await withAdvisoryLocks(lockKeys, async (): Promise<Result<LeadRow, AppError>> => {
      if (prepared.email || prepared.phone) {
        // The shared lookup uses OR; absent contacts must not match empty columns.
        const existing = await findExistingForDedup(
          prepared.email || `missing:${randomUUID()}`,
          prepared.phone || `missing:${randomUUID()}`,
          'website_form',
        );
        if (existing) return ok(existing);
      }
      return ok(await insertLead(prepared));
    });
  } catch {
    return err(new AppError('Could not create the CRM lead', 500));
  }
}
