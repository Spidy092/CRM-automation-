import { pool, queryOne } from '../shared/utils/db';
import { logger } from '../shared/utils/logger';

/**
 * Facebook Lead Ads webhook payload structure.
 *
 * Facebook sends lead form submissions as:
 * {
 *   object: "page",
 *   entry: [{
 *     id: string,
 *     time: number,
 *     changes: [{
 *       value: {
 *         form_id: string,
 *         ad_id: string,
 *         adset_id: string,
 *         campaign_id: string,
 *         page_id: string,
 *         leadgen_id: string,
 *         created_time: number,
 *         field_data: [{ name: string, values: string[] }]
 *       },
 *       field: "leads"
 *     }]
 *   }]
 * }
 */

interface FacebookFieldData {
  name: string;
  values: string[];
}

interface FacebookLeadChange {
  value: {
    form_id: string;
    ad_id?: string;
    adset_id?: string;
    campaign_id?: string;
    page_id?: string;
    leadgen_id: string;
    created_time: number;
    field_data: FacebookFieldData[];
  };
  field: string;
}

interface FacebookEntry {
  id: string;
  time: number;
  changes: FacebookLeadChange[];
}

interface FacebookLeadPayload {
  object: string;
  entry: FacebookEntry[];
}

function extractField(fieldData: FacebookFieldData[], fieldName: string): string {
  const field = fieldData.find((f) => f.name.toLowerCase() === fieldName.toLowerCase());
  if (!field || field.values.length === 0) return '';
  return field.values[0];
}

function buildFieldMap(fieldData: FacebookFieldData[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const field of fieldData) {
    map[field.name.toLowerCase()] = field.values[0] ?? '';
  }
  return map;
}

/**
 * Handle Facebook Lead Ads form submission.
 * Creates or updates a lead from the Facebook webhook payload.
 */
export async function handleFacebookLeadAd(
  payload: Record<string, unknown>,
): Promise<{ action: string; leadId?: string; details?: string }> {
  const body = payload as unknown as FacebookLeadPayload;

  if (body.object !== 'page' || !body.entry || body.entry.length === 0) {
    return { action: 'noop', details: 'Not a page lead event' };
  }

  const entry = body.entry[0];
  const change = entry.changes?.[0];
  if (!change || change.field !== 'leads') {
    return { action: 'noop', details: 'Not a leads field event' };
  }

  const leadData = change.value;
  const fieldData = leadData.field_data ?? [];
  const fields = buildFieldMap(fieldData);

  const leadgenId = leadData.leadgen_id;
  const formId = leadData.form_id;
  const adId = leadData.ad_id ?? '';

  logger.info('Facebook Lead Ads received', {
    leadgenId,
    formId,
    adId,
    fieldCount: fieldData.length,
  });

  // Map Facebook fields to CRM lead fields
  const email = extractField(fieldData, 'email') || extractField(fieldData, 'email_address');
  const phone = extractField(fieldData, 'phone_number') || extractField(fieldData, 'phone');
  const fullName =
    extractField(fieldData, 'full_name') ||
    extractField(fieldData, 'name') ||
    extractField(fieldData, 'first_name');
  const companyName = extractField(fieldData, 'company_name') || extractField(fieldData, 'company');
  const city = extractField(fieldData, 'city') || extractField(fieldData, 'location');
  const state = extractField(fieldData, 'state') || extractField(fieldData, 'region');
  const countryCode = extractField(fieldData, 'country') || extractField(fieldData, 'country_code');
  const jobTitle = extractField(fieldData, 'job_title') || extractField(fieldData, 'title');

  const location = [city, state, countryCode].filter(Boolean).join(', ') || '';

  // Dedup by email, phone, or Facebook leadgen_id
  let existing: { id: string } | null = null;

  if (email) {
    existing = await queryOne<{ id: string }>(
      `SELECT id FROM leads WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email.toLowerCase()],
    );
  }

  if (!existing && phone) {
    existing = await queryOne<{ id: string }>(
      `SELECT id FROM leads WHERE phone = $1 AND deleted_at IS NULL LIMIT 1`,
      [phone],
    );
  }

  if (!existing) {
    existing = await queryOne<{ id: string }>(
      `SELECT id FROM leads WHERE source_platform = 'facebook' AND external_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [leadgenId],
    );
  }

  if (existing) {
    // Update existing lead with new Facebook data
    await pool.query(
      `UPDATE leads SET
         contact_name = COALESCE(NULLIF($1, ''), contact_name),
         phone = COALESCE(NULLIF($2, ''), phone),
         email = COALESCE(NULLIF($3, ''), email),
         business_name = COALESCE(NULLIF($4, ''), business_name),
         location = COALESCE(NULLIF($5, ''), location),
         industry = COALESCE(NULLIF($6, ''), industry),
         updated_at = NOW()
       WHERE id = $7 AND deleted_at IS NULL`,
      [
        fullName || jobTitle,
        phone,
        email.toLowerCase(),
        companyName,
        location,
        jobTitle,
        existing.id,
      ],
    );

    logger.info('Facebook Lead Ads updated existing lead', {
      leadId: existing.id,
      leadgenId,
    });

    return {
      action: 'lead_updated',
      leadId: existing.id,
      details: `Existing lead updated from Facebook lead ${leadgenId}`,
    };
  }

  // Create new lead
  const contactName = fullName || `FB Lead ${leadgenId.slice(-6)}`;
  const businessName = companyName || contactName;

  const created = await queryOne<{ id: string }>(
    `INSERT INTO leads (
       business_name, contact_name, phone, email, location, industry,
       source_platform, external_id, status, notes
     ) VALUES ($1, $2, $3, $4, $5, $6, 'facebook', $7, 'active', $8)
     RETURNING id`,
    [
      businessName,
      contactName,
      phone,
      email || `fb_${leadgenId}@facebook.local`,
      location,
      jobTitle,
      leadgenId,
      JSON.stringify({
        form_id: formId,
        ad_id: adId,
        adset_id: leadData.adset_id,
        campaign_id: leadData.campaign_id,
        page_id: leadData.page_id,
        raw_field_data: fields,
      }),
    ],
  );

  logger.info('Facebook Lead Ads lead created', {
    leadId: created?.id,
    leadgenId,
    formId,
  });

  return {
    action: 'lead_created',
    leadId: created?.id,
    details: `New lead from Facebook Lead Ads ${leadgenId}`,
  };
}
