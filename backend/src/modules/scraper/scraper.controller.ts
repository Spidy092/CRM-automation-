import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  createScraperConfigSchema,
  updateScraperConfigSchema,
  listLogsQuerySchema,
  detectSelectorsSchema,
  discoverPagesSchema,
  statsSummaryQuerySchema,
} from './scraper.schema';
import * as scraperService from './scraper.service';
import { findScraperLogById } from './scraper.repository';

function actorFromReq(req: Request): {
  id: string;
  role: string;
  ipAddress?: string | null;
} {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listConfigsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const configs = await scraperService.listConfigs();
    sendSuccess(res, configs);
  } catch (err) {
    next(err);
  }
}

export async function getConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = await scraperService.getConfigById(req.params.id);
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function createConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createScraperConfigSchema.parse(req.body);
    const config = await scraperService.createConfig(input, actorFromReq(req));
    sendSuccess(res, config, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = updateScraperConfigSchema.parse(req.body);
    const config = await scraperService.updateConfig(req.params.id, input, actorFromReq(req));
    sendSuccess(res, config);
  } catch (err) {
    next(err);
  }
}

export async function deleteConfigHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await scraperService.removeConfig(req.params.id, actorFromReq(req));
    sendSuccess(res, { message: 'Scraper config deleted' });
  } catch (err) {
    next(err);
  }
}

export async function triggerScrapeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await scraperService.queueScrapeRun(req.params.configId, actorFromReq(req));
    sendSuccess(res, result, 202);
  } catch (err) {
    next(err);
  }
}

export async function detectSelectorsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { url } = detectSelectorsSchema.parse(req.body);
    const result = await scraperService.detectSelectors(url);
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function discoverPagesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { url } = discoverPagesSchema.parse(req.body);
    const pages = await scraperService.discoverPages(url);
    sendSuccess(res, pages);
  } catch (err) {
    next(err);
  }
}

export async function listLogsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { limit, offset } = listLogsQuerySchema.parse(req.query);
    const result = await scraperService.getLogsByConfig(
      req.params.configId,
      limit ?? 25,
      offset ?? 0,
    );
    sendSuccess(res, result.items, 200, {
      total: result.total,
      page: Math.floor((offset ?? 0) / (limit ?? 25)) + 1,
      limit: limit ?? 25,
    });
  } catch (err) {
    next(err);
  }
}

export async function getRunLeadsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const leads = await scraperService.getLeadsForRun(req.params.logId);
    sendSuccess(res, leads);
  } catch (err) {
    next(err);
  }
}

export async function retryFailedHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await scraperService.retryFailedItems(req.params.logId, actorFromReq(req));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getStatsSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { hours } = statsSummaryQuerySchema.parse(req.query);
    const summary = await scraperService.getStatsSummary(hours);
    sendSuccess(res, summary);
  } catch (err) {
    next(err);
  }
}

export async function exportRunLeadsCsvHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const logId = req.params.logId;
    const log = await findScraperLogById(logId);
    if (!log) {
      res.status(404).json({ success: false, error: 'Scraper log not found' });
      return;
    }
    const csv = await scraperService.exportRunLeadsCsv(logId);
    const config = await scraperService.getConfigById(log.config_id);
    const filename = `${config.name.replace(/[^a-zA-Z0-9]/g, '_')}_${logId.slice(0, 8)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function getGroupsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const groups = await scraperService.getDistinctGroups();
    sendSuccess(res, groups);
  } catch (err) {
    next(err);
  }
}

export async function getTrendsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 14, 1), 90);
    const trends = await scraperService.getScraperTrendsData(days);
    sendSuccess(res, trends);
  } catch (err) {
    next(err);
  }
}
