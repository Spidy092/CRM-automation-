import { copyFile, unlink } from 'fs/promises';
import {
  duplicateTemplate,
  updateTemplate,
  leadToVariableValues,
  prepareTemplateContent,
  previewTemplate,
  resolveEmailPayload,
  setTemplateArchived,
  testSendTemplate,
} from './templates.service';
import { TEMPLATE_DESIGN_VERSION } from './templateDesign';

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  copyFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./templates.repository', () => ({
  findTemplates: jest.fn(),
  findTemplateById: jest.fn(),
  insertTemplate: jest.fn(),
  updateTemplate: jest.fn(),
  setApprovalStatus: jest.fn(),
  deleteTemplate: jest.fn(),
  appendTemplateAttachment: jest.fn(),
  removeTemplateAttachment: jest.fn(),
}));

jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));
jest.mock('../integrations/sendgrid/sendgrid.connector', () => ({ sendEmail: jest.fn() }));
jest.mock('../integrations/smtp/smtp.connector', () => ({ sendEmail: jest.fn() }));

import {
  findTemplateById,
  insertTemplate,
  setApprovalStatus,
  updateTemplate as updateRepo,
} from './templates.repository';
import { sendEmail as sendgridSend } from '../integrations/sendgrid/sendgrid.connector';
import { sendEmail as smtpSend } from '../integrations/smtp/smtp.connector';

const actor = { id: 'u1', role: 'admin' as const, ipAddress: '127.0.0.1' };

