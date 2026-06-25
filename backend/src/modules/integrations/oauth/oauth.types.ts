/**
 * OAuth 2.0 flow types for Google Ads and Facebook integrations.
 *
 * Both providers use the standard OAuth 2.0 authorization code flow:
 *   1. Frontend redirects user to provider's auth URL
 *   2. User authorizes the app
 *   3. Provider redirects back with an authorization code
 *   4. Backend exchanges code for access/refresh tokens
 *   5. Tokens are stored encrypted in integrations.encrypted_credentials
 */

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export interface OAuthState {
  provider: 'google_ads' | 'facebook';
  userId: string;
  redirectUri: string;
  createdAt: string;
}

export interface GoogleAdsOAuthConfig extends OAuthConfig {
  accessType: 'offline';
  prompt: 'consent';
}

export interface FacebookOAuthConfig extends OAuthConfig {
  display: 'popup';
}
