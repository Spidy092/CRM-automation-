import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { decodeCursor } from '../../shared/utils/pagination';
import {
  templateIdParamSchema,
  createTemplateSchema,
  updateTemplateSchema,
  listTemplatesQuerySchema,
  approveTemplateSchema,
  attachFromLibrarySchema,
  attachmentIdParamSchema,
  duplicateTemplateSchema,
  previewTemplateSchema,
  testSendTemplateSchema,
} from './templates.schema';
import * as templatesService from './templates.service';
import { TemplateActor } from './templates.types';

function actorFromReq(req: Request): TemplateActor {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listTemplatesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = listTemplatesQuerySchema.parse(req.query);
    let cursorTs: string | undefined;
    let cursorId: string | undefined;
    if (parsed.cursor) {
      const decoded = decodeCursor(parsed.cursor);
      if (!decoded) throw new AppError('Invalid cursor', 400);
      cursorTs = decoded.ts;
      cursorId = decoded.id;
    }

    const result = await templatesService.listTemplates({
      limit: parsed.limit ?? 20,
      cursorTs,
      cursorId,
      channel: parsed.channel,
      approval_status: parsed.approval_status,
      search: parsed.search,
      includeArchived: parsed.include_archived,
      archivedOnly: parsed.archived_only,
      createdBy: parsed.mine ? actorFromReq(req).id : undefined,
    });
    sendSuccess(res, result.items, 200, result.meta);
  } catch (err) {
    next(err);
  }
}

export async function getTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const item = await templatesService.getTemplate(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function createTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createTemplateSchema.parse(req.body);
    const created = await templatesService.createTemplate(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const input = updateTemplateSchema.parse(req.body);
    const updated = await templatesService.updateTemplate(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function approveTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const input = approveTemplateSchema.parse(req.body);
    const updated = await templatesService.approveTemplate(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    await templatesService.removeTemplate(id, actorFromReq(req));
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

export async function duplicateTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const { name } = duplicateTemplateSchema.parse(req.body ?? {});
    const created = await templatesService.duplicateTemplate(id, name, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function archiveTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const updated = await templatesService.setTemplateArchived(id, true, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function unarchiveTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const updated = await templatesService.setTemplateArchived(id, false, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function renameTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const parsed = updateTemplateSchema.parse(req.body);
    if (parsed.name === undefined) throw new AppError('name is required', 400);
    const updated = await templatesService.updateTemplate(
      id,
      { name: parsed.name },
      actorFromReq(req),
    );
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function previewTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const { sample_values } = previewTemplateSchema.parse(req.body ?? {});
    const preview = await templatesService.previewTemplate(id, sample_values);
    sendSuccess(res, preview);
  } catch (err) {
    next(err);
  }
}

export async function testSendTemplateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const { to, sample_values } = testSendTemplateSchema.parse(req.body);
    const result = await templatesService.testSendTemplate(
      id,
      to,
      sample_values,
      actorFromReq(req),
    );
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function addTemplateAttachmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    if (!req.file) throw new AppError('No file uploaded', 400);
    const updated = await templatesService.addTemplateAttachment(id, req.file, actorFromReq(req));
    sendSuccess(res, updated, 201);
  } catch (err) {
    next(err);
  }
}

export async function addTemplateAttachmentFromLibraryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = templateIdParamSchema.parse(req.params);
    const { file_id } = attachFromLibrarySchema.parse(req.body);
    const updated = await templatesService.addTemplateAttachmentFromLibrary(
      id,
      file_id,
      actorFromReq(req),
    );
    sendSuccess(res, updated, 201);
  } catch (err) {
    next(err);
  }
}

export async function removeTemplateAttachmentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id, attachmentId } = attachmentIdParamSchema.parse(req.params);
    const updated = await templatesService.removeTemplateAttachment(
      id,
      attachmentId,
      actorFromReq(req),
    );
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