function visualRow() {
  return {
    id: 't1',
    name: 'Visual',
    channel: 'email',
    subject: 'Hi {{first_name}}',
    body: 'fallback',
    variables: ['first_name'],
    attachments: [],
    approval_status: 'approved',
    approved_by: 'u1',
    approved_at: '2026-01-01T00:00:00Z',
    rejection_reason: null,
    editor_mode: 'visual',
    design: {
      version: TEMPLATE_DESIGN_VERSION,
      global: {
        backgroundColor: '#f1f5f9',
        contentWidth: 600,
        brandColor: '#4338ca',
        fontFamily: 'Arial',
        preheader: '',
      },
      blocks: [
        {
          id: 't1',
          type: 'text',
          props: {
            text: 'Hi {{first_name}}',
            fontSize: 16,
            color: '#1e293b',
            align: 'left',
            bold: false,
            italic: false,
          },
        },
        {
          id: 'f1',
          type: 'footer',
          props: {
            text: 'Acme',
            backgroundColor: '#f8fafc',
            textColor: '#64748b',
            unsubscribeHref: '{{unsubscribe_link}}',
          },
        },
      ],
    },
    html_body: '<table><tr><td>Hi {{first_name}}</td></tr></table>',
    text_body: 'Hi {{first_name}}',
    preheader: null,
    archived_at: null,
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('prepareTemplateContent', () => {
  it('keeps simple templates on the legacy path', () => {
    const out = prepareTemplateContent({
      channel: 'email',
      body: 'Hi {{first_name}}',
      subject: 'Hey',
    });
    expect(out.editor_mode).toBe('simple');
    expect(out.html_body).toBeNull();
    expect(out.variables).toEqual(expect.arrayContaining(['first_name']));
  });

  it('forces simple mode for non-email channels and ignores design payloads', () => {
    const out = prepareTemplateContent({
      channel: 'sms',
      editor_mode: 'visual',
      design: { version: 1 },
      body: 'Hi {{first_name}}',
    });
    expect(out.editor_mode).toBe('simple');
    expect(out.design).toBeNull();
  });

  it('validates visual designs server-side and renders deterministic output', () => {
    const design = visualRow().design as unknown as unknown;
    const first = prepareTemplateContent({
      channel: 'email',
      editor_mode: 'visual',
      design,
      body: 'ignored',
    });
    const second = prepareTemplateContent({
      channel: 'email',
      editor_mode: 'visual',
      design,
      body: 'ignored',
    });
    expect(first.html_body).toBe(second.html_body);
    expect(first.text_body).toContain('{{first_name}}');
  });

  it('rejects visual designs without a footer (422)', () => {
    const design = JSON.parse(JSON.stringify(visualRow().design));
    design.blocks = design.blocks.filter((b: { type: string }) => b.type !== 'footer');
    expect(() =>
      prepareTemplateContent({ channel: 'email', editor_mode: 'visual', design, body: 'x' }),
    ).toThrow(/footer/i);
  });

  it('sanitizes custom HTML and distinguishes it from visual mode', () => {
    const out = prepareTemplateContent({
      channel: 'email',
      editor_mode: 'html',
      body: '<p>Hi</p><script>alert(1)</script>',
    });
    expect(out.editor_mode).toBe('html');
    expect(out.design).toBeNull();
    expect(out.html_body).not.toContain('<script');
    expect(out.html_body).toContain('Hi');
  });
});

describe('leadToVariableValues + resolveEmailPayload', () => {
  it('maps lead fields and escapes HTML context', () => {
    const values = leadToVariableValues({
      business_name: 'Acme',
      contact_name: 'Jordan Lee',
      industry: 'retail',
      location: 'Austin',
      country: null,
      google_rating: null,
      source_platform: 'web',
      classification: null,
    });
    expect(values.first_name).toBe('Jordan');
    const payload = resolveEmailPayload(
      {
        editor_mode: 'visual',
        body: 'Hi',
        html_body: '<p>Hi {{first_name}} <b>{{business_name}}</b></p>',
        text_body: 'Hi {{first_name}}',
        subject: 'Hey {{first_name}}',
      },
      { ...values, first_name: '<img src=x onerror=1>', business_name: 'Acme' },
    );
    expect(payload.html).toContain('&lt;img');
    expect(payload.subject).toBe('Hey <img src=x onerror=1>');
  });

  it('falls back to raw body for simple templates (legacy compatibility)', () => {
    const payload = resolveEmailPayload(
      {
        editor_mode: 'simple',
        body: 'Hi {{first_name}}',
        html_body: null,
        text_body: null,
        subject: null,
      },
      { first_name: 'Jordan' },
    );
    expect(payload.html).toBe('Hi Jordan');
  });
});

describe('duplicateTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('copies content but resets approval to pending', async () => {
    const source = visualRow();
    (findTemplateById as jest.Mock).mockResolvedValue(source);
    (insertTemplate as jest.Mock).mockImplementation(async (data: Record<string, unknown>) => ({
      ...source,
      id: 't2',
      name: data.name,
      approval_status: 'pending',
      approved_by: null,
      approved_at: null,
    }));
    const dup = await duplicateTemplate('t1', undefined, actor);
    expect(dup.name).toBe('Visual (copy)');
    expect(dup.approval_status).toBe('pending');
    expect(dup.editor_mode).toBe('visual');
    expect(insertTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', editor_mode: 'visual' }),
    );
  });

  it('404s for unknown templates', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(null);
    await expect(duplicateTemplate('missing', undefined, actor)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('setTemplateArchived', () => {
  beforeEach(() => jest.clearAllMocks());

  it('archives and unarchives without touching content', async () => {
    const source = visualRow();
    (findTemplateById as jest.Mock).mockResolvedValue(source);
    (updateRepo as jest.Mock).mockImplementation(
      async (_id: string, fields: Record<string, unknown>) => ({
        ...source,
        ...fields,
      }),
    );
    const archived = await setTemplateArchived('t1', true, actor);
    expect(archived.archived_at).toBeTruthy();
    expect(archived.body).toBe(source.body);
    const restored = await setTemplateArchived('t1', false, actor);
    expect(restored.archived_at).toBeNull();
  });
});

describe('previewTemplate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders sample personalization without side effects', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(visualRow());
    const preview = await previewTemplate('t1', { first_name: 'Sam' });
    expect(preview.html).toContain('Hi Sam');
    expect(preview.text).toContain('Hi Sam');
    expect(preview.notice).toMatch(/sample/i);
  });

  it('flags invalid variables and unsafe links', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({
      ...visualRow(),
      editor_mode: 'simple',
      html_body: null,
      text_body: null,
      body: 'Hi {{bogus_var}}',
      variables: ['bogus_var'],
    });
    const preview = await previewTemplate('t1');
    expect(preview.invalidVariables).toEqual(['bogus_var']);
  });
});

