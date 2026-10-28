import { createRemoteJWKSet, jwtVerify } from 'jose';

// مفاتيح Google العامة لتوقيع توكنات Firebase Auth
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

export interface AuthUser { uid: string; name: string; email?: string; emailVerified?: boolean }

/** يتحقق من توكن Firebase المرسل في ترويسة Authorization. */
export async function verifyUser(request: Request, projectId: string, devAuth = false): Promise<AuthUser | null> {
  const header = request.headers.get('Authorization') ?? '';
  return verifyToken(header.startsWith('Bearer ') ? header.slice(7) : '', projectId, devAuth);
}

export async function verifyToken(token: string, projectId: string, devAuth = false): Promise<AuthUser | null> {
  if (!token) return null;
  // للتطوير المحلي فقط: dev:<uid>:<name> (الاسم بترميز الروابط ليقبل العربية)
  if (devAuth && token.startsWith('dev:')) {
    const [, uid, name = uid] = token.split(':');
    return uid ? { uid, name: decodeURIComponent(name) } : null;
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    if (!payload.sub) return null;
    return {
      uid: payload.sub,
      name: String(payload.name ?? ''),
      email: payload.email as string | undefined,
      emailVerified: payload.email_verified === true,
    };
  } catch {
    return null;
  }
}

/** هل هذا حساب مطوّر (عملات لا محدودة)؟ يُشترط أن يكون الإيميل موثّقاً. */
export async function isUnlimited(user: AuthUser, hashes: string | undefined): Promise<boolean> {
  if (!hashes || !user.email || !user.emailVerified) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(user.email.trim().toLowerCase()));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashes.split(',').map((h) => h.trim()).includes(hex);
}
