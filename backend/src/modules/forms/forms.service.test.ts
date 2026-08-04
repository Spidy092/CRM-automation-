import {
  listForms,
  getForm,
  getFormBySlug,
  createForm,
  updateFormById,
  deleteFormById,
  submitForm,
  getFormAnalyticsById,
  generateEmbedSnippet,
} from './forms.service';
import {
  findForms,
  countForms,
  findFormById,
  findFormBySlug,
  insertForm,
  updateForm,
  deleteForm,
  insertSubmission,
  getFormAnalytics,
} from './forms.repository';
import { insertLead } from '../leads/leads.repository';
import { writeAuditLog } from '../../shared/utils/audit';
import * as sendgrid from '../integrations/sendgrid/sendgrid.connector';
import * as smtp from '../integrations/smtp/smtp.connector';
import type { FormRow } from './forms.types';

jest.mock('./forms.repository');
jest.mock('../leads/leads.repository', () => ({ insertLead: jest.fn() }));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock('../integrations/sendgrid/sendgrid.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../integrations/smtp/smtp.connector', () => ({ sendEmail: jest.fn() }));

const mockFindForms = findForms as jest.Mock;
const mockCountForms = countForms as jest.Mock;
const mockFindFormById = findFormById as jest.Mock;
const mockFindFormBySlug = findFormBySlug as jest.Mock;
const mockInsertForm = insertForm as jest.Mock;
const mockUpdateForm = updateForm as jest.Mock;
const mockDeleteForm = deleteForm as jest.Mock;
const mockInsertSubmission = insertSubmission as jest.Mock;
const mockGetFormAnalytics = getFormAnalytics as jest.Mock;
const mockInsertLead = insertLead as jest.Mock;
const mockWriteAuditLog = writeAuditLog as jest.Mock;
const mockSgSend = sendgrid.sendEmail as jest.Mock;
const mockSmtpSend = smtp.sendEmail as jest.Mock;

const ACTOR = { id: 'u1', role: 'admin', ipAddress: '1.2.3.4' };

const FORM: FormRow = {
  id: 'f1',
  name: 'Contact Us',
  slug: 'contact-us',
  description: null,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'name', label: 'Name', type: 'text', required: false, leadField: 'contact_name' },
  ],
  submit_action: 'create_lead',
  submit_message: 'Thanks!',
  redirect_url: null,
  is_active: true,
  theme: {},
  email_settings: {},
  created_by: 'u1',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('listForms', () => {
  it('paginates and returns items with meta', async () => {
    mockFindForms.mockResolvedValue([FORM]);
    mockCountForms.mockResolvedValue(1);
    const result = await listForms(10, 0);
    expect(result.items).toEqual([FORM]);
    expect(result.meta).toEqual({ limit: 10, offset: 0, total: 1 });
  });
});

