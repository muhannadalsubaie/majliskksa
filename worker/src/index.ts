import { COINS } from '../../shared/economy';
import { cleanUsername, usernameKey, validateUsername } from '../../shared/username';
import { verifyUser } from './auth';
import type { Env } from './env';
import { Firestore } from './firestore';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      // رسالة الخطأ فقط (بدون أي أسرار) لتسهيل التشخيص
      console.error(e);
      return json({ error: 'server', detail: String((e as Error).message ?? e).slice(0, 300) }, 500);
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404);
    const pathname = url.pathname.slice(4); // إزالة البادئة /api

    if (pathname === '/health') {
      // فحص اتصال الخادم بقاعدة البيانات (بدون كشف أي بيانات)
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT ?? '');
      let firestore = 'ok';
      try { await db.get('usernames', '__healthcheck__'); } catch (e) { firestore = String((e as Error).message).slice(0, 300); }
      return json({ ok: true, firestore, hasServiceAccount: Boolean(env.FIREBASE_SERVICE_ACCOUNT) });
    }

    // فحص توفر اسم المستخدم (متاح قبل إنشاء الحساب، لذلك بدون تسجيل دخول)
    if (pathname === '/username/available' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { username?: unknown };
      const raw = typeof body.username === 'string' ? body.username : '';
      const invalid = validateUsername(raw);
      if (invalid) return json({ available: false, error: invalid });
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const existing = await db.get('usernames', usernameKey(raw));
      return json({ available: !existing, error: existing ? 'taken' : undefined });
    }

    const user = await verifyUser(request, env.FIREBASE_PROJECT_ID);
    if (!user) return json({ error: 'unauthenticated' }, 401);

    // ينشئ ملف اللاعب مع الرصيد الترحيبي مرة واحدة فقط (آمن ضد التكرار)
    if (pathname === '/profile/ensure' && request.method === 'POST') {
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const created = await db.createIfMissing('users', user.uid, {
        username: '',
        coins: COINS.signupBonus,
        createdAt: new Date(),
      });
      return json({ created });
    }

    // حجز اسم مستخدم فريد — مرة واحدة لكل حساب.
    // الحجز ذرّي: مستند usernames/{المفتاح الموحّد} لا يُنشأ إلا إن لم يكن موجوداً.
    if (pathname === '/profile/username' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { username?: unknown };
      const raw = typeof body.username === 'string' ? body.username : '';
      const invalid = validateUsername(raw);
      if (invalid) return json({ error: invalid }, 400);
      const username = cleanUsername(raw);
      const key = usernameKey(raw);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);

      await db.createIfMissing('users', user.uid, { username: '', coins: COINS.signupBonus, createdAt: new Date() });
      const profile = await db.get('users', user.uid);
      if (profile?.username) return json({ error: 'already-set' }, 409);

      const claimed = await db.createIfMissing('usernames', key, { uid: user.uid, username, createdAt: new Date() });
      if (!claimed) {
        const owner = await db.get('usernames', key);
        if (owner?.uid !== user.uid) return json({ error: 'taken' }, 409);
      }
      await db.update('users', user.uid, { username });
      return json({ ok: true, username });
    }

    return json({ error: 'not-found' }, 404);
}
