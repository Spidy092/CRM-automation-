import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import express, { Application } from 'express';
import { initSentry } from './shared/utils/sentry';
initSentry();
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { logger } from './shared/utils/logger';
import { register } from './shared/utils/metrics';
import { checkDbConnection } from './shared/utils/db';
import { checkRedisConnection } from './shared/utils/redis';
import { errorHandler, notFoundHandler } from './shared/middleware/errorHandler';
import { httpMetricsMiddleware } from './shared/middleware/httpMetrics';
import { Sentry } from './shared/utils/sentry';
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
import { templatesRoutes } from './modules/templates/templates.routes';
import { outreachRoutes } from './modules/outreach/outreach.routes';
import { reportsRoutes } from './modules/reports/reports.routes';
import { scraperRoutes } from './modules/scraper';
import { webhooksRoutes } from './webhooks/webhooks.routes';
import { aiSettingsRoutes } from './modules/ai-settings/ai-settings.routes';
import { notificationsRoutes } from './modules/notifications/notifications.routes';
import aiInboxRoutes from './modules/ai-inbox/ai-inbox.routes';
import { initNotificationSubscriber } from './modules/notifications/notifications.emitter';

const app: Application = express();
const PORT = process.env.PORT ?? 3000;

// ── Global Process Error Listeners (Sentry) ─────────────────────────────────
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  Sentry.captureException(reason);
});

process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — process will exit', { error: err.message, stack: err.stack });
  Sentry.captureException(err);
  // Allow Sentry to flush before exiting
  setTimeout(() => process.exit(1), 2000);
});

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

// ── HTTP Request Metrics ──────────────────────────────────────────────────────
app.use(httpMetricsMiddleware);

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

// ── Prometheus Metrics (no auth — scraped by Prometheus server) ──────────────
app.get('/metrics', (_req, res) => {
  void register.metrics().then((metrics) => {
    res.set('Content-Type', register.contentType);
    res.end(metrics);
  }).catch(() => {
    res.status(500).json({ error: 'Failed to collect metrics' });
  });
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
app.use('/api/v1/templates', authenticatedLimiter, templatesRoutes);
app.use('/api/v1/outreach', authenticatedLimiter, outreachRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/ai-settings', aiSettingsRoutes);
app.use('/api/v1/scraper', scraperRoutes);
app.use('/api/v1/events', notificationsRoutes);
app.use('/api/v1/ai-inbox', authenticatedLimiter, aiInboxRoutes);

// ── Public Webhooks (no auth, signature verification in handlers) ───────────
app.use('/webhooks', webhooksRoutes);

// ── 404 + Error Handling ──────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

initNotificationSubscriber();

app.listen(PORT, () => {
  logger.info(`CRM API server listening on port ${PORT}`, { env: process.env.NODE_ENV });
});

export default app;
