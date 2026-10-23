import { COINS } from '../../shared/economy';
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
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const { pathname } = new URL(request.url);

    if (pathname === '/health') return json({ ok: true });

    const user = await verifyUser(request, env.FIREBASE_PROJECT_ID);
    if (!user) return json({ error: 'unauthenticated' }, 401);

    // ينشئ ملف اللاعب مع الرصيد الترحيبي مرة واحدة فقط (آمن ضد التكرار)
    if (pathname === '/profile/ensure' && request.method === 'POST') {
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const created = await db.createIfMissing('users', user.uid, {
        displayName: user.name,
        coins: COINS.signupBonus,
        createdAt: new Date(),
      });
      return json({ created });
    }

    // تغيير الاسم الظاهر (الحقول الأخرى مثل العملات لا تُعدّل إلا من الخادم)
    if (pathname === '/profile/name' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { displayName?: unknown };
      const name = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 20) : '';
      if (!name) return json({ error: 'invalid-name' }, 400);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      await db.createIfMissing('users', user.uid, { displayName: name, coins: COINS.signupBonus, createdAt: new Date() });
      await db.update('users', user.uid, { displayName: name });
      return json({ ok: true });
    }

    return json({ error: 'not-found' }, 404);
  },
};
