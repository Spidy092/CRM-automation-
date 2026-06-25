import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../shared/utils/response';
import { updateAiSettingsSchema } from './ai-settings.schema';
import { getAiSettingsPublic, updateAiSettings } from './ai-settings.service';

export async function getAiSettingsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const settings = await getAiSettingsPublic();
    sendSuccess(res, settings);
  } catch (err) {
    next(err);
  }
}

export async function updateAiSettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = updateAiSettingsSchema.parse(req.body);
    const updated = await updateAiSettings(parsed, req.user!.id);
    sendSuccess(res, updated);
  } catch (err) {
    next(err);
  }
}
