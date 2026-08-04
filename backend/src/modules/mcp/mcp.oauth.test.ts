import type { Request, Response } from 'express';

// mcp.oauth.ts starts a module-level setInterval cleanup sweep on import.
// Enable fake timers before requiring it so the interval never schedules a
// real OS timer that would keep the Jest process alive.
jest.useFakeTimers();
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  oauthMetadata,
  oauthRegister,
  oauthAuthorize,
  oauthAuthorizeSubmit,
  oauthToken,
} = require('./mcp.oauth') as typeof import('./mcp.oauth');

afterAll(() => {
  jest.useRealTimers();
});

function buildRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnThis();
  res.json = jest.fn().mockReturnThis();
  res.send = jest.fn().mockReturnThis();
  res.setHeader = jest.fn().mockReturnThis();
  return res as Response;
}

describe('oauthMetadata', () => {
  it('returns the well-known OAuth authorization server metadata', () => {
    const req = {} as Request;
    const res = buildRes();
    oauthMetadata(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_endpoint: expect.stringContaining('/oauth/authorize'),
        token_endpoint: expect.stringContaining('/oauth/token'),
        registration_endpoint: expect.stringContaining('/oauth/register'),
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
      }),
    );
  });
});

describe('oauthRegister', () => {
  it('returns 400 when redirect_uris is missing', () => {
    const req = { body: {} } as Request;
    const res = buildRes();
    oauthRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_client_metadata' }),
    );
  });

  it('returns 400 when redirect_uris is an empty array', () => {
    const req = { body: { redirect_uris: [] } } as Request;
    const res = buildRes();
    oauthRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('registers a client and returns a client_id', () => {
    const req = {
      body: { redirect_uris: ['https://claude.ai/callback'], client_name: 'Claude Web' },
    } as Request;
    const res = buildRes();
    oauthRegister(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: expect.stringMatching(/^crm_client_/),
        redirect_uris: ['https://claude.ai/callback'],
        client_name: 'Claude Web',
        token_endpoint_auth_method: 'none',
      }),
    );
  });

  it('defaults client_name to Unknown Client when not provided', () => {
    const req = { body: { redirect_uris: ['https://claude.ai/callback'] } } as Request;
    const res = buildRes();
    oauthRegister(req, res);
    const jsonCall = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonCall.client_name).toBeUndefined();
  });
});

describe('oauthAuthorize', () => {
  it('returns 400 when redirect_uri is missing', () => {
    const req = { query: {} } as unknown as Request;
    const res = buildRes();
    oauthAuthorize(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Missing redirect_uri');
  });

  it('renders an HTML authorization form when redirect_uri is present', () => {
    const req = {
      query: { redirect_uri: 'https://claude.ai/callback', state: 'xyz', client_id: 'abc' },
    } as unknown as Request;
    const res = buildRes();
    oauthAuthorize(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("default-src 'self'"),
    );
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Connect Claude to CRM'));
    const html = (res.send as jest.Mock).mock.calls[0][0];
    expect(html).toContain(JSON.stringify('https://claude.ai/callback'));
  });

  it('escapes HTML in the settings link derived from BASE_URL-safe content', () => {
    const req = {
      query: { redirect_uri: 'https://claude.ai/callback' },
    } as unknown as Request;
    const res = buildRes();
    oauthAuthorize(req, res);
    const html = (res.send as jest.Mock).mock.calls[0][0];
    expect(html).toContain('/settings/api-keys');
  });
});

describe('oauthAuthorizeSubmit', () => {
  it('returns 400 when redirect_uri is missing', async () => {
    const req = { body: { apiKey: 'crm_abc' } } as Request;
    const res = buildRes();
    await oauthAuthorizeSubmit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when apiKey does not start with crm_', async () => {
    const req = {
      body: { redirect_uri: 'https://claude.ai/callback', apiKey: 'not-a-key' },
    } as Request;
    const res = buildRes();
    await oauthAuthorizeSubmit(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('crm_') }),
    );
  });

  it('issues a code and returns a redirectUrl carrying the code and state', async () => {
    const req = {
      body: { redirect_uri: 'https://claude.ai/callback', state: 'xyz', apiKey: 'crm_validkey' },
    } as Request;
    const res = buildRes();
    await oauthAuthorizeSubmit(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ redirectUrl: expect.stringContaining('https://claude.ai/callback') }),
    );
    const redirectUrl = (res.json as jest.Mock).mock.calls[0][0].redirectUrl;
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('xyz');
  });

  it('omits the state param when none was provided', async () => {
    const req = {
      body: { redirect_uri: 'https://claude.ai/callback', apiKey: 'crm_validkey' },
    } as Request;
    const res = buildRes();
    await oauthAuthorizeSubmit(req, res);
    const redirectUrl = (res.json as jest.Mock).mock.calls[0][0].redirectUrl;
    const url = new URL(redirectUrl);
    expect(url.searchParams.get('state')).toBeNull();
  });
});

describe('oauthToken', () => {
  async function issueCode(apiKey = 'crm_validkey', redirectUri = 'https://claude.ai/callback') {
    const submitReq = { body: { redirect_uri: redirectUri, apiKey } } as Request;
    const submitRes = buildRes();
    await oauthAuthorizeSubmit(submitReq, submitRes);
    const redirectUrl = (submitRes.json as jest.Mock).mock.calls[0][0].redirectUrl;
    return new URL(redirectUrl).searchParams.get('code') as string;
  }

  it('returns 400 for an unsupported grant_type', () => {
    const req = { body: { code: 'whatever', grant_type: 'client_credentials' } } as Request;
    const res = buildRes();
    oauthToken(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'unsupported_grant_type' });
  });

  it('returns 400 invalid_grant for an unknown code', () => {
    const req = { body: { code: 'does-not-exist', grant_type: 'authorization_code' } } as Request;
    const res = buildRes();
    oauthToken(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_grant' });
  });

  it('exchanges a valid code for an access_token matching the original apiKey', async () => {
    const code = await issueCode('crm_secretkey');
    const req = { body: { code, grant_type: 'authorization_code' } } as Request;
    const res = buildRes();
    oauthToken(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: 'crm_secretkey', token_type: 'bearer' }),
    );
  });

  it('is single-use: a second exchange of the same code fails', async () => {
    const code = await issueCode('crm_onceonly');
    const firstReq = { body: { code, grant_type: 'authorization_code' } } as Request;
    oauthToken(firstReq, buildRes());

    const secondReq = { body: { code, grant_type: 'authorization_code' } } as Request;
    const secondRes = buildRes();
    oauthToken(secondReq, secondRes);
    expect(secondRes.status).toHaveBeenCalledWith(400);
    expect(secondRes.json).toHaveBeenCalledWith({ error: 'invalid_grant' });
  });
});
