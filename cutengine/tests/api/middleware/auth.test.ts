import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import { verifyJwt } from '../../../src/api/middleware/auth.js';

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createTestJwt(payload: Record<string, any>, secret: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

const TEST_SECRET = 'test-jwt-secret-key-for-testing';
const TEST_API_KEY = 'test-api-key-12345';

describe('Auth Middleware', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      AUTH_ENABLED: process.env.AUTH_ENABLED,
      API_KEYS: process.env.API_KEYS,
      JWT_SECRET: process.env.JWT_SECRET,
    };
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  describe('verifyJwt', () => {
    it('validates a correctly signed JWT', () => {
      const token = createTestJwt({ sub: 'user1', iat: Math.floor(Date.now() / 1000) }, TEST_SECRET);
      const result = verifyJwt(token, TEST_SECRET);
      expect(result.valid).toBe(true);
      expect(result.payload.sub).toBe('user1');
    });

    it('rejects JWT with wrong secret', () => {
      const token = createTestJwt({ sub: 'user1' }, 'wrong-secret');
      const result = verifyJwt(token, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('rejects expired JWT', () => {
      const token = createTestJwt({ sub: 'user1', exp: Math.floor(Date.now() / 1000) - 3600 }, TEST_SECRET);
      const result = verifyJwt(token, TEST_SECRET);
      expect(result.valid).toBe(false);
    });

    it('rejects malformed token', () => {
      expect(verifyJwt('not-a-jwt', TEST_SECRET).valid).toBe(false);
      expect(verifyJwt('a.b', TEST_SECRET).valid).toBe(false);
      expect(verifyJwt('', TEST_SECRET).valid).toBe(false);
    });
  });

  describe('authMiddleware integration', () => {
    // We import createServer dynamically to pick up env changes
    async function createAppWithAuth(authEnabled: boolean) {
      process.env.AUTH_ENABLED = authEnabled ? 'true' : 'false';
      process.env.API_KEYS = TEST_API_KEY;
      process.env.JWT_SECRET = TEST_SECRET;

      // Clear config module cache so it re-reads env
      const configMod = await import('../../../src/config/index.js');

      // We need to patch config directly since it's already loaded
      const cfg = configMod.config as any;
      cfg.auth.enabled = authEnabled;
      cfg.auth.apiKeys = [TEST_API_KEY];
      cfg.auth.jwtSecret = TEST_SECRET;

      const { createServer } = await import('../../../src/server.js');
      const app = await createServer({ testing: true });

      // Add auth middleware to a test route
      const { authMiddleware } = await import('../../../src/api/middleware/auth.js');
      app.addHook('onRequest', authMiddleware);

      return app;
    }

    it('auth disabled - all requests pass through', async () => {
      const app = await createAppWithAuth(false);
      try {
        const res = await app.inject({ method: 'GET', url: '/' });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it('auth enabled + valid x-api-key passes', async () => {
      const app = await createAppWithAuth(true);
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/',
          headers: { 'x-api-key': TEST_API_KEY },
        });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it('auth enabled + invalid x-api-key returns 401', async () => {
      const app = await createAppWithAuth(true);
      try {
        const res = await app.inject({
          method: 'GET',
          url: '/',
          headers: { 'x-api-key': 'invalid-key' },
        });
        expect(res.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });

    it('auth enabled + valid JWT Bearer passes', async () => {
      const app = await createAppWithAuth(true);
      try {
        const token = createTestJwt(
          { sub: 'user1', iat: Math.floor(Date.now() / 1000) },
          TEST_SECRET,
        );
        const res = await app.inject({
          method: 'GET',
          url: '/',
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it('auth enabled + no auth header returns 401', async () => {
      const app = await createAppWithAuth(true);
      try {
        const res = await app.inject({ method: 'GET', url: '/' });
        expect(res.statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });
  });
});
