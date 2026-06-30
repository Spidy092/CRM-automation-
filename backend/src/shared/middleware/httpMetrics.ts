import { Counter, Histogram } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { register } from '../utils/metrics';

/**
 * HTTP request metrics middleware.
 *
 * Exports:
 *   - http_requests_total         Counter  — per (method, route, status_code)
 *   - http_request_duration_seconds  Histogram — per (method, route)
 *
 * Route label is normalized to the Express matched path pattern (e.g.
 * `/api/v1/leads/:id`) so cardinality stays bounded.
 */

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests received',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    // Use the matched Express route pattern, or fall back to the raw path
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const matchedRoute = (req as Request & { route?: { path: string } }).route;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const route = matchedRoute?.path ? `${req.baseUrl ?? ''}${matchedRoute.path}` : req.path;

    const method = req.method;
    const statusCode = String(res.statusCode);
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route }, durationSec);
  });

  next();
}
