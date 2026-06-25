import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  createScraperConfigSchema,
  updateScraperConfigSchema,
  listLogsQuerySchema,
} from './scraper.schema';
import * as scraperService from './scraper.service';

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
    const result = await scraperService.runScrape(req.params.configId, actorFromReq(req));
    sendSuccess(res, result);
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
