/**
 * Minimal OAuth 2.0 Authorization Server for Claude Web MCP Connector
 *
 * Flow:
 *  1. Claude Web discovers /.well-known/oauth-authorization-server
 *  2. Redirects user to GET /oauth/authorize  (with PKCE params)
 *  3. User sees a simple HTML form, enters their CRM API key
 *  4. Server stores {code -> apiKey} in a short-lived map, redirects back with ?code=…
 *  5. Claude Web POSTs to /oauth/token to exchange code → access_token (the API key)
 *  6. All subsequent MCP requests use  Authorization: Bearer crm_…
 */

import type { Request, Response } from 'express';
import crypto from 'crypto';

const BASE_URL = process.env.BACKEND_URL ?? 'https://crm.gururajhr.in';

// RFC 7591 Dynamic Client Registration — stores registered OAuth clients
const registeredClients = new Map<string, { redirectUris: string[]; clientName: string }>();

// Short-lived code → apiKey store (5-minute TTL)
const pendingCodes = new Map<string, { apiKey: string; expiresAt: number }>();

// Cleanup expired codes every minute
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of pendingCodes) {
    if (entry.expiresAt < now) pendingCodes.delete(code);
  }
}, 60_000);

/** GET /.well-known/oauth-authorization-server */
export function oauthMetadata(_req: Request, res: Response): void {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    registration_endpoint: `${BASE_URL}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}

/** POST /oauth/register — RFC 7591 Dynamic Client Registration */
export function oauthRegister(req: Request, res: Response): void {
  const body = req.body as {
    redirect_uris?: string[];
    client_name?: string;
    [key: string]: unknown;
  };

  if (!body.redirect_uris || !Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required' });
    return;
  }

  const clientId = `crm_client_${crypto.randomBytes(16).toString('hex')}`;
  registeredClients.set(clientId, {
    redirectUris: body.redirect_uris,
    clientName: body.client_name ?? 'Unknown Client',
  });

  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris,
    client_name: body.client_name,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
}

/** GET /oauth/authorize  — shows the API key entry form */
export function oauthAuthorize(req: Request, res: Response): void {
  const { redirect_uri, state, client_id } = req.query as Record<string, string>;

  if (!redirect_uri) {
    res.status(400).send('Missing redirect_uri');
    return;
  }

  // Override CSP so the page can make a fetch() and navigate to claude.ai.
  // form-action 'self' (Helmet default) would block the redirect to claude.ai.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self'; img-src 'self' data:; font-src 'self' https: data:;",
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connect Claude to CRM</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117; color: #e2e8f0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 1rem;
    }
    .card {
      background: #1a1f2e; border: 1px solid #2d3748; border-radius: 16px;
      padding: 2.5rem; max-width: 440px; width: 100%;
      box-shadow: 0 25px 50px rgba(0,0,0,.5);
    }
    .logo { font-size: 2rem; margin-bottom: 0.5rem; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.5rem; }
    p { font-size: 0.875rem; color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.5; }
    label { display: block; font-size: 0.8rem; font-weight: 600; margin-bottom: 0.4rem; color: #cbd5e1; }
    input {
      width: 100%; padding: 0.75rem 1rem; border-radius: 8px;
      border: 1px solid #374151; background: #0f1117; color: #e2e8f0;
      font-size: 0.875rem; margin-bottom: 1.25rem; outline: none; font-family: monospace;
    }
    input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    button {
      width: 100%; padding: 0.75rem; border-radius: 8px; border: none;
      background: #6366f1; color: white; font-weight: 600; font-size: 0.875rem;
      cursor: pointer; transition: background .15s;
    }
    button:hover { background: #4f46e5; }
    button:disabled { background: #4338ca; cursor: not-allowed; opacity: 0.7; }
    .error { color: #f87171; font-size: 0.8rem; margin-bottom: 1rem; display: none; }
    .hint { margin-top: 1rem; font-size: 0.75rem; color: #64748b; text-align: center; }
    .hint a { color: #6366f1; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🔗</div>
    <h1>Connect Claude to CRM</h1>
    <p>Enter your CRM API key to allow Claude to access your workspace. Generate one in <strong>Settings → API Keys</strong>.</p>
    <div class="error" id="err"></div>
    <label for="apiKey">CRM API Key</label>
    <input id="apiKey" type="password" placeholder="crm_xxxxxxxxxxxxxxxx" autocomplete="off" />
    <button id="btn" onclick="authorize()">Authorize Claude</button>
    <p class="hint">Don't have an API key? <a href="${escapeHtml(BASE_URL)}/settings/api-keys" target="_blank">Create one here</a></p>
  </div>
  <script>
    async function authorize() {
      var apiKey = document.getElementById('apiKey').value.trim();
      var btn = document.getElementById('btn');
      var err = document.getElementById('err');
      err.style.display = 'none';

      if (!apiKey.startsWith('crm_')) {
        err.textContent = 'API key must start with crm_';
        err.style.display = 'block';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Authorizing…';

      try {
        var res = await fetch('/oauth/authorize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            redirect_uri: ${JSON.stringify(redirect_uri)},
            state: ${JSON.stringify(state ?? '')},
            client_id: ${JSON.stringify(client_id ?? '')},
            apiKey: apiKey
          })
        });

        if (!res.ok) {
          var text = await res.text();
          throw new Error(text || 'Authorization failed');
        }

        var data = await res.json();
        window.location.href = data.redirectUrl;
      } catch(e) {
        err.textContent = e.message || 'Something went wrong. Please try again.';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Authorize Claude';
      }
    }

    document.getElementById('apiKey').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') authorize();
    });
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}

/** POST /oauth/authorize — issues code, returns redirectUrl as JSON (JS client navigates) */
export async function oauthAuthorizeSubmit(req: Request, res: Response): Promise<void> {
  // Accept both JSON (from fetch) and urlencoded (legacy)
  const body = req.body as Record<string, string>;
  const { redirect_uri, state, apiKey } = body;

  if (!redirect_uri || !apiKey?.startsWith('crm_')) {
    res.status(400).json({ error: 'Invalid API key format. Key must start with crm_' });
    return;
  }

  // Store code → apiKey with 5-minute TTL
  const code = crypto.randomBytes(32).toString('hex');
  pendingCodes.set(code, { apiKey, expiresAt: Date.now() + 5 * 60 * 1000 });

  // Build the redirect URL and return it as JSON — the browser JS navigates there
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  res.json({ redirectUrl: redirectUrl.toString() });
}

/** POST /oauth/token — exchanges code for access_token (the API key) */
export function oauthToken(req: Request, res: Response): void {
  const { code, grant_type } = req.body as Record<string, string>;

  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }

  const entry = pendingCodes.get(code);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingCodes.delete(code);
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  // One-time use
  pendingCodes.delete(code);

  res.json({
    access_token: entry.apiKey,
    token_type: 'bearer',
    expires_in: 31536000, // 1 year — actual validity is managed by the API key itself
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
