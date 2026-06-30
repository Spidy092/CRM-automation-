import { AppError } from '../../shared/middleware/errorHandler';
import { logger } from '../../shared/utils/logger';
import { writeAuditLog } from '../../shared/utils/audit';
import { findLeadById, updateLead } from './leads.repository';
import { enrichDomain } from '../integrations/hunter/hunter.service';
import { AuthenticatedUser } from '../../shared/types';

const MIN_CONFIDENCE = 50;

function isPlaceholderEmail(email: string): boolean {
  return email.includes('scraped.local') || email.startsWith('no-reply-');
}

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .trim()
    .toLowerCase();
}

function isValidDomain(domain: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(
    domain,
  );
}

export async function enrichLead(
  id: string,
  actor: { id: string; role: AuthenticatedUser['role']; ipAddress?: string | null },
) {
  const lead = await findLeadById(id);
  if (!lead) {
    throw new AppError('Lead not found', 404);
  }

  let rawDomain = lead.website;

  if (!rawDomain && lead.email && !isPlaceholderEmail(lead.email)) {
    rawDomain = lead.email.split('@')[1];
  }

  if (!rawDomain) {
    throw new AppError('Lead does not have a website or real email domain to enrich.', 400);
  }

  const domain = normalizeDomain(rawDomain);

  if (!isValidDomain(domain)) {
    throw new AppError(`Invalid domain extracted: "${domain}". Cannot enrich.`, 400);
  }

  logger.info('starting enrichment for lead', { leadId: id, domain });

  const result = await enrichDomain(domain);
  if (!result) {
    throw new AppError('No contacts found for this domain.', 404);
  }

  if (result.confidence < MIN_CONFIDENCE) {
    throw new AppError(
      `Hunter confidence too low (${result.confidence}/100, minimum ${MIN_CONFIDENCE}). Skipping enrichment.`,
      422,
    );
  }

  const customFields =
    typeof lead.custom_fields === 'object' && lead.custom_fields !== null
      ? ({ ...lead.custom_fields } as Record<string, unknown>)
      : {};

  if (result.first_name) customFields['hunter_first_name'] = result.first_name;
  if (result.last_name) customFields['hunter_last_name'] = result.last_name;
  if (result.position) customFields['hunter_position'] = result.position;
  if (result.linkedin) customFields['hunter_linkedin'] = result.linkedin;
  if (result.twitter) customFields['hunter_twitter'] = result.twitter;
  customFields['hunter_confidence'] = result.confidence;

  const updateFields: Record<string, unknown> = {
    custom_fields: customFields,
  };

  // Only replace email if current email is a placeholder or empty
  if (!lead.email || isPlaceholderEmail(lead.email)) {
    updateFields.email = result.email;
  }

  if (result.first_name || result.last_name) {
    const fullName = [result.first_name, result.last_name].filter(Boolean).join(' ');
    if (!lead.contact_name || lead.contact_name.trim() === '') {
      updateFields.contact_name = fullName;
    }
  }

  const updatedLead = await updateLead(id, updateFields);

  await writeAuditLog({
    userId: actor.id,
    action: 'lead.enriched',
    entityType: 'lead',
    entityId: id,
    newValue: { domain, email: result.email, confidence: result.confidence },
    ipAddress: actor.ipAddress ?? null,
  });

  return updatedLead;
}
