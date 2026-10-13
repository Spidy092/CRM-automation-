import request from 'supertest';
import express from 'express';
import { leadsRoutes } from './leads.routes';
import * as leadsService from './leads.service';
import * as leadsImport from './leads.import';

jest.mock('./leads.service');
jest.mock('./leads.import');
jest.mock('../../shared/middleware/rateLimiter', () => ({
  authenticatedLimiter: (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
}));
jest.mock('../../shared/middleware/rbac', () => ({
  authorize: (...roles: string[]) => (req: any, res: any, next: any) => next(),
}));
jest.mock('../../shared/middleware/upload', () => ({
  leadImportUpload: {
    single: () => (req: any, res: any, next: any) => {
      req.file = { buffer: Buffer.from('test'), originalname: 'test.csv', mimetype: 'text/csv' };
      next();
    },
  },
}));

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/leads', leadsRoutes);
app.use(errorHandler);

describe('Leads Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /leads', () => {
    it('returns 200 and list of leads', async () => {
      (leadsService.listLeads as jest.Mock).mockResolvedValue({
        items: [{ id: 'lead-1' }],
        meta: { total: 1, hasMore: false },
      });

      const res = await request(app).get('/leads');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data[0].id).toBe('lead-1');
    });
  });

  describe('GET /leads/:id', () => {
    it('returns 200 and the lead', async () => {
      (leadsService.getLeadById as jest.Mock).mockResolvedValue({ id: 'lead-1' });

      const res = await request(app).get('/leads/lead-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe('lead-1');
    });
  });

  describe('GET /leads/:id/timeline', () => {
    it('returns 200 with unified history and cursor meta', async () => {
      (leadsService.getLeadTimeline as jest.Mock).mockResolvedValue({
        items: [{ id: 'act-1', source: 'activity' }],
        meta: { limit: 25, hasMore: false },
      });

      const res = await request(app).get('/leads/lead-1/timeline?kind=all&limit=25');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(leadsService.getLeadTimeline).toHaveBeenCalledWith(
        'lead-1',
        expect.objectContaining({ id: 'admin-1' }),
        expect.objectContaining({ limit: 25, kind: 'all' }),
      );
    });

    it('forwards kind, search, channel, and cursor filters', async () => {
      (leadsService.getLeadTimeline as jest.Mock).mockResolvedValue({
        items: [],
        meta: { limit: 25, hasMore: false },
      });
      const cursor = Buffer.from(
        JSON.stringify({ ts: '2026-06-20T00:00:00.000Z', id: 'act-9' }),
      ).toString('base64url');

      await request(app).get(
        `/leads/lead-1/timeline?kind=messages&search=pricing&channel=email&cursor=${cursor}`,
      );

      expect(leadsService.getLeadTimeline).toHaveBeenCalledWith(
        'lead-1',
        expect.anything(),
        expect.objectContaining({
          kind: 'messages',
          search: 'pricing',
          channel: 'email',
          cursorTs: '2026-06-20T00:00:00.000Z',
          cursorId: 'act-9',
        }),
      );
    });

    it('rejects invalid cursors with 400', async () => {
      const res = await request(app).get('/leads/lead-1/timeline?cursor=bogus');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /leads', () => {
    it('returns 201 on successful lead creation', async () => {
      (leadsService.createLead as jest.Mock).mockResolvedValue({ id: 'lead-1' });

      const res = await request(app)
        .post('/leads')
        .send({
          business_name: 'Acme Corp',
          contact_name: 'John Doe',
          phone: '+12345678901',
          email: 'john@acme.com',
          industry: 'Tech',
          location: 'NY',
          source_platform: 'manual_upload',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('lead-1');
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .post('/leads')
        .send({ email: 'invalid-email' });

      expect(res.status).toBe(422);
    });
  });

  describe('PUT /leads/:id', () => {
    it('returns 200 on successful update', async () => {
      (leadsService.updateLeadFields as jest.Mock).mockResolvedValue({ id: 'lead-1', notes: 'hi' });

      const res = await request(app)
        .put('/leads/lead-1')
        .send({ notes: 'hi' });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('hi');
    });
  });

  describe('DELETE /leads/:id', () => {
    it('returns 200 on successful deletion', async () => {
      (leadsService.softDeleteLeadById as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/leads/lead-1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /leads/:id/pause', () => {
    it('returns 200 on successful pause', async () => {
      (leadsService.setLeadPaused as jest.Mock).mockResolvedValue({ id: 'lead-1', status: 'paused' });

      const res = await request(app)
        .post('/leads/lead-1/pause')
        .send({ paused: true });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paused');
    });
  });

  describe('POST /leads/import', () => {
    it('returns 201 on successful import start', async () => {
      (leadsImport.isSupportedFile as jest.Mock).mockReturnValue(true);
      (leadsImport.importLeads as jest.Mock).mockResolvedValue({ total: 10, imported: 10, errors: [] });

      const res = await request(app)
        .post('/leads/import')
        .attach('file', Buffer.from('test'), 'test.csv');

      expect(res.status).toBe(201);
      expect(res.body.data.total).toBe(10);
    });
  });
});
