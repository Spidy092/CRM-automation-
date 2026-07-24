import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { AppError } from '../../shared/middleware/errorHandler';
import { fileIdParamSchema, updateFileSchema, listFilesQuerySchema } from './files.schema';
import * as filesService from './files.service';
import { FileActor } from './files.types';

function actorFromReq(req: Request): FileActor {
  const user = req.user;
  if (!user) throw new AppError('Unauthorized', 401);
  return { id: user.id, role: user.role, ipAddress: req.ip ?? null };
}

export async function listFilesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listFilesQuerySchema.parse(req.query);
    const items = await filesService.listFiles(parsed);
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = fileIdParamSchema.parse(req.params);
    const item = await filesService.getFile(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function uploadFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);
    const created = await filesService.uploadFile(req.file, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = fileIdParamSchema.parse(req.params);
    const input = updateFileSchema.parse(req.body);
    const updated = await filesService.updateFile(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function deleteFileHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = fileIdParamSchema.parse(req.params);
    await filesService.removeFile(id, actorFromReq(req));
    sendSuccess(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}
