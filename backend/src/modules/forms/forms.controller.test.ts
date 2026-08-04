import type { Request, Response, NextFunction } from 'express';
import * as formsService from './forms.service';
import {
  listFormsHandler,
  getFormHandler,
  createFormHandler,
  updateFormHandler,
  deleteFormHandler,
  getFormAnalyticsHandler,
  getEmbedSnippetHandler,
  getPublicFormHandler,
  submitFormHandler,
} from './forms.controller';

jest.mock('./forms.service');

const svc = formsService as jest.Mocked<typeof formsService>;
const FORM_ID = '11111111-1111-1111-1111-111111111111';

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: 'u1', role: 'admin', email: 'a@b.com', name: 'Admin' },
    params: {},
    query: {},
    body: {},
    headers: {},
    ip: '1.2.3.4',
    protocol: 'https',
    get: jest.fn().mockReturnValue('crm.example.com'),
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  res.send = jest.fn().mockReturnThis();
  return res as Response;
}

const next = jest.fn() as NextFunction;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.APP_BASE_URL;
  delete process.env.BASE_URL;
});

describe('listFormsHandler', () => {
  it('lists forms with parsed query pagination', async () => {
    svc.listForms.mockResolvedValue({ items: [], meta: { limit: 20, offset: 0, total: 0 } });
    const req = buildReq({ query: { limit: '20', offset: '0' } });
    await listFormsHandler(req, buildRes(), next);
    expect(svc.listForms).toHaveBeenCalledWith(20, 0);
  });

  it('forwards zod validation errors to next', async () => {
    const req = buildReq({ query: { limit: '-1' } });
    await listFormsHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.listForms).not.toHaveBeenCalled();
  });
});

