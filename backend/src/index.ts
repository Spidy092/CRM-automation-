import 'dotenv/config';
import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { logger } from './shared/utils/logger';
import { checkDbConnection } from './shared/utils/db';
import { checkRedisConnection } from './shared/utils/redis';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler';
import { authenticatedLimiter } from './shared/middleware/rateLimiter';
import { authRoutes } from './modules/auth/auth.routes';
import { customFieldsRoutes } from './modules/custom-fields/customFields.routes';
import { leadsRoutes } from './modules/leads/leads.routes';
import { usersRoutes } from './modules/users';
import { pipelineRoutes } from './modules/pipeline/pipeline.routes';
import { campaignsRoutes } from './modules/campaigns/campaigns.routes';
import { assignmentsRoutes } from './modules/assignments/assignments.routes';
import { scoringRoutes } from './modules/scoring/scoring.routes';
import { integrationsRoutes } from './modules/integrations/integrations.routes';

const app: Application = express();
const PORT = process.env.PORT ?? 3000;

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  morgan('combined', {
    stream: { write: (message: string) => logger.info(message.trim()) },
  }),
);

// ── Health Check (no auth, no rate limit) ─────────────────────────────────────
app.get('/health', (_req, res) => {
  void (async (): Promise<void> => {
    const [dbOk, redisOk] = await Promise.all([checkDbConnection(), checkRedisConnection()]);
    const status = dbOk && redisOk ? 'ok' : 'degraded';
    res.status(dbOk && redisOk ? 200 : 503).json({
      status,
      db: dbOk ? 'connected' : 'disconnected',
      redis: redisOk ? 'connected' : 'disconnected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  })();
});

// ── API Routes (v1) ───────────────────────────────────────────────────────────
app.use('/api/v1/auth', authenticatedLimiter, authRoutes);
app.use('/api/v1/custom-fields', authenticatedLimiter, customFieldsRoutes);
app.use('/api/v1/leads', leadsRoutes);
app.use('/api/v1/users', authenticatedLimiter, usersRoutes);
app.use('/api/v1/pipelines', pipelineRoutes);
app.use('/api/v1/campaigns', campaignsRoutes);
app.use('/api/v1/assignments', assignmentsRoutes);
app.use('/api/v1/scoring', scoringRoutes);
app.use('/api/v1/integrations', authenticatedLimiter, integrationsRoutes);

// ── 404 + Error Handling ──────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info(`CRM API server listening on port ${PORT}`, { env: process.env.NODE_ENV });
});

export default app;
