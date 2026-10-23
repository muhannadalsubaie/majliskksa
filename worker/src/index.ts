import { COINS } from '../../shared/economy';
import { cleanUsername, usernameKey, validateUsername } from '../../shared/username';
import { isUnlimited, verifyToken, verifyUser } from './auth';
import type { Env } from './env';
import { Firestore } from './firestore';

export { TableRoom } from './table-room';


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  /** تنظيف دوري: إزالة الطاولات المغلقة/المهجورة من قائمة الانضمام */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
    const ids = await db.listIds('tables');
    for (const id of ids) {
      if (!/^[0-9a-f]{64}$/.test(id)) { await db.remove('tables', id); continue; }
      const alive = await env.TABLES.get(env.TABLES.idFromString(id)).checkAlive().catch(() => false);
      if (!alive) await db.remove('tables', id);
    }
  },

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
      try { await db.get('usernames', 'healthcheck'); } catch (e) { firestore = String((e as Error).message).slice(0, 300); }
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

    const devAuth = env.DEV_AUTH === '1';

    // اتصال مباشر بالطاولة (WebSocket) — التوكن في الرابط لأن المتصفح لا يرسل ترويسات هنا
    const wsMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/ws$/);
    if (wsMatch) {
      const wsUser = await verifyToken(url.searchParams.get('token') ?? '', env.FIREBASE_PROJECT_ID, devAuth);
      if (!wsUser) return json({ error: 'unauthenticated' }, 401);
      const stub = env.TABLES.get(env.TABLES.idFromString(wsMatch[1]));
      if (!(await stub.isMember(wsUser.uid))) return json({ error: 'not-a-member' }, 403);
      const headers = new Headers(request.headers);
      headers.set('X-Uid', wsUser.uid);
      return stub.fetch(new Request(request, { headers }));
    }

    const user = await verifyUser(request, env.FIREBASE_PROJECT_ID, devAuth);
    if (!user) return json({ error: 'unauthenticated' }, 401);

    /** اسم المستخدم الفريد من ملف اللاعب (إلزامي لدخول الطاولات) */
    const usernameOf = async (uid: string): Promise<string> => {
      if (devAuth) return user.name;
      const profile = await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).get('users', uid);
      return String(profile?.username ?? '');
    };

    // إنشاء طاولة: عملتان من المنشئ
    if (pathname === '/tables' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { isPrivate?: unknown };
      const username = await usernameOf(user.uid);
      if (!username) return json({ error: 'no-username' }, 400);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      if (!devAuth) {
        try { await db.adjustCoins(user.uid, -COINS.createTable); } catch (e) { return json({ error: (e as Error).message }, 402); }
      }
      const id = env.TABLES.newUniqueId();
      try {
        await env.TABLES.get(id).create(id.toString(), { uid: user.uid, username }, body.isPrivate === true);
      } catch (e) {
        if (!devAuth) await db.adjustCoins(user.uid, COINS.createTable).catch(() => {}); // استرجاع عند الفشل
        throw e;
      }
      return json({ id: id.toString() });
    }

    // الانضمام لطاولة: عملة من المنضم (مرة واحدة لكل طاولة)
    const joinMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/join$/);
    if (joinMatch && request.method === 'POST') {
      const username = await usernameOf(user.uid);
      if (!username) return json({ error: 'no-username' }, 400);
      const body = (await request.json().catch(() => ({}))) as { invite?: unknown };
      const invite = typeof body.invite === 'string' ? body.invite.slice(0, 20) : undefined;
      const r = await env.TABLES.get(env.TABLES.idFromString(joinMatch[1])).joinTable({ uid: user.uid, username }, invite);
      return 'error' in r ? json(r, r.error === 'not-enough-coins' ? 402 : 400) : json(r);
    }

    // ينشئ ملف اللاعب مع الرصيد الترحيبي مرة واحدة فقط (آمن ضد التكرار)
    if (pathname === '/profile/ensure' && request.method === 'POST') {
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const created = await db.createIfMissing('users', user.uid, {
        username: '',
        coins: COINS.signupBonus,
        createdAt: new Date(),
      });
      // علامة حساب المطوّر تُكتب من الخادم فقط
      if (await isUnlimited(user, env.UNLIMITED_EMAIL_SHA256)) await db.update('users', user.uid, { unlimited: true });
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

    // رابط دعوة من مالك الطاولة
    const inviteMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/invite$/);
    if (inviteMatch && request.method === 'POST') {
      const r = await env.TABLES.get(env.TABLES.idFromString(inviteMatch[1])).createInvite(user.uid);
      return 'error' in r ? json(r, r.error === 'not-enough-coins' ? 402 : 400) : json(r);
    }

    return json({ error: 'not-found' }, 404);
}
