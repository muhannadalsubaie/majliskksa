import { COINS, MAX_ADS_PER_DAY } from '../../shared/economy';
import { cleanUsername, usernameKey, validateUsername } from '../../shared/username';
import { isUnlimited, verifyToken, verifyUser } from './auth';
import type { Env } from './env';
import { Firestore } from './firestore';
import { verifySsv } from './ads';

export { TableRoom } from './table-room';
export { UserHub } from './user-hub';


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

    // مكافأة إعلان: Google تستدعي هذا الرابط (موقّعاً) بعد مشاهدة الإعلان كاملاً
    if (pathname === '/ads/ssv') {
      const reward = await verifySsv(url);
      if (!reward || !reward.userId) return json({ error: 'invalid' }, 400);
      const verdict = await env.HUBS.get(env.HUBS.idFromName(reward.userId)).claimAdReward(reward.transactionId, MAX_ADS_PER_DAY);
      if (verdict === 'ok') {
        await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).adjustCoins(reward.userId, COINS.watchAdReward);
      }
      return json({ ok: true, verdict }); // نرد 200 دائماً حتى لا تعيد Google المحاولة
    }

    // اتصال التطبيق بمركز اللاعب (الأصدقاء والحالة والدعوات)
    if (pathname === '/me/ws') {
      const me = await verifyToken(url.searchParams.get('token') ?? '', env.FIREBASE_PROJECT_ID, devAuth);
      if (!me) return json({ error: 'unauthenticated' }, 401);
      return env.HUBS.get(env.HUBS.idFromName(me.uid)).fetch(request);
    }

    const user = await verifyUser(request, env.FIREBASE_PROJECT_ID, devAuth);
    if (!user) return json({ error: 'unauthenticated' }, 401);
    const hub = (uid: string) => env.HUBS.get(env.HUBS.idFromName(uid));

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

    // ───── الإعلانات ─────
    if (pathname === '/ads/status' && request.method === 'POST') {
      return json({ left: await hub(user.uid).adsLeftToday(MAX_ADS_PER_DAY), testMode: env.ADS_TEST_REWARDS === '1' });
    }
    // وضع التجربة فقط: إعلانات Google التجريبية لا ترسل SSV، فنقبل تأكيد التطبيق مع نفس الحد اليومي
    if (pathname === '/ads/test-reward' && request.method === 'POST') {
      if (env.ADS_TEST_REWARDS !== '1') return json({ error: 'disabled' }, 403);
      const verdict = await hub(user.uid).claimAdReward('', MAX_ADS_PER_DAY);
      if (verdict !== 'ok') return json({ error: verdict }, 429);
      if (!devAuth) await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).adjustCoins(user.uid, COINS.watchAdReward);
      return json({ ok: true });
    }

    // ───── الأصدقاء ─────
    const body = async () => (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const db = () => new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
    /** معرّف اللاعب من اسم المستخدم (عبر جدول الأسماء الفريدة) */
    const uidOfUsername = async (name: string): Promise<{ uid: string; username: string } | null> => {
      if (devAuth) return name ? { uid: name, username: name } : null;
      const entry = await db().get('usernames', usernameKey(name));
      return entry?.uid ? { uid: String(entry.uid), username: String(entry.username) } : null;
    };

    if (pathname === '/friends/list' && request.method === 'POST') {
      const state = await hub(user.uid).getState();
      const friends = await Promise.all(state.friends.map(async (f) => ({ ...f, online: await hub(f.uid).isOnline() })));
      return json({ ...state, friends });
    }

    if (pathname === '/friends/request' && request.method === 'POST') {
      const target = await uidOfUsername(String((await body()).username ?? '').trim());
      if (!target) return json({ error: 'user-not-found' }, 404);
      if (target.uid === user.uid) return json({ error: 'self' }, 400);
      if (await hub(user.uid).isFriend(target.uid)) return json({ error: 'already-friends' }, 400);
      const myName = await usernameOf(user.uid);
      if (!myName) return json({ error: 'no-username' }, 400);
      // إن كان أرسل لي طلباً من قبل: نصبح أصدقاء مباشرة
      if (await hub(user.uid).hasRequestFrom(target.uid)) {
        await hub(user.uid).addFriend(target);
        await hub(target.uid).addFriend({ uid: user.uid, username: myName }, `أصبحت أنت و${myName} أصدقاء`);
        return json({ ok: true, friends: true });
      }
      await hub(target.uid).addRequest({ uid: user.uid, username: myName });
      return json({ ok: true });
    }

    if (pathname === '/friends/respond' && request.method === 'POST') {
      const b = await body();
      const from = String(b.uid ?? '');
      if (!(await hub(user.uid).hasRequestFrom(from))) return json({ error: 'no-request' }, 400);
      const state = await hub(user.uid).getState();
      const fromName = state.requests.find((r) => r.uid === from)!.username;
      if (b.accept === true) {
        const myName = await usernameOf(user.uid);
        await hub(user.uid).addFriend({ uid: from, username: fromName });
        await hub(from).addFriend({ uid: user.uid, username: myName }, `قبل ${myName} طلب صداقتك`);
      } else {
        await hub(user.uid).removeRequest(from);
      }
      return json({ ok: true });
    }

    if (pathname === '/friends/remove' && request.method === 'POST') {
      const other = String((await body()).uid ?? '');
      await hub(user.uid).removeFriend(other);
      await hub(other).removeFriend(user.uid);
      return json({ ok: true });
    }

    // دعوة صديق متصل للطاولة: عملة من المالك، والدعوة تصل للصديق فوراً
    const inviteFriendMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/inviteFriend$/);
    if (inviteFriendMatch && request.method === 'POST') {
      const b = await body();
      const friend = String(b.uid ?? '');
      if (!(await hub(user.uid).isFriend(friend))) return json({ error: 'not-friends' }, 400);
      if (!(await hub(friend).isOnline())) return json({ error: 'offline' }, 400);
      const tableId = inviteFriendMatch[1];
      // يمكن أن تحجز الدعوة مقعداً محدداً (من شاشة المقاعد)
      const seat = typeof b.seat === 'number' ? b.seat : undefined;
      const r = await env.TABLES.get(env.TABLES.idFromString(tableId)).createInvite(user.uid, seat);
      if ('error' in r) return json(r, r.error === 'not-enough-coins' ? 402 : 400);
      await hub(friend).pushInvite({ tableId, code: r.code, fromUid: user.uid, fromName: await usernameOf(user.uid), at: Date.now() });
      return json({ ok: true });
    }

    // قبول/رفض دعوة طاولة
    if (pathname === '/invites/respond' && request.method === 'POST') {
      const b = await body();
      const tableId = String(b.tableId ?? '');
      if (!/^[0-9a-f]{64}$/.test(tableId)) return json({ error: 'bad-request' }, 400);
      const invite = await hub(user.uid).takeInvite(tableId);
      if (!invite) return json({ error: 'no-invite' }, 400);
      if (b.accept !== true) return json({ ok: true });
      const username = await usernameOf(user.uid);
      if (!username) return json({ error: 'no-username' }, 400);
      const r = await env.TABLES.get(env.TABLES.idFromString(tableId)).joinTable({ uid: user.uid, username }, invite.code);
      return 'error' in r ? json(r, 400) : json({ ok: true, tableId });
    }

    return json({ error: 'not-found' }, 404);
}
