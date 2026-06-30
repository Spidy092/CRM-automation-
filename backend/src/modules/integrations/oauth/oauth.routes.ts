/**
 * OAuth routes for Google Ads and Facebook integrations.
 *
 * GET  /oauth/:provider/authorize  — Generate authorization URL
 * GET  /oauth/:provider/callback   — Handle authorization code callback
 * POST /oauth/:provider/refresh    — Manually refresh access token
 */

import { Router, type Request, type Response } from 'express';
import { wrap as asyncHandler } from '../../../shared/utils/asyncHandler';
import { authenticate } from '../../../shared/middleware/auth';
import { authorize } from '../../../shared/middleware/rbac';
import { sendSuccess } from '../../../shared/utils/response';
import { AppError } from '../../../shared/middleware/errorHandler';
import {
  generateAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
} from './oauth.service';

const router = Router();

// All OAuth routes require authentication + admin role
router.use(authenticate);
router.use(authorize('admin'));

/**
 * GET /oauth/:provider/authorize
 *
 * Generates an authorization URL for the given provider.
 * The frontend should redirect the user to this URL.
 */
router.get(
  '/:provider/authorize',
  asyncHandler((req: Request, res: Response) => {
    const { provider } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError('User ID not found in request', 401);
    }

    if (provider !== 'google_ads' && provider !== 'facebook') {
      throw new AppError(`Unsupported OAuth provider: ${provider}`, 400);
    }

    const { url, state } = generateAuthorizationUrl(provider, userId);

    sendSuccess(res, { url, state });
  }),
);

/**
 * GET /oauth/:provider/callback
 *
 * Handles the OAuth callback from the provider.
 * Exchanges the authorization code for tokens and stores them.
 */
router.get(
  '/:provider/callback',
  asyncHandler(async (req: Request, res: Response) => {
    const { provider } = req.params;
    const { code, state } = req.query as { code?: string; state?: string };

    if (provider !== 'google_ads' && provider !== 'facebook') {
      throw new AppError(`Unsupported OAuth provider: ${provider}`, 400);
    }

    if (!code || !state) {
      throw new AppError('Missing authorization code or state parameter', 400);
    }

    try {
      const result = await exchangeCodeForTokens(provider, code ?? '', state ?? '');

      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      res.redirect(`${frontendUrl}/settings/integrations?oauth=success&id=${result.integrationId}`);
    } catch (err) {
      // Redirect to frontend error page
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      res.redirect(
        `${frontendUrl}/settings/integrations?oauth=error&message=${encodeURIComponent(errorMessage)}`,
      );
    }
  }),
);

/**
 * POST /oauth/:provider/refresh
 *
 * Manually refresh the access token for the given provider.
 */
router.post(
  '/:provider/refresh',
  asyncHandler(async (req: Request, res: Response) => {
    const { provider } = req.params;
    const { integrationId } = req.body as { integrationId?: string };

    if (provider !== 'google_ads' && provider !== 'facebook') {
      throw new AppError(`Unsupported OAuth provider: ${provider}`, 400);
    }

    if (!integrationId) {
      throw new AppError('integrationId is required', 400);
    }

    await refreshAccessToken(provider, integrationId);

    sendSuccess(res, {
      success: true,
      accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
  }),
);

export { router as oauthRoutes };
