/**
 * OAuth 2.0 service for Google Ads and Facebook integrations.
 *
 * Handles:
 *   - Authorization URL generation
 *   - Authorization code exchange for tokens
 *   - Token refresh
 *   - State parameter validation (CSRF protection)
 */

import { randomBytes } from 'crypto';
import { AppError } from '../../../shared/middleware/errorHandler';
import { logger } from '../../../shared/utils/logger';
import { encryptJson, decryptJson } from '../../../shared/utils/encryption';
import { findByName, updateIntegration } from '../integrations.repository';
import type {
  OAuthTokenResponse,
  OAuthState,
  GoogleAdsOAuthConfig,
  FacebookOAuthConfig,
} from './oauth.types';

// ── State store (in-memory for simplicity; use Redis in production) ────────

const stateStore = new Map<string, OAuthState>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Provider Configs ──────────────────────────────────────────────────────

const GOOGLE_ADS_CONFIG: GoogleAdsOAuthConfig = {
  clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? '',
  redirectUri:
    process.env.GOOGLE_ADS_REDIRECT_URI ??
    'http://localhost:3000/api/v1/integrations/oauth/google-ads/callback',
  scopes: [
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  accessType: 'offline',
  prompt: 'consent',
};

const FACEBOOK_CONFIG: FacebookOAuthConfig = {
  clientId: process.env.FACEBOOK_APP_ID ?? '',
  clientSecret: process.env.FACEBOOK_APP_SECRET ?? '',
  redirectUri:
    process.env.FACEBOOK_REDIRECT_URI ??
    'http://localhost:3000/api/v1/integrations/oauth/facebook/callback',
  scopes: ['pages_manage_ads', 'leads_retrieval', 'pages_show_list'],
  display: 'popup',
};

// ── Authorization URL Generation ──────────────────────────────────────────

export function generateAuthorizationUrl(
  provider: 'google_ads' | 'facebook',
  userId: string,
): { url: string; state: string } {
  const state = randomBytes(32).toString('hex');
  const baseConfig = provider === 'google_ads' ? GOOGLE_ADS_CONFIG : FACEBOOK_CONFIG;

  if (!baseConfig.clientId) {
    throw new AppError(`${provider} OAuth not configured — missing client ID`, 500);
  }

  // Store state for CSRF validation
  stateStore.set(state, {
    provider,
    userId,
    redirectUri: baseConfig.redirectUri,
    createdAt: new Date().toISOString(),
  });

  // Clean up expired states
  cleanupExpiredStates();

  let authUrl: string;

  if (provider === 'google_ads') {
    const params = new URLSearchParams({
      client_id: GOOGLE_ADS_CONFIG.clientId,
      redirect_uri: GOOGLE_ADS_CONFIG.redirectUri,
      response_type: 'code',
      scope: GOOGLE_ADS_CONFIG.scopes.join(' '),
      access_type: GOOGLE_ADS_CONFIG.accessType,
      prompt: GOOGLE_ADS_CONFIG.prompt,
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  } else {
    // Facebook
    const params = new URLSearchParams({
      client_id: FACEBOOK_CONFIG.clientId,
      redirect_uri: FACEBOOK_CONFIG.redirectUri,
      response_type: 'code',
      scope: FACEBOOK_CONFIG.scopes.join(','),
      state,
      display: FACEBOOK_CONFIG.display,
    });
    authUrl = `https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`;
  }

  logger.info('OAuth authorization URL generated', { provider, userId });
  return { url: authUrl, state };
}

// ── Code Exchange ─────────────────────────────────────────────────────────

export async function exchangeCodeForTokens(
  provider: 'google_ads' | 'facebook',
  code: string,
  state: string,
): Promise<{ success: boolean; integrationId?: string }> {
  // 1. Validate state parameter
  const stateData = stateStore.get(state);
  if (!stateData) {
    throw new AppError('Invalid or expired OAuth state parameter', 400);
  }

  if (stateData.provider !== provider) {
    throw new AppError('OAuth state provider mismatch', 400);
  }

  // Clean up used state
  stateStore.delete(state);

  // 2. Exchange code for tokens
  let tokenResponse: OAuthTokenResponse;

  if (provider === 'google_ads') {
    tokenResponse = await exchangeGoogleAdsCode(code, GOOGLE_ADS_CONFIG);
  } else {
    tokenResponse = await exchangeFacebookCode(code, FACEBOOK_CONFIG);
  }

  // 3. Store tokens in integration credentials
  const integration = await findByName(provider);
  if (!integration) {
    throw new AppError(`Integration "${provider}" not found`, 404);
  }

  const existingCredentials = await parseExistingCredentials(
    integration.encrypted_credentials,
  );
  const credentials = {
    ...existingCredentials,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
  };

  const encrypted = await encryptJson(credentials);
  await updateIntegration(integration.id, {
    encryptedCredentials: encrypted,
    updatedBy: stateData.userId,
  });

  logger.info('OAuth tokens exchanged and stored', {
    provider,
    userId: stateData.userId,
    integrationId: integration.id,
  });

  return { success: true, integrationId: integration.id };
}

// ── Token Refresh ─────────────────────────────────────────────────────────

export async function refreshAccessToken(
  provider: 'google_ads' | 'facebook',
  integrationId: string,
): Promise<string> {
  const integration = await findByName(provider);
  if (!integration || !integration.encrypted_credentials) {
    throw new AppError(`Integration "${provider}" has no credentials`, 400);
  }

  const credentials = (await decryptJson(
    integration.encrypted_credentials,
  )) as Record<string, unknown>;

  let tokenResponse: OAuthTokenResponse;

  if (provider === 'google_ads') {
    const refreshToken = credentials.refreshToken as string | undefined;
    if (!refreshToken) {
      throw new AppError('Google Ads refresh token not found', 400);
    }
    tokenResponse = await refreshGoogleAdsToken(refreshToken, GOOGLE_ADS_CONFIG);
  } else {
    const refreshToken = credentials.refreshToken as string | undefined;
    if (!refreshToken) {
      throw new AppError('Facebook refresh token not found', 400);
    }
    tokenResponse = await refreshFacebookToken(refreshToken, FACEBOOK_CONFIG);
  }

  // Update stored credentials with new access token
  const updatedCredentials = {
    ...credentials,
    accessToken: tokenResponse.access_token,
    accessTokenExpiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
  };

  const encrypted = await encryptJson(updatedCredentials);
  await updateIntegration(integrationId, {
    encryptedCredentials: encrypted,
    updatedBy: 'system',
  });

  logger.info('OAuth token refreshed', { provider, integrationId });
  return tokenResponse.access_token;
}

// ── Helper Functions ──────────────────────────────────────────────────────

async function exchangeGoogleAdsCode(
  code: string,
  config: GoogleAdsOAuthConfig,
): Promise<OAuthTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error('Google Ads token exchange failed', { status: response.status, error });
    throw new AppError('Failed to exchange Google Ads authorization code', 502);
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function exchangeFacebookCode(
  code: string,
  config: FacebookOAuthConfig,
): Promise<OAuthTokenResponse> {
  const response = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&client_secret=${config.clientSecret}&code=${code}`,
  );

  if (!response.ok) {
    const error = await response.text();
    logger.error('Facebook token exchange failed', { status: response.status, error });
    throw new AppError('Failed to exchange Facebook authorization code', 502);
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function refreshGoogleAdsToken(
  refreshToken: string,
  config: GoogleAdsOAuthConfig,
): Promise<OAuthTokenResponse> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error('Google Ads token refresh failed', { status: response.status, error });
    throw new AppError('Failed to refresh Google Ads token', 502);
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function refreshFacebookToken(
  refreshToken: string,
  config: FacebookOAuthConfig,
): Promise<OAuthTokenResponse> {
  const response = await fetch(
    `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(config.redirectUri)}&client_secret=${config.clientSecret}&grant_type=fb_exchange_token&fb_exchange_token=${refreshToken}`,
  );

  if (!response.ok) {
    const error = await response.text();
    logger.error('Facebook token refresh failed', { status: response.status, error });
    throw new AppError('Failed to refresh Facebook token', 502);
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function parseExistingCredentials(
  encryptedCredentials: string | null,
): Promise<Record<string, unknown>> {
  if (!encryptedCredentials) {
    return {};
  }
  try {
    return (await decryptJson(encryptedCredentials)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function cleanupExpiredStates(): void {
  const now = Date.now();
  for (const [key, state] of stateStore.entries()) {
    if (new Date(state.createdAt).getTime() + STATE_TTL_MS < now) {
      stateStore.delete(key);
    }
  }
}
