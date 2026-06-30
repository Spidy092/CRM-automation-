import express from 'express';
import request from 'supertest';
import { oauthRoutes } from './oauth.routes';
import * as oauthService from './oauth.service';
import { errorHandler } from '../../../shared/middleware/errorHandler';

jest.mock('./oauth.service');

let currentUser: { id: string; role: string } | null = { id: 'u1', role: 'admin' };

jest.mock('../../../shared/middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (!currentUser) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = currentUser;
    next();
  },
}));

jest.mock('../../../shared/middleware/rbac', () => ({
  authorize: jest.fn((...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ success: false, error: 'Forbidden: insufficient permissions' });
    }
    next();
  }),
}));

const app = express();
app.use(express.json());
app.use('/api/v1/oauth', oauthRoutes);
app.use(errorHandler);

const mockedService = oauthService as jest.Mocked<typeof oauthService>;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 'u1', role: 'admin' };
  delete process.env.FRONTEND_URL;
});

describe('GET /api/v1/oauth/:provider/authorize', () => {
  it('returns 200 with url + state for google_ads', async () => {
    mockedService.generateAuthorizationUrl.mockReturnValue({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      state: 'state-abc',
    });

    const res = await request(app).get('/api/v1/oauth/google_ads/authorize');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1',
      state: 'state-abc',
    });
    expect(mockedService.generateAuthorizationUrl).toHaveBeenCalledWith('google_ads', 'u1');
  });

  it('returns 200 for facebook', async () => {
    mockedService.generateAuthorizationUrl.mockReturnValue({
      url: 'https://www.facebook.com/v18.0/dialog/oauth?x=1',
      state: 'state-fb',
    });

    const res = await request(app).get('/api/v1/oauth/facebook/authorize');

    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('state-fb');
  });

  it('returns 400 for an unsupported provider', async () => {
    const res = await request(app).get('/api/v1/oauth/linkedin/authorize');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.generateAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    currentUser = null;
    const res = await request(app).get('/api/v1/oauth/google_ads/authorize');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockedService.generateAuthorizationUrl).not.toHaveBeenCalled();
  });

  it.each(['manager', 'sales', 'marketing', 'viewer'])(
    'rejects the %s role with 403',
    async (role) => {
      currentUser = { id: 'u1', role };
      const res = await request(app).get('/api/v1/oauth/google_ads/authorize');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(mockedService.generateAuthorizationUrl).not.toHaveBeenCalled();
    },
  );

  it('returns 401 when the authenticated user has no id', async () => {
    currentUser = { id: '', role: 'admin' };
    const res = await request(app).get('/api/v1/oauth/google_ads/authorize');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(mockedService.generateAuthorizationUrl).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/oauth/:provider/callback', () => {
  it('redirects to the success page when token exchange succeeds (default FRONTEND_URL)', async () => {
    mockedService.exchangeCodeForTokens.mockResolvedValue({ integrationId: 'int-99' } as any);

    const res = await request(app).get(
      '/api/v1/oauth/google_ads/callback?code=the-code&state=the-state',
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      'http://localhost:5173/settings/integrations?oauth=success&id=int-99',
    );
    expect(mockedService.exchangeCodeForTokens).toHaveBeenCalledWith(
      'google_ads',
      'the-code',
      'the-state',
    );
  });

  it('uses FRONTEND_URL env var on success when set', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    mockedService.exchangeCodeForTokens.mockResolvedValue({ integrationId: 'int-7' } as any);

    const res = await request(app).get(
      '/api/v1/oauth/facebook/callback?code=c&state=s',
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      'https://app.example.com/settings/integrations?oauth=success&id=int-7',
    );
  });

  it('redirects to the error page when token exchange throws an Error', async () => {
    mockedService.exchangeCodeForTokens.mockRejectedValue(new Error('bad state'));

    const res = await request(app).get(
      '/api/v1/oauth/google_ads/callback?code=c&state=s',
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      'http://localhost:5173/settings/integrations?oauth=error&message=bad%20state',
    );
  });

  it('redirects to the error page with Unknown error for a non-Error throw', async () => {
    mockedService.exchangeCodeForTokens.mockRejectedValue('weird');

    const res = await request(app).get(
      '/api/v1/oauth/google_ads/callback?code=c&state=s',
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth=error');
    expect(res.headers.location).toContain('Unknown%20error');
  });

  it('returns 400 for an unsupported provider', async () => {
    const res = await request(app).get(
      '/api/v1/oauth/linkedin/callback?code=c&state=s',
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing', async () => {
    const res = await request(app).get('/api/v1/oauth/google_ads/callback?state=s');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(app).get('/api/v1/oauth/google_ads/callback?code=c');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('rejects non-admin roles with 403', async () => {
    currentUser = { id: 'u1', role: 'manager' };
    const res = await request(app).get(
      '/api/v1/oauth/google_ads/callback?code=c&state=s',
    );

    expect(res.status).toBe(403);
    expect(mockedService.exchangeCodeForTokens).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/oauth/:provider/refresh', () => {
  it('returns 200 and refreshes the token', async () => {
    mockedService.refreshAccessToken.mockResolvedValue(undefined as any);

    const res = await request(app)
      .post('/api/v1/oauth/google_ads/refresh')
      .send({ integrationId: 'int-1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.success).toBe(true);
    expect(typeof res.body.data.accessTokenExpiresAt).toBe('string');
    expect(mockedService.refreshAccessToken).toHaveBeenCalledWith('google_ads', 'int-1');
  });

  it('returns 400 for an unsupported provider', async () => {
    const res = await request(app)
      .post('/api/v1/oauth/linkedin/refresh')
      .send({ integrationId: 'int-1' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('returns 400 when integrationId is missing', async () => {
    const res = await request(app).post('/api/v1/oauth/google_ads/refresh').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockedService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('propagates service errors through the error handler (500)', async () => {
    mockedService.refreshAccessToken.mockRejectedValue(new Error('refresh failed'));

    const res = await request(app)
      .post('/api/v1/oauth/google_ads/refresh')
      .send({ integrationId: 'int-1' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('requires authentication', async () => {
    currentUser = null;
    const res = await request(app)
      .post('/api/v1/oauth/google_ads/refresh')
      .send({ integrationId: 'int-1' });

    expect(res.status).toBe(401);
    expect(mockedService.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('rejects non-admin roles with 403', async () => {
    currentUser = { id: 'u1', role: 'sales' };
    const res = await request(app)
      .post('/api/v1/oauth/google_ads/refresh')
      .send({ integrationId: 'int-1' });

    expect(res.status).toBe(403);
    expect(mockedService.refreshAccessToken).not.toHaveBeenCalled();
  });
});
