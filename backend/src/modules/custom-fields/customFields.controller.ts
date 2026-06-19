import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { createDefinitionSchema, updateDefinitionSchema } from './customFields.schema';
import * as customFieldsService from './customFields.service';

function actorFromReq(req: Request): { id: string; ipAddress?: string | null } {
  const user = req.user ?? null;
  return {
    id: user?.id ?? '00000000-0000-0000-0000-000000000001',
    ipAddress: req.ip ?? null,
  };
}

export async function listDefinitionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const items = await customFieldsService.listDefinitions(includeInactive);
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function createDefinitionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = createDefinitionSchema.parse(req.body);
    const created = await customFieldsService.createDefinition(input, actorFromReq(req));
    sendSuccess(res, created, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateDefinitionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = req.params;
    const input = updateDefinitionSchema.parse(req.body);
    const updated = await customFieldsService.updateDefinition(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
