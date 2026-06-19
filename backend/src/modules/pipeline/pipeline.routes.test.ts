import request from 'supertest';
import express from 'express';
import { pipelineRoutes } from './pipeline.routes';
import * as pipelineService from './pipeline.service';

jest.mock('./pipeline.service');

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

import { errorHandler } from '../../shared/middleware/errorHandler';

const app = express();
app.use(express.json());
app.use('/pipeline', pipelineRoutes);
app.use(errorHandler);

describe('Pipeline Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /pipeline', () => {
    it('returns 200 and list of pipelines', async () => {
      (pipelineService.getAllPipelines as jest.Mock).mockResolvedValue([{ id: 'pipeline-1' }]);

      const res = await request(app).get('/pipeline');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe('pipeline-1');
    });
  });

  describe('GET /pipeline/:id', () => {
    it('returns 200 and a pipeline', async () => {
      (pipelineService.getPipelineById as jest.Mock).mockResolvedValue({ id: 'pipeline-1' });

      const res = await request(app).get('/pipeline/pipeline-1');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe('pipeline-1');
    });
  });

  describe('POST /pipeline', () => {
    it('returns 201 on create', async () => {
      (pipelineService.createPipeline as jest.Mock).mockResolvedValue({ id: 'pipeline-1' });

      const res = await request(app)
        .post('/pipeline')
        .send({ name: 'Pipeline 1', stages: [{ name: 'Stage 1', position: 1 }] });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('pipeline-1');
    });

    it('returns 422 on validation error', async () => {
      const res = await request(app)
        .post('/pipeline')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('PUT /pipeline/:id', () => {
    it('returns 200 on update', async () => {
      (pipelineService.updatePipelineById as jest.Mock).mockResolvedValue({ id: 'pipeline-1', name: 'Pipeline 2' });

      const res = await request(app)
        .put('/pipeline/pipeline-1')
        .send({ name: 'Pipeline 2' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Pipeline 2');
    });
  });

  describe('DELETE /pipeline/:id', () => {
    it('returns 204 on delete', async () => {
      (pipelineService.deletePipelineById as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/pipeline/pipeline-1');

      expect(res.status).toBe(204);
    });
  });

  describe('GET /pipeline/:pipelineId/stages', () => {
    it('returns 200 and list of stages', async () => {
      (pipelineService.getStages as jest.Mock).mockResolvedValue([{ id: 'stage-1' }]);

      const res = await request(app).get('/pipeline/pipeline-1/stages');

      expect(res.status).toBe(200);
      expect(res.body.data[0].id).toBe('stage-1');
    });
  });

  describe('POST /pipeline/:pipelineId/stages', () => {
    it('returns 201 on create stage', async () => {
      (pipelineService.createStage as jest.Mock).mockResolvedValue({ id: 'stage-1' });

      const res = await request(app)
        .post('/pipeline/pipeline-1/stages')
        .send({ name: 'Stage 1', position: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe('stage-1');
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .post('/pipeline/pipeline-1/stages')
        .send({});

      expect(res.status).toBe(422);
    });
  });

  describe('PUT /pipeline/stages/:id', () => {
    it('returns 200 on update stage', async () => {
      (pipelineService.updateStageById as jest.Mock).mockResolvedValue({ id: 'stage-1', name: 'Stage 2' });

      const res = await request(app)
        .put('/pipeline/stages/stage-1')
        .send({ name: 'Stage 2' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Stage 2');
    });
  });

  describe('DELETE /pipeline/stages/:id', () => {
    it('returns 204 on delete stage', async () => {
      (pipelineService.deleteStageById as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app).delete('/pipeline/stages/stage-1');

      expect(res.status).toBe(204);
    });
  });

  describe('POST /pipeline/move-lead', () => {
    it('returns 200 on move lead', async () => {
      (pipelineService.moveLead as jest.Mock).mockResolvedValue(undefined);

      const res = await request(app)
        .post('/pipeline/move-lead')
        .send({ lead_id: '550e8400-e29b-41d4-a716-446655440000', stage_id: '550e8400-e29b-41d4-a716-446655440001' });

      expect(res.status).toBe(200);
    });

    it('returns 422 if validation fails', async () => {
      const res = await request(app)
        .post('/pipeline/move-lead')
        .send({});

      expect(res.status).toBe(422);
    });
  });
});
