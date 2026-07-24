import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import {
  pageIdParamSchema,
  pageSlugParamSchema,
  publicPageQuerySchema,
  createPageSchema,
  updatePageSchema,
} from './pages.schema';
import * as pagesService from './pages.service';
import { LandingPageActor } from './pages.types';

function actorFromReq(req: Request): LandingPageActor {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listPagesHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await pagesService.listPages();
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getPageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    const item = await pagesService.getPage(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function getPageViewsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    const item = await pagesService.getPageViews(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function createPageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = createPageSchema.parse(req.body);
    const created = await pagesService.createPage(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updatePageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    const input = updatePageSchema.parse(req.body);
    const updated = await pagesService.updatePage(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function publishPageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    const updated = await pagesService.publishPage(id, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function unpublishPageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    const updated = await pagesService.unpublishPage(id, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deletePageHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = pageIdParamSchema.parse(req.params);
    await pagesService.removePage(id, actorFromReq(req));
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function getPublicPageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { slug } = pageSlugParamSchema.parse(req.params);
    const { lead } = publicPageQuerySchema.parse(req.query);
    const item = await pagesService.getPublicPage(slug);

    // Best-effort view log — never blocks or fails the page render.
    void pagesService.recordPageView(slug, {
      leadId: lead ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}
