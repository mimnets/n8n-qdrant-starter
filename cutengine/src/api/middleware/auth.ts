import { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/index.js';

function base64UrlDecode(str: string): Buffer {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function verifyJwt(token: string, secret: string): { valid: boolean; payload?: any } {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false };

  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(base64UrlDecode(headerB64).toString('utf-8'));
    if (header.alg !== 'HS256') return { valid: false };

    const expectedSig = base64UrlEncode(
      createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest(),
    );

    const sigBuf = Buffer.from(signatureB64);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length) return { valid: false };
    if (!timingSafeEqual(sigBuf, expectedBuf)) return { valid: false };

    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8'));

    // Check expiration if present
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return { valid: false };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  if (!config.auth.enabled) return;

  // Check x-api-key header first (Shotstack compatible)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey && config.auth.apiKeys.includes(apiKey)) {
    return;
  }

  // Check Authorization: Bearer <jwt> header
  const authHeader = req.headers['authorization'] as string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (config.auth.jwtSecret) {
      const result = verifyJwt(token, config.auth.jwtSecret);
      if (result.valid) {
        (req as any).user = result.payload;
        return;
      }
    }
  }

  reply.status(401).send({ success: false, message: 'Unauthorized: invalid credentials' });
}
