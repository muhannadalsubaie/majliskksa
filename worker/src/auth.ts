import { createRemoteJWKSet, jwtVerify } from 'jose';

// مفاتيح Google العامة لتوقيع توكنات Firebase Auth
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export interface AuthUser { uid: string; name: string; email?: string }

/** يتحقق من توكن Firebase المرسل في ترويسة Authorization. */
export async function verifyUser(request: Request, projectId: string, devAuth = false): Promise<AuthUser | null> {
  const header = request.headers.get('Authorization') ?? '';
  return verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '', projectId, devAuth);
}

export async function verifyToken(token: string, projectId: string, devAuth = false): Promise<AuthUser | null> {
  if (!token) return null;
  // للتطوير المحلي فقط: dev:<uid>:<name>
  if (devAuth && token.startsWith('dev:')) {
    const [, uid, name = uid] = token.split(':');
    return uid ? { uid, name } : null;
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (!payload.sub) return null;
    return { uid: payload.sub, name: String(payload.name ?? ''), email: payload.email as string | undefined };
  } catch {
    return null;
  }
}