describe('getForm', () => {
  it('returns the form when found', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    await expect(getForm('f1')).resolves.toEqual(FORM);
  });

  it('throws 404 when not found', async () => {
    mockFindFormById.mockResolvedValue(null);
    await expect(getForm('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('getFormBySlug', () => {
  it('returns the form when found and active', async () => {
    mockFindFormBySlug.mockResolvedValue(FORM);
    await expect(getFormBySlug('contact-us')).resolves.toEqual(FORM);
  });

  it('throws 403 when form is inactive', async () => {
    mockFindFormBySlug.mockResolvedValue({ ...FORM, is_active: false });
    await expect(getFormBySlug('contact-us')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 404 when not found', async () => {
    mockFindFormBySlug.mockResolvedValue(null);
    await expect(getFormBySlug('missing')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('createForm', () => {
  it('slugifies the name when no slug is given and writes an audit log', async () => {
    mockFindFormBySlug.mockResolvedValue(null);
    mockInsertForm.mockResolvedValue(FORM);
    const result = await createForm({ name: 'Contact Us', fields: FORM.fields }, ACTOR);
    expect(mockInsertForm).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'contact-us', created_by: 'u1' }),
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form.created', userId: 'u1' }),
    );
    expect(result).toEqual(FORM);
  });

  it('rejects when the slug already exists', async () => {
    mockFindFormBySlug.mockResolvedValue(FORM);
    await expect(
      createForm({ name: 'Contact Us', slug: 'contact-us', fields: FORM.fields }, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockInsertForm).not.toHaveBeenCalled();
  });
});

describe('updateFormById', () => {
  it('updates and writes an audit log with old/new values', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockUpdateForm.mockResolvedValue({ ...FORM, name: 'New Name' });
    const result = await updateFormById('f1', { name: 'New Name' }, ACTOR);
    expect(result.name).toBe('New Name');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form.updated' }),
    );
  });

  it('throws 404 when the form does not exist', async () => {
    mockFindFormById.mockResolvedValue(null);
    await expect(updateFormById('missing', {}, ACTOR)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects a slug change that collides with another form', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockFindFormBySlug.mockResolvedValue({ ...FORM, id: 'other' });
    await expect(
      updateFormById('f1', { slug: 'taken-slug' }, ACTOR),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockUpdateForm).not.toHaveBeenCalled();
  });

  it('allows setting the slug to its own current value', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockUpdateForm.mockResolvedValue(FORM);
    await updateFormById('f1', { slug: 'contact-us' }, ACTOR);
    expect(mockFindFormBySlug).not.toHaveBeenCalled();
  });
});

describe('deleteFormById', () => {
  it('deletes and writes an audit log', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    await deleteFormById('f1', ACTOR);
    expect(mockDeleteForm).toHaveBeenCalledWith('f1');
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'form.deleted' }),
    );
  });

  it('throws 404 when the form does not exist', async () => {
    mockFindFormById.mockResolvedValue(null);
    await expect(deleteFormById('missing', ACTOR)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('submitForm', () => {
  const meta = { ipAddress: '1.2.3.4', userAgent: 'jest', referrer: 'https://google.com' };

  it('throws 404 when the form does not exist', async () => {
    mockFindFormById.mockResolvedValue(null);
    await expect(submitForm('missing', {}, meta)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 400 when the form is inactive', async () => {
    mockFindFormById.mockResolvedValue({ ...FORM, is_active: false });
    await expect(submitForm('f1', { email: 'a@b.com' }, meta)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('throws 422 when a required field is missing', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    await expect(submitForm('f1', { name: 'Jane' }, meta)).rejects.toMatchObject({
      statusCode: 422,
    });
  });

  it('accepts falsy-but-present values (0/false) for required fields', async () => {
    const form = {
      ...FORM,
      fields: [{ name: 'count', label: 'Count', type: 'number', required: true }],
    };
    mockFindFormById.mockResolvedValue(form);
    mockInsertSubmission.mockResolvedValue({ id: 's1' });
    await expect(submitForm('f1', { count: 0 }, meta)).resolves.toBeDefined();
  });

  it('creates a lead using leadField mappings when submit_action is create_lead', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockInsertLead.mockResolvedValue({ id: 'lead-1' });
    mockInsertSubmission.mockResolvedValue({ id: 's1', form_id: 'f1', lead_id: 'lead-1' });

    const result = await submitForm(
      'f1',
      { email: 'jane@example.com', name: 'Jane Doe' },
      meta,
    );

    expect(mockInsertLead).toHaveBeenCalledWith(
      expect.objectContaining({ contact_name: 'Jane Doe', email: 'jane@example.com' }),
    );
    expect(result.leadId).toBe('lead-1');
    expect(result.message).toBe('Thanks!');
  });

  it('continues without a leadId when lead creation fails', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockInsertLead.mockRejectedValue(new Error('db down'));
    mockInsertSubmission.mockResolvedValue({ id: 's1', form_id: 'f1', lead_id: null });

    const result = await submitForm('f1', { email: 'jane@example.com' }, meta);
    expect(result.leadId).toBeUndefined();
    expect(mockInsertSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ lead_id: null }),
    );
  });

  it('skips lead creation when submit_action is not create_lead', async () => {
    mockFindFormById.mockResolvedValue({ ...FORM, submit_action: 'send_email' });
    mockInsertSubmission.mockResolvedValue({ id: 's1' });
    await submitForm('f1', { email: 'jane@example.com' }, meta);
    expect(mockInsertLead).not.toHaveBeenCalled();
  });

  it('dispatches auto-reply emails via SendGrid when configured and returns emailStatus', async () => {
    const formWithEmail = {
      ...FORM,
      submit_action: 'send_email',
      email_settings: {
        autoReply: {
          enabled: true,
          fromName: 'CRM',
          fromEmail: 'noreply@crm.com',
          subject: 'Hi {name}',
          body: 'Thanks {name}',
        },
      },
    };
    mockFindFormById.mockResolvedValue(formWithEmail);
    mockInsertSubmission.mockResolvedValue({ id: 's1' });
    mockSgSend.mockResolvedValue({ ok: true });

    const result = await submitForm('f1', { email: 'jane@example.com', name: 'Jane' }, meta);

    expect(mockSgSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', subject: 'Hi Jane' }),
    );
    expect(result.emailStatus).toEqual({
      success: true,
      sentCount: 1,
      failedCount: 0,
    });
  });

  it('falls back to SMTP when SendGrid fails and returns success if SMTP succeeds', async () => {
    const formWithEmail = {
      ...FORM,
      submit_action: 'send_email',
      email_settings: {
        autoReply: {
          enabled: true,
          fromName: 'CRM',
          fromEmail: 'noreply@crm.com',
          subject: 'Hi {name}',
          body: 'Thanks {name}',
        },
      },
    };
    mockFindFormById.mockResolvedValue(formWithEmail);
    mockInsertSubmission.mockResolvedValue({ id: 's1' });
    mockSgSend.mockResolvedValue({ ok: false, error: 'SendGrid down' });
    mockSmtpSend.mockResolvedValue({ ok: true });

    const result = await submitForm('f1', { email: 'jane@example.com', name: 'Jane' }, meta);
    expect(mockSmtpSend).toHaveBeenCalled();
    expect(result.emailStatus?.success).toBe(true);
  });

  it('throws 422 when field validation fails for invalid email format', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    await expect(submitForm('f1', { email: 'not-an-email' }, meta)).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});

describe('getFormAnalyticsById', () => {
  it('computes the conversion rate from totals', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockGetFormAnalytics.mockResolvedValue({
      totalSubmissions: 20,
      uniqueLeads: 5,
      submissionsByDay: [],
      topReferrers: [],
    });
    const result = await getFormAnalyticsById('f1', ACTOR);
    expect(result.conversionRate).toBe(25);
    expect(result.formName).toBe('Contact Us');
  });

  it('returns a 0% conversion rate when there are no submissions', async () => {
    mockFindFormById.mockResolvedValue(FORM);
    mockGetFormAnalytics.mockResolvedValue({
      totalSubmissions: 0,
      uniqueLeads: 0,
      submissionsByDay: [],
      topReferrers: [],
    });
    const result = await getFormAnalyticsById('f1', ACTOR);
    expect(result.conversionRate).toBe(0);
  });

  it('throws 404 when the form does not exist', async () => {
    mockFindFormById.mockResolvedValue(null);
    await expect(getFormAnalyticsById('missing', ACTOR)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('generateEmbedSnippet', () => {
  it('builds an iframe snippet pointing at the form slug', () => {
    const snippet = generateEmbedSnippet(FORM, 'https://crm.example.com');
    expect(snippet).toContain('https://crm.example.com/forms/contact-us');
    expect(snippet).toContain('<iframe');
    expect(snippet).toContain(FORM.name);
  });
});