describe('testSendTemplate isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends via the authorized chain without campaign/pipeline side effects', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(visualRow());
    (sendgridSend as jest.Mock).mockResolvedValue({ ok: true, externalId: 'sg-1', latencyMs: 12 });
    const result = await testSendTemplate('t1', 'owner@example.com', undefined, actor);
    expect(result.sent).toBe(true);
    expect(result.to).toBe('owner@example.com');
    expect(sendgridSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com', campaignId: null }),
    );
    // No outreach log, no tracking: subject is prefixed, body has no tracker.
    const sentBody = (sendgridSend as jest.Mock).mock.calls[0][0].htmlBody as string;
    expect(sentBody).not.toContain('/track/');
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it('falls back to SMTP only when SendGrid is unconfigured', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue(visualRow());
    (sendgridSend as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'SendGrid not configured',
      latencyMs: 3,
    });
    (smtpSend as jest.Mock).mockResolvedValue({ ok: true, externalId: 'smtp-1', latencyMs: 9 });
    const result = await testSendTemplate('t1', 'owner@example.com', undefined, actor);
    expect(result.sent).toBe(true);
    expect(result.externalId).toBe('smtp-1');
  });

  it('refuses non-email channels and archived templates', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({
      ...visualRow(),
      channel: 'sms',
      editor_mode: 'simple',
    });
    await expect(
      testSendTemplate('t1', 'owner@example.com', undefined, actor),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
    (findTemplateById as jest.Mock).mockResolvedValue({
      ...visualRow(),
      archived_at: '2026-01-02T00:00:00Z',
    });
    await expect(
      testSendTemplate('t1', 'owner@example.com', undefined, actor),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('blocks unresolved variables before any delivery attempt', async () => {
    (findTemplateById as jest.Mock).mockResolvedValue({
      ...visualRow(),
      html_body: '<p>{{bogus_var}}</p>',
      text_body: '{{bogus_var}}',
    });
    await expect(
      testSendTemplate('t1', 'owner@example.com', undefined, actor),
    ).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(sendgridSend).not.toHaveBeenCalled();
  });
});

describe('template review regressions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('preserves custom HTML when updating only subject and keeping the same channel', async () => {
    const source = {
      ...visualRow(),
      editor_mode: 'html',
      html_body: '<p>Keep <b>my layout</b></p>',
      body: '<p>Keep <b>my layout</b></p>',
      text_body: 'Keep my layout',
      design: null,
    };
    (findTemplateById as jest.Mock).mockResolvedValue(source);
    (updateRepo as jest.Mock).mockImplementation(
      async (_id: string, fields: Record<string, unknown>) => ({ ...source, ...fields }),
    );
    await updateTemplate('t1', { subject: 'New subject', channel: 'email' }, actor);
    expect(updateRepo).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ editor_mode: 'html', html_body: source.html_body }),
    );
  });

  it('keeps approval when JSONB key order changes without a content change', async () => {
    const source = visualRow();
    const prepared = prepareTemplateContent({
      channel: 'email',
      body: source.body,
      design: source.design,
      editor_mode: 'visual',
    });
    const design = JSON.parse(JSON.stringify(prepared.design)) as typeof source.design;
    const reversed = { blocks: design.blocks, global: design.global, version: design.version };
    (findTemplateById as jest.Mock).mockResolvedValue({ ...source, ...prepared, design: reversed });
    (updateRepo as jest.Mock).mockResolvedValue({ ...source, ...prepared });
    await updateTemplate('t1', { name: 'Renamed', design, channel: 'email' }, actor);
    expect(setApprovalStatus).not.toHaveBeenCalled();
  });

  it('duplicates uploaded files with independent paths and identifiers in one insert', async () => {
    const source = {
      ...visualRow(),
      attachments: [
        {
          id: 'a1',
          filename: 'portfolio.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          url: 'https://example.com/a.pdf',
          storagePath: '/old/a.pdf',
        },
      ],
    };
    (findTemplateById as jest.Mock).mockResolvedValue(source);
    (insertTemplate as jest.Mock).mockImplementation(async (data: Record<string, unknown>) => ({
      ...source,
      ...data,
      id: 'copy',
    }));
    await duplicateTemplate('t1', undefined, actor);
    const input = (insertTemplate as jest.Mock).mock.calls[0][0];
    expect(copyFile).toHaveBeenCalledWith(
      '/old/a.pdf',
      expect.stringMatching(/uploads\/templates\/.*\.pdf$/),
    );
    expect(input.attachments[0].storagePath).not.toBe('/old/a.pdf');
    expect(input.attachments[0].id).not.toBe('a1');
    expect(input.attachments[0].url).not.toBe(source.attachments[0].url);
  });

  it('cleans only new copies if the duplicate cannot be inserted', async () => {
    const source = {
      ...visualRow(),
      attachments: [
        {
          id: 'a1',
          filename: 'a.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 12,
          url: 'https://example.com/a.pdf',
          storagePath: '/old/a.pdf',
        },
      ],
    };
    (findTemplateById as jest.Mock).mockResolvedValue(source);
    (insertTemplate as jest.Mock).mockRejectedValue(new Error('insert failed'));
    await expect(duplicateTemplate('t1', undefined, actor)).rejects.toThrow('insert failed');
    expect(unlink).toHaveBeenCalledWith(expect.stringContaining('uploads/templates/'));
    expect(unlink).not.toHaveBeenCalledWith('/old/a.pdf');
  });
});