describe('getFormHandler', () => {
  it('returns 404-shaped error via next for an invalid formId', async () => {
    const req = buildReq({ params: { formId: 'not-a-uuid' } });
    await getFormHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.getForm).not.toHaveBeenCalled();
  });

  it('returns the form for a valid formId', async () => {
    svc.getForm.mockResolvedValue({ id: FORM_ID } as any);
    const req = buildReq({ params: { formId: FORM_ID } });
    const res = buildRes();
    await getFormHandler(req, res, next);
    expect(svc.getForm).toHaveBeenCalledWith(FORM_ID);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('createFormHandler', () => {
  it('validates the body and forwards the actor', async () => {
    svc.createForm.mockResolvedValue({ id: FORM_ID } as any);
    const res = buildRes();
    const req = buildReq({
      body: { name: 'Contact Us', fields: [{ name: 'email', label: 'Email', type: 'email', required: true }] },
    });
    await createFormHandler(req, res, next);
    expect(svc.createForm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Contact Us' }),
      expect.objectContaining({ id: 'u1', role: 'admin' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('forwards a validation error when fields is empty', async () => {
    const req = buildReq({ body: { name: 'Contact Us', fields: [] } });
    await createFormHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.createForm).not.toHaveBeenCalled();
  });
});

describe('updateFormHandler', () => {
  it('validates params and body then updates', async () => {
    svc.updateFormById.mockResolvedValue({ id: FORM_ID, name: 'New' } as any);
    const req = buildReq({ params: { formId: FORM_ID }, body: { name: 'New' } });
    await updateFormHandler(req, buildRes(), next);
    expect(svc.updateFormById).toHaveBeenCalledWith(
      FORM_ID,
      expect.objectContaining({ name: 'New' }),
      expect.objectContaining({ id: 'u1' }),
    );
  });
});

describe('deleteFormHandler', () => {
  it('deletes and responds 204', async () => {
    svc.deleteFormById.mockResolvedValue(undefined);
    const res = buildRes();
    const req = buildReq({ params: { formId: FORM_ID } });
    await deleteFormHandler(req, res, next);
    expect(svc.deleteFormById).toHaveBeenCalledWith(FORM_ID, expect.objectContaining({ id: 'u1' }));
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
  });
});

describe('getFormAnalyticsHandler', () => {
  it('returns analytics for the form', async () => {
    svc.getFormAnalyticsById.mockResolvedValue({ formId: FORM_ID } as any);
    const req = buildReq({ params: { formId: FORM_ID } });
    await getFormAnalyticsHandler(req, buildRes(), next);
    expect(svc.getFormAnalyticsById).toHaveBeenCalledWith(FORM_ID, expect.objectContaining({ id: 'u1' }));
  });
});

describe('getEmbedSnippetHandler', () => {
  it('uses APP_BASE_URL when set', async () => {
    process.env.APP_BASE_URL = 'https://configured.example.com';
    svc.getForm.mockResolvedValue({ id: FORM_ID, slug: 'contact-us' } as any);
    svc.generateEmbedSnippet.mockReturnValue('<iframe></iframe>');
    const req = buildReq({ params: { formId: FORM_ID } });
    await getEmbedSnippetHandler(req, buildRes(), next);
    expect(svc.generateEmbedSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ id: FORM_ID }),
      'https://configured.example.com',
    );
  });

  it('falls back to the request protocol/host when no base URL env is set', async () => {
    svc.getForm.mockResolvedValue({ id: FORM_ID, slug: 'contact-us' } as any);
    svc.generateEmbedSnippet.mockReturnValue('<iframe></iframe>');
    const req = buildReq({ params: { formId: FORM_ID } });
    await getEmbedSnippetHandler(req, buildRes(), next);
    expect(svc.generateEmbedSnippet).toHaveBeenCalledWith(
      expect.objectContaining({ id: FORM_ID }),
      'https://crm.example.com',
    );
  });
});

describe('getPublicFormHandler', () => {
  it('returns a minimal public shape without internal fields', async () => {
    svc.getFormBySlug.mockResolvedValue({
      id: FORM_ID,
      name: 'Contact Us',
      description: 'desc',
      fields: [],
      submit_message: 'Thanks!',
      theme: {},
      slug: 'contact-us',
      is_active: true,
      email_settings: {},
      created_by: 'u1',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      submit_action: 'create_lead',
      redirect_url: null,
    } as any);
    const res = buildRes();
    const req = buildReq({ params: { slug: 'contact-us' } });
    await getPublicFormHandler(req, res, next);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data).toEqual({
      id: FORM_ID,
      name: 'Contact Us',
      description: 'desc',
      fields: [],
      submitMessage: 'Thanks!',
      theme: {},
    });
  });
});

describe('submitFormHandler', () => {
  it('validates the formId and body, forwards request metadata, and returns 201', async () => {
    svc.submitForm.mockResolvedValue({
      submission: { id: 's1' } as any,
      leadId: 'lead-1',
      message: 'Thanks!',
      redirectUrl: undefined,
    });
    const res = buildRes();
    const req = buildReq({
      params: { formId: FORM_ID },
      body: { email: 'a@b.com' },
      headers: { 'user-agent': 'jest', referer: 'https://google.com' },
    });
    await submitFormHandler(req, res, next);
    expect(svc.submitForm).toHaveBeenCalledWith(
      FORM_ID,
      { email: 'a@b.com' },
      { ipAddress: '1.2.3.4', userAgent: 'jest', referrer: 'https://google.com' },
    );
    expect(res.status).toHaveBeenCalledWith(201);
    const payload = (res.json as jest.Mock).mock.calls[0][0];
    expect(payload.data).toEqual({ message: 'Thanks!', leadId: 'lead-1', redirectUrl: undefined });
  });

  it('forwards a validation error for an invalid formId', async () => {
    const req = buildReq({ params: { formId: 'not-a-uuid' }, body: {} });
    await submitFormHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.submitForm).not.toHaveBeenCalled();
  });

  it('forwards a validation error when submit body contains nested objects', async () => {
    const req = buildReq({ params: { formId: FORM_ID }, body: { malicious: { nested: 'obj' } } });
    await submitFormHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalled();
    expect(svc.submitForm).not.toHaveBeenCalled();
  });

  it('forwards an AppError 401 when req.user is missing for authenticated action', async () => {
    const req = buildReq({ params: { formId: FORM_ID } });
    delete (req as any).user;
    await deleteFormHandler(req, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });
});
