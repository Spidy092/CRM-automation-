import type { NextFunction, Request, Response } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { updateIntegrationSchema, integrationIdParamSchema } from './integrations.schema';
import * as integrationsService from './integrations.service';
import { IntegrationActor } from './integrations.types';

function actorFromReq(req: Request): IntegrationActor {
  return {
    id: req.user?.id ?? '00000000-0000-0000-0000-000000000001',
    ipAddress: req.ip ?? null,
  };
}

export async function listIntegrationsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const items = await integrationsService.listIntegrations();
    sendSuccess(res, items);
  } catch (err) {
    next(err);
  }
}

export async function getIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = integrationIdParamSchema.parse(req.params);
    const item = await integrationsService.getIntegration(id);
    sendSuccess(res, item);
  } catch (err) {
    next(err);
  }
}

export async function updateIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = integrationIdParamSchema.parse(req.params);
    const input = updateIntegrationSchema.parse(req.body);
    const updated = await integrationsService.updateIntegration(id, input, actorFromReq(req));
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}

export async function testIntegrationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { id } = integrationIdParamSchema.parse(req.params);
    const result = await integrationsService.testIntegration(id, actorFromReq(req));
    // 200 even on logical failures (the body carries `ok:false` and a reason) so
    // admins can surface a meaningful message without parsing 4xx semantics.
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}

export async function testAllIntegrationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await integrationsService.testAllIntegrations(actorFromReq(req));
    sendSuccess(res, result);
  } catch (err) {
    next(err);
  }
}
