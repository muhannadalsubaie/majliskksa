import { sendPush } from './push';
import { COINS, EVERYONE_GIFT, ONE_TIME_GIFTS, MAX_ADS_PER_DAY } from '../../shared/economy';
import { cleanUsername, usernameKey, validateUsername } from '../../shared/username';
import { type GameKind, type GameVariant, GAME_NAMES, VARIANTS } from '../../shared/games';
import { isUnlimited, verifyToken, verifyUser } from './auth';
import type { Env } from './env';
import { Firestore, deleteAuthUser, parseServiceAccount } from './firestore';
import { verifySsv } from './ads';
import type { VoiceRequest } from './voice-room';
import { type VerifiedPurchase, type VerifiedSub, accountTokenFor, consumeGoogle, verifyApple, verifyAppleSub, verifyGoogle, verifyGoogleSub } from './purchases';
import { PRO_GIFT_ID, extendGift, isPro, proUntilOf } from '../../shared/pro';

/** تغيير اسم المستخدم: مرة كل ستة أشهر (١٨٢ يوم) */
const RENAME_EVERY_MS = 182 * 24 * 3600 * 1000;

export { TableRoom } from './table-room';
export { UserHub } from './user-hub';
export { VoiceRoom } from './voice-room';
export { Presence } from './presence';


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

    // الصورة الشخصية لأي لاعب (عامة مثل اسمه): تظهر في الملف الشخصي والطاولة
    const avatarMatch = pathname.match(/^\/avatar\/([A-Za-z0-9_-]{1,128})$/);
    if (avatarMatch && request.method === 'GET') {
      const a = await env.HUBS.get(env.HUBS.idFromName(avatarMatch[1])).getAvatar();
      if (!a) return new Response(null, { status: 404, headers: { ...CORS, 'Cache-Control': 'public, max-age=60' } });
      return new Response(a.data, { headers: { ...CORS, 'Content-Type': a.type, 'Cache-Control': 'public, max-age=60', ETag: `"${a.at}"` } });
    }

    if (pathname === '/health') {
      // فحص اتصال الخادم بقاعدة البيانات (بدون كشف أي بيانات)
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT ?? '');
      let firestore = 'ok';
      try { await db.get('usernames', 'healthcheck'); } catch (e) { firestore = String((e as Error).message).slice(0, 300); }
      return json({ ok: true, firestore, hasServiceAccount: Boolean(env.FIREBASE_SERVICE_ACCOUNT) });
    }

    // فحص توفر اسم المستخدم (متاح قبل إنشاء الحساب، لذلك بدون تسجيل دخول)
    // تشخيص: التطبيق لقى نفسه مطلّع (بدون ما يضغط اللاعب «تسجيل الخروج») يرسل السبب لسجل التشخيص.
    // بدون أي بيانات شخصية: أول ٦ حروف من رقم الجوال، ونوع الخطأ بس
    if (pathname === '/diag/auth' && request.method === 'POST') {
      const b = (await request.json().catch(() => ({}))) as { device?: unknown; what?: unknown; detail?: unknown };
      const line = `دخول ضاع: جوال ${String(b.device ?? '').slice(0, 6)} ${String(b.what ?? '').slice(0, 40)} ${String(b.detail ?? '').replace(/\s+/g, ' ').slice(0, 120)}`;
      await env.HUBS.get(env.HUBS.idFromName('__slow__')).appendNote(`${new Date().toISOString()} ${line}`).catch(() => {});
      return json({ ok: true });
    }

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
    if (pathname === '/voice-status') {
      return json({ lastError: await env.HUBS.get(env.HUBS.idFromName('__voice__')).getNote() });
    }

    // آخر سبب رفض لتحقق شراء (بدون أي بيانات شخصية) — للتشخيص
    // تجربة التعادل: هل انطبقت، وآخر سبب لو ما انطبقت
    if (pathname === '/tables/tie-status') {
      return json({ used: await env.HUBS.get(env.HUBS.idFromName('__rig_tie__')).getNote(), last: await env.HUBS.get(env.HUBS.idFromName('__rig_tie_dbg__')).getNote() });
    }

    // تشخيص: آخر طلبات أخّرت حركات اللعب (بدون بيانات شخصية)
    if (pathname === '/tables/slow') {
      // الأحدث أول
      return json({ log: (await env.HUBS.get(env.HUBS.idFromName('__slow__')).getNote()).split('\n').filter(Boolean).reverse() });
    }

    if (pathname === '/purchases/status') {
      return json({ lastError: await env.HUBS.get(env.HUBS.idFromName('__purchase__')).getNote() });
    }

    if (pathname === '/ads/ssv-status') {
      return json({ lastRejection: await env.HUBS.get(env.HUBS.idFromName('__ssv__')).getNote() });
    }

    if (pathname === '/ads/ssv') {
      let reason = '';
      const reward = await verifySsv(url, undefined, (r) => { reason = r; }).catch((e) => { reason = `error:${(e as Error).message}`; return null; });
      if (!reward) {
        console.log('ssv rejected', reason, url.search.replace(/signature=[^&]*/, 'signature=…'));
        // آخر سبب رفض (بدون بيانات المستخدم) للتشخيص عبر /api/ads/ssv-status
        await env.HUBS.get(env.HUBS.idFromName('__ssv__')).setNote(`${new Date().toISOString()} ${reason}`);
        return json({ error: 'invalid', reason }, 400);
      }
      // طلب "التحقق من الرابط" في لوحة AdMob يأتي موقّعاً بلا معرّف مستخدم: نقبله دون مكافأة
      if (!reward.userId) return json({ ok: true, verdict: 'no-user' });
      const verdict = await env.HUBS.get(env.HUBS.idFromName(reward.userId)).claimAdReward(reward.transactionId, MAX_ADS_PER_DAY);
      if (verdict === 'ok') {
        try {
          await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).adjustCoins(reward.userId, COINS.watchAdReward);
        } catch {
          return json({ ok: true, verdict: 'no-profile' }); // مستخدم غير موجود (مثل اختبار اللوحة بمعرّف وهمي)
        }
      }
      return json({ ok: true, verdict }); // نرد 200 دائماً حتى لا تعيد Google المحاولة
    }

    // اتصال التطبيق بمركز اللاعب (الأصدقاء والحالة والدعوات)
    if (pathname === '/me/ws') {
      const me = await verifyToken(url.searchParams.get('token') ?? '', env.FIREBASE_PROJECT_ID, devAuth);
      if (!me) return json({ error: 'unauthenticated' }, 401);
      // المركز يعرف صاحبه (عشان يبلغ عدد المتصلين لما يدخل ويطلع)
      const inner = new Request(request);
      inner.headers.set('X-Uid', me.uid);
      // رقم الجوال (للتسجيل من جوال واحد بس)
      inner.headers.set('X-Device', (url.searchParams.get('device') ?? '').slice(0, 64));
      return env.HUBS.get(env.HUBS.idFromName(me.uid)).fetch(inner);
    }

    // المتصلون في التطبيق كله: عددهم يوصل على طول، وأسماؤهم عند الطلب
    if (pathname === '/presence/ws') {
      const me = await verifyToken(url.searchParams.get('token') ?? '', env.FIREBASE_PROJECT_ID, devAuth);
      if (!me) return json({ error: 'unauthenticated' }, 401);
      // الاسم من ملفه (ما نصدّق اسم يرسله التطبيق)
      let name = '';
      try { name = String((await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).get('users', me.uid))?.username ?? ''); } catch { /* بدون اسم: ينحسب بس ما يطلع في القائمة */ }
      const inner = new URL('https://presence/ws');
      inner.searchParams.set('uid', me.uid);
      inner.searchParams.set('name', name);
      return env.PRESENCE.get(env.PRESENCE.idFromName('global')).fetch(new Request(inner, request));
    }

    // ───── إدارة (من GitHub Actions فقط): الدخول برمز Google لحساب الخدمة نفسه ─────
    if (pathname === '/admin/rename' && request.method === 'POST') {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const info = token ? (await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)).json().catch(() => ({}))) as { email?: string } : {};
      const sa = (() => { try { return parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT ?? ''); } catch { return { client_email: '' }; } })();
      if (!info.email || info.email !== sa.client_email) return json({ error: 'forbidden' }, 403);
      const b = (await request.json().catch(() => ({}))) as { from?: string; to?: string };
      const from = String(b.from ?? ''), to = String(b.to ?? '');
      const invalid = validateUsername(to);
      if (invalid) return json({ error: invalid }, 400);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const oldKey = usernameKey(from), newKey = usernameKey(to);
      const entry = await db.get('usernames', oldKey);
      if (!entry?.uid) return json({ error: 'not-found' }, 404);
      const uid = String(entry.uid);
      const username = cleanUsername(to);
      if (newKey !== oldKey && !(await db.createIfMissing('usernames', newKey, { uid, username, createdAt: new Date() }))) {
        const holder = await db.get('usernames', newKey);
        if (holder?.uid !== uid) return json({ error: 'taken' }, 409);
      }
      await db.update('users', uid, { username });
      if (newKey !== oldKey) await db.remove('usernames', oldKey);
      else await db.update('usernames', newKey, { username });
      const hubOf = (id: string) => env.HUBS.get(env.HUBS.idFromName(id));
      const friends = await hubOf(uid).friendIds();
      for (const f of friends) await hubOf(f).renameFriend(uid, username);
      return json({ ok: true, friendsUpdated: friends.length });
    }

    // إدارة: أول توزيع جديد في طاولة فيها هاللاعب يعطيه الأكات الأربع (مرة وحدة بس، وبعدها التوزيع عشوائي كالعادة)
    if (pathname === '/admin/rig-aces' && request.method === 'POST') {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      const info = token ? (await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)).json().catch(() => ({}))) as { email?: string } : {};
      const sa = (() => { try { return parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT ?? ''); } catch { return { client_email: '' }; } })();
      if (!info.email || info.email !== sa.client_email) return json({ error: 'forbidden' }, 403);
      const b = (await request.json().catch(() => ({}))) as { username?: string };
      const key = usernameKey(String(b.username ?? ''));
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      if (!key || !(await db.get('usernames', key))?.uid) return json({ error: 'not-found' }, 404);
      await env.HUBS.get(env.HUBS.idFromName('__rig_aces__')).setNote(key);
      return json({ ok: true });
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
      const body = (await request.json().catch(() => ({}))) as { isPrivate?: unknown; kind?: unknown; variant?: unknown };
      const kind: GameKind = typeof body.kind === 'string' && Object.hasOwn(GAME_NAMES, body.kind) ? (body.kind as GameKind) : 'baloot';
      const username = await usernameOf(user.uid);
      if (!username) return json({ error: 'no-username' }, 400);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      if (!devAuth) {
        try { await db.adjustCoins(user.uid, -COINS.createTable); } catch (e) { return json({ error: (e as Error).message }, 402); }
      }
      const id = env.TABLES.newUniqueId();
      try {
        await env.TABLES.get(id).create(id.toString(), { uid: user.uid, username }, body.isPrivate === true,
          kind, VARIANTS[kind].includes(body.variant as GameVariant) ? (body.variant as GameVariant) : 'classic');
      } catch (e) {
        if (!devAuth) await db.adjustCoins(user.uid, COINS.createTable).catch(() => {}); // استرجاع عند الفشل
        throw e;
      }
      await hub(user.uid).setTable(id.toString());
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
      if (!('error' in r)) await hub(user.uid).setTable(joinMatch[1]);
      return 'error' in r ? json(r, r.error === 'not-enough-coins' ? 402 : 400) : json(r);
    }

    // طلب انضمام لطاولة خاصة (من قائمة الأصدقاء)، وحالته (ينتظر/وافق/تجاهل)
    const reqMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/join-request(\/status)?$/);
    if (reqMatch && request.method === 'POST') {
      const room = env.TABLES.get(env.TABLES.idFromString(reqMatch[1]));
      if (reqMatch[2]) return json(await room.joinRequestStatus(user.uid));
      const username = await usernameOf(user.uid);
      if (!username) return json({ error: 'no-username' }, 400);
      const r = await room.requestJoin({ uid: user.uid, username });
      return 'error' in r ? json(r, 400) : json(r);
    }

    // ينشئ ملف اللاعب مع الرصيد الترحيبي مرة واحدة فقط (آمن ضد التكرار)
    if (pathname === '/profile/ensure' && request.method === 'POST') {
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const created = await db.createIfMissing('users', user.uid, {
        username: '',
        coins: COINS.signupBonus,
        createdAt: new Date(),
      });
      // حساب جديد: رصيده الترحيبي فيه الهدية، فنسجّلها له حتى ما ياخذها مرة ثانية
      const everyoneGift = `${EVERYONE_GIFT.id}-${user.uid}`;
      if (created) await db.createIfMissing('gifts', everyoneGift, { uid: user.uid, coins: 0, at: new Date() });
      // علامة حساب المطوّر تُكتب من الخادم فقط
      if (await isUnlimited(user, env.UNLIMITED_EMAIL_SHA256)) await db.update('users', user.uid, { unlimited: true });
      // هدايا لمرة واحدة: سجل الهدية يُنشأ مرة واحدة فقط (ذرّياً) قبل إضافة العملات، فلا تتكرر
      let gift = 0;
      if (!created) {
        // هدية ترحيبية لكل الحسابات الموجودة (مرة وحدة لكل حساب، السجل يُنشأ ذرّياً قبل إضافة العملات)
        if (await db.createIfMissing('gifts', everyoneGift, { uid: user.uid, coins: EVERYONE_GIFT.coins, at: new Date() })) {
          await db.adjustCoins(user.uid, EVERYONE_GIFT.coins);
          gift += EVERYONE_GIFT.coins;
        }
        const profile = await db.get('users', user.uid);
        const key = usernameKey(String(profile?.username ?? ''));
        for (const g of ONE_TIME_GIFTS) {
          if (!key || usernameKey(g.username) !== key) continue;
          const holder = await db.get('usernames', key);
          if (holder?.uid !== user.uid) continue;
          if (await db.createIfMissing('gifts', g.id, { uid: user.uid, coins: g.coins, at: new Date() })) {
            await db.adjustCoins(user.uid, g.coins);
            gift += g.coins;
          }
        }
      }
      return json({ created, gift });
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

      if (await db.createIfMissing('users', user.uid, { username: '', coins: COINS.signupBonus, createdAt: new Date() })) {
        // حساب جديد: الهدية الترحيبية داخلة في رصيده
        await db.createIfMissing('gifts', `${EVERYONE_GIFT.id}-${user.uid}`, { uid: user.uid, coins: 0, at: new Date() });
      }
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

    // تغيير اسم المستخدم: مرة كل ٦ أشهر، والاسم القديم يصير متاح لغيرك.
    // { check: true } يرجع متى يقدر يغيّر بدون ما يغيّر شي
    if (pathname === '/profile/rename' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { username?: unknown; check?: unknown };
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const profile = await db.get('users', user.uid);
      const current = String(profile?.username ?? '');
      if (!current) return json({ error: 'no-username' }, 400);
      // آخر تغيير بالمللي ثانية (رقم، لأن قارئ Firestore عندنا يقرأ الأرقام والنصوص بس)
      const last = Number(profile?.usernameChangedMs ?? 0);
      const nextAt = last ? last + RENAME_EVERY_MS : 0;
      if (body.check === true) return json({ ok: true, nextAt: nextAt > Date.now() ? nextAt : 0 });
      if (nextAt > Date.now()) return json({ error: 'too-soon', nextAt }, 429);
      const raw = typeof body.username === 'string' ? body.username : '';
      const invalid = validateUsername(raw);
      if (invalid) return json({ error: invalid }, 400);
      const username = cleanUsername(raw);
      if (username === current) return json({ error: 'same' }, 400);
      const oldKey = usernameKey(current), newKey = usernameKey(raw);
      if (newKey !== oldKey && !(await db.createIfMissing('usernames', newKey, { uid: user.uid, username, createdAt: new Date() }))) {
        const holder = await db.get('usernames', newKey);
        if (holder?.uid !== user.uid) return json({ error: 'taken' }, 409);
      }
      const now = Date.now();
      await db.update('users', user.uid, { username, usernameChangedMs: now });
      // الاسم القديم يتحرر (إلا لو هو نفس الاسم بتشكيل أو حالة حروف مختلفة)
      if (newKey !== oldKey) {
        const old = await db.get('usernames', oldKey);
        if (old?.uid === user.uid) await db.remove('usernames', oldKey);
      } else await db.update('usernames', newKey, { username });
      const friends = await hub(user.uid).friendIds();
      for (const f of friends) await hub(f).renameFriend(user.uid, username);
      return json({ ok: true, username, nextAt: now + RENAME_EVERY_MS });
    }

    // رفع صورتك الشخصية (أو حذفها): صورة JPEG أو PNG صغيرة (التطبيق يقصّها مربعة ويصغّرها)
    if (pathname === '/profile/avatar' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { image?: unknown; remove?: unknown };
      if (body.remove === true) { await hub(user.uid).setAvatar(null); return json({ ok: true }); }
      if (typeof body.image !== 'string' || body.image.length > 200_000) return json({ error: 'bad-image' }, 400);
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(body.image), (c) => c.charCodeAt(0)); } catch { return json({ error: 'bad-image' }, 400); }
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (!jpeg && !png) return json({ error: 'bad-image' }, 400);
      const at = await hub(user.uid).setAvatar(bytes.buffer as ArrayBuffer, png ? 'image/png' : 'image/jpeg');
      return json({ ok: true, at });
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
      // الصديق المتصل وفي طاولة: نرسل الطاولة (يدخلها صاحبه بالضغط المطوّل على اسمه)
      const friends = await Promise.all(state.friends.map(async (f) => {
        const online = await hub(f.uid).isOnline();
        const tableId = online ? await hub(f.uid).currentTable() : null;
        const t = tableId ? await env.TABLES.get(env.TABLES.idFromString(tableId)).friendTable(f.uid).catch(() => null) : null;
        return { ...f, online, ...(t ? { tableId, tablePrivate: t.isPrivate, tableKind: t.kind, tableVariant: t.variant } : {}) };
      }));
      return json({ ...state, friends });
    }

    // قائمة المتصلين في التطبيق: كل لاعب وطاولته (اللعبة، وعامة أو خاصة) — مثل قائمة الأصدقاء
    if (pathname === '/online/list' && request.method === 'POST') {
      const all = await env.PRESENCE.get(env.PRESENCE.idFromName('global')).players();
      // نجيب طاولات أول ٣٠٠ بس (الباقي يطلع بدون طاولة) عشان ما يثقل الطلب
      const players = await Promise.all(all.map(async (p, i) => {
        const base = { ...p, me: p.uid === user.uid };
        if (i >= 300) return base;
        const tableId = await hub(p.uid).currentTable().catch(() => null);
        const t = tableId ? await env.TABLES.get(env.TABLES.idFromString(tableId)).friendTable(p.uid).catch(() => null) : null;
        return t ? { ...base, tableId, tablePrivate: t.isPrivate, tableKind: t.kind, tableVariant: t.variant } : base;
      }));
      players.sort((a, b) => Number(b.me) - Number(a.me) || a.username.localeCompare(b.username, 'ar'));
      return json({ count: all.length, players });
    }

    // المحظورون: من حظرهم اللاعب من طاولاته، ورفع الحظر
    if (pathname === '/bans/list' && request.method === 'POST') {
      return json({ bans: await hub(user.uid).bans() });
    }
    if (pathname === '/bans/remove' && request.method === 'POST') {
      const target = String((await body()).uid ?? '');
      if (!target) return json({ error: 'bad-request' }, 400);
      await hub(user.uid).unban(target);
      return json({ ok: true });
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
      // الدعوة تصل داخل التطبيق، ومعها إشعار على جواله دائماً (حتى لو يبان متصل: يمكن التطبيق في الخلفية
      // أو انقفل للتو). والتطبيق المفتوح ما يعرض الإشعار، فما تتكرر الدعوة
      const online = await hub(friend).isOnline();
      const tokens = await hub(friend).pushTokens();
      if (!online && !tokens.length) return json({ error: 'offline' }, 400);
      const tableId = inviteFriendMatch[1];
      // يمكن أن تحجز الدعوة مقعداً محدداً (من شاشة المقاعد)
      const seat = typeof b.seat === 'number' ? b.seat : undefined;
      const toName = await usernameOf(friend).catch(() => '');
      const r = await env.TABLES.get(env.TABLES.idFromString(tableId)).createInvite(user.uid, seat, toName || undefined);
      if ('error' in r) return json(r, r.error === 'not-enough-coins' ? 402 : 400);
      const fromName = await usernameOf(user.uid);
      await hub(friend).pushInvite({ tableId, code: r.code, fromUid: user.uid, fromName, at: Date.now() });
      // للتشخيص (بلا أي بيانات شخصية): هل لجواله رمز إشعارات؟
      console.log('invite push', JSON.stringify({ online, tokens: tokens.length }));
      if (tokens.length) {
        const game = (await env.TABLES.get(env.TABLES.idFromString(tableId)).gameName().catch(() => '')) || 'بلوت';
        const dead = await sendPush(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT ?? '', tokens, {
          title: 'دعوة للعب', body: `${fromName ?? 'صديقك'} دعاك للعب ${game}`, data: { type: 'invite', tableId },
        }).catch((e) => { console.log('push failed', String(e)); return []; });
        await hub(friend).removePushTokens(dead);
      }
      return json({ ok: true });
    }

    // هل ما زلت عضواً في الطاولة؟ (يستخدمه التطبيق ليفرّق بين انقطاع الشبكة وإغلاق الطاولة)
    const memberMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/member$/);
    if (memberMatch) {
      return json({ member: await env.TABLES.get(env.TABLES.idFromString(memberMatch[1])).isMember(user.uid) });
    }

    // المحادثة الصوتية: تمرير طلبات WebRTC إلى Cloudflare Realtime عبر غرفة الطاولة
    const voiceMatch = pathname.match(/^\/tables\/([0-9a-f]{64})\/voice$/);
    if (voiceMatch && request.method === 'POST') {
      const b = (await body()) as unknown as VoiceRequest;
      try {
        const t0 = Date.now();
        // غرفة الصوت مستقلة عن غرفة اللعب: الطاولة تأكد العضوية بس (قراءة)، والباقي كله في غرفة الصوت
        const info = await env.TABLES.get(env.TABLES.idFromString(voiceMatch[1])).voiceInfo(user.uid);
        const out = await env.VOICES.get(env.VOICES.idFromName(voiceMatch[1])).voice(voiceMatch[1], user.uid, b, info);
        // للتشخيص (بلا بيانات مستخدم): نوع الطلب، وهل جاء بعرض من التطبيق، والمدة
        console.log('voice ok', b.op, b.offer ? 'offer' : '-', `${Date.now() - t0}ms`);
        return json(out);
      } catch (e) {
        const code = (e as Error).message;
        console.error('voice', code);
        // آخر خطأ صوتي (بلا بيانات مستخدم) للتشخيص عبر /api/voice-status
        if (code.startsWith('realtime:')) {
          await env.HUBS.get(env.HUBS.idFromName('__voice__')).setNote(`${new Date().toISOString()} ${b.op} ${code}`).catch(() => {});
        }
        return json({ error: code.startsWith('realtime:') ? 'voice-failed' : code }, 400);
      }
    }

    // ───── شراء العملات من داخل التطبيق ─────
    // معرّف ثابت يُرفق بالشراء ليرتبط بحساب صاحبه (لا يكشف هويته)
    if (pathname === '/purchases/account-token') {
      return json({ token: await accountTokenFor(user.uid) });
    }

    // التحقق من الشراء مع Google/Apple ثم إضافة العملات مرة واحدة فقط
    if (pathname === '/purchases/verify' && request.method === 'POST') {
      const b = await body();
      const platform = String(b.platform ?? '');
      let v: VerifiedPurchase;
      try {
        if (platform === 'android') v = await verifyGoogle(env, String(b.productId ?? ''), String(b.purchaseToken ?? ''));
        else if (platform === 'ios') v = await verifyApple(env, String(b.transactionId ?? ''));
        else return json({ error: 'bad-request' }, 400);
      } catch (e) {
        console.error('purchase verify', (e as Error).message);
        await env.HUBS.get(env.HUBS.idFromName('__purchase__')).setNote(`${new Date().toISOString()} ${platform} ${(e as Error).message}`).catch(() => {});
        return json({ error: 'not-verified' }, 400);
      }
      // هدية الباقة الاحترافية لها مسارها (/gift/verify): هنا العملات بس، فما نستهلكها بالغلط
      if (v.coins <= 0) return json({ error: 'not-coins' }, 400);
      if (v.accountToken && v.accountToken !== (await accountTokenFor(user.uid))) return json({ error: 'other-account' }, 403);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const fresh = await db.createIfMissing('purchases', v.id, { uid: user.uid, productId: v.productId, coins: v.coins, at: new Date() });
      if (fresh) {
        try {
          await db.adjustCoins(user.uid, v.coins);
        } catch (e) {
          await db.remove('purchases', v.id).catch(() => {}); // نسمح بإعادة المحاولة
          throw e;
        }
      }
      if (platform === 'android') await consumeGoogle(env, v.productId, String(b.purchaseToken)).catch((e) => console.error('consume', e));
      return json({ ok: true, coins: v.coins, duplicate: !fresh });
    }

    // ───── الباقة الاحترافية ─────
    // حالة الباقة: متى تنتهي (0 = مو مشترك)
    if (pathname === '/pro/status') {
      const profile = devAuth ? null : await new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT).get('users', user.uid);
      const proUntil = Number(profile?.proUntil ?? 0);
      return json({ pro: isPro(proUntil), proUntil });
    }

    // التحقق من الاشتراك الشهري مع Google/Apple وحفظ تاريخ نهايته. التطبيق يناديه بعد الشراء،
    // وكل ما انفتح (عشان التجديد التلقائي والإلغاء)، ومن «استعادة المشتريات»
    if (pathname === '/pro/verify' && request.method === 'POST') {
      const b = await body();
      const platform = String(b.platform ?? '');
      let v: VerifiedSub;
      try {
        if (platform === 'android') v = await verifyGoogleSub(env, String(b.purchaseToken ?? ''));
        else if (platform === 'ios') v = await verifyAppleSub(env, String(b.transactionId ?? ''));
        else return json({ error: 'bad-request' }, 400);
      } catch (e) {
        console.error('sub verify', (e as Error).message);
        await env.HUBS.get(env.HUBS.idFromName('__purchase__')).setNote(`${new Date().toISOString()} sub ${platform} ${(e as Error).message}`).catch(() => {});
        return json({ error: 'not-verified' }, 400);
      }
      if (v.accountToken && v.accountToken !== (await accountTokenFor(user.uid))) return json({ error: 'other-account' }, 403);
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      // الاشتراك الواحد لحساب واحد: أول حساب يسجله يبقى صاحبه
      await db.createIfMissing('subscriptions', v.id, { uid: user.uid, platform, at: new Date() });
      const owner = await db.get('subscriptions', v.id);
      if (owner?.uid !== user.uid) return json({ error: 'other-account' }, 403);
      const profile = await db.get('users', user.uid);
      const proUntil = proUntilOf(v.until, profile?.proGiftUntil);
      await db.update('users', user.uid, { proSubUntil: v.until, proUntil });
      return json({ ok: true, pro: isPro(proUntil), proUntil });
    }

    // الإهداء: نتأكد من اسم المستخدم قبل الدفع (يرجع الاسم كما هو مسجل)
    if (pathname === '/gift/lookup' && request.method === 'POST') {
      const b = await body();
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const entry = await db.get('usernames', usernameKey(String(b.username ?? '')));
      const uid = String(entry?.uid ?? '');
      if (!uid) return json({ found: false });
      return json({ found: true, uid, username: await usernameOf(uid), self: uid === user.uid });
    }

    // إهداء الباقة: شراء لمرة وحدة يدفعه لاعب، ويضيف شهر للاعب اللي كتب اسمه (ما يتجدد تلقائياً)
    if (pathname === '/gift/verify' && request.method === 'POST') {
      const b = await body();
      const platform = String(b.platform ?? '');
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      // المستلم أولاً: لو الاسم غلط ما نستهلك الشراء، فيقدر يعيد بالاسم الصحيح
      const to = String((await db.get('usernames', usernameKey(String(b.username ?? ''))))?.uid ?? '');
      if (!to) return json({ error: 'no-such-user' }, 404);
      let v: VerifiedPurchase;
      try {
        if (platform === 'android') v = await verifyGoogle(env, PRO_GIFT_ID, String(b.purchaseToken ?? ''));
        else if (platform === 'ios') v = await verifyApple(env, String(b.transactionId ?? ''));
        else return json({ error: 'bad-request' }, 400);
        if (v.productId !== PRO_GIFT_ID) throw new Error('not-a-gift');
      } catch (e) {
        console.error('gift verify', (e as Error).message);
        await env.HUBS.get(env.HUBS.idFromName('__purchase__')).setNote(`${new Date().toISOString()} gift ${platform} ${(e as Error).message}`).catch(() => {});
        return json({ error: 'not-verified' }, 400);
      }
      if (v.accountToken && v.accountToken !== (await accountTokenFor(user.uid))) return json({ error: 'other-account' }, 403);
      // سجل الشراء يُنشأ مرة وحدة (ذرّياً) قبل إضافة الشهر، فما تتكرر الهدية
      const fresh = await db.createIfMissing('purchases', v.id, { uid: user.uid, productId: v.productId, giftTo: to, coins: 0, at: new Date() });
      let proUntil = 0;
      if (fresh) {
        try {
          const profile = await db.get('users', to);
          if (!profile) throw new Error('no-profile');
          const proGiftUntil = extendGift(profile.proGiftUntil);
          proUntil = proUntilOf(profile.proSubUntil, proGiftUntil);
          await db.update('users', to, { proGiftUntil, proUntil });
        } catch (e) {
          await db.remove('purchases', v.id).catch(() => {}); // نسمح بإعادة المحاولة
          throw e;
        }
        // المستلم يعرف: تنبيه داخل التطبيق، وإشعار على جواله
        const fromName = await usernameOf(user.uid).catch(() => '');
        const text = `${fromName || 'لاعب'} أهداك الباقة الاحترافية لمدة شهر`;
        await hub(to).notify(text).catch(() => {});
        const tokens = await hub(to).pushTokens().catch(() => [] as string[]);
        if (tokens.length) {
          const dead = await sendPush(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT ?? '', tokens, { title: 'هدية', body: text, data: { type: 'gift' } }).catch(() => [] as string[]);
          await hub(to).removePushTokens(dead).catch(() => {});
        }
      }
      if (platform === 'android') await consumeGoogle(env, v.productId, String(b.purchaseToken)).catch((e) => console.error('consume', e));
      return json({ ok: true, duplicate: !fresh, proUntil });
    }

    // حذف الحساب نهائياً (مطلب Google Play وApp Store): الملف، اسم المستخدم، الأصدقاء، وحساب الدخول
    if (pathname === '/me/delete' && request.method === 'POST') {
      if (devAuth) return json({ ok: true });
      const db = new Firestore(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT);
      const profile = await db.get('users', user.uid);
      const username = String(profile?.username ?? '');
      if (username) {
        const key = usernameKey(username);
        const entry = await db.get('usernames', key);
        if (entry?.uid === user.uid) await db.remove('usernames', key);
      }
      const friends = await hub(user.uid).wipe();
      await Promise.all(friends.map((f) => hub(f).removeFriend(user.uid).catch(() => {})));
      await db.remove('users', user.uid);
      try {
        await deleteAuthUser(env.FIREBASE_PROJECT_ID, env.FIREBASE_SERVICE_ACCOUNT, user.uid);
      } catch (e) {
        console.error('delete auth user', e);
        return json({ error: 'auth-delete-failed' }, 500);
      }
      return json({ ok: true });
    }

    // قبول/رفض دعوة طاولة
    // رمز إشعارات هذا الجهاز (بعد ما يسمح المستخدم بالإشعارات)
    // سجّل دخول من هالجوال: يصير جوال الحساب، والجوالات الثانية يتسجل خروجها
    if (pathname === '/profile/claim-device' && request.method === 'POST') {
      const device = String((await body()).device ?? '').slice(0, 64);
      if (!device) return json({ error: 'bad-request' }, 400);
      await hub(user.uid).claimDevice(device);
      return json({ ok: true });
    }

    // التطبيق وصله «انسجل خروجك»: يتأكد إن جواله فعلاً مو جوال الحساب قبل ما يطلع
    if (pathname === '/profile/device-status' && request.method === 'POST') {
      const device = String((await body()).device ?? '').slice(0, 64);
      return json({ current: await hub(user.uid).isCurrentDevice(device) });
    }

    if (pathname === '/profile/push-token' && request.method === 'POST') {
      console.log('push token registered');
      const b = await body();
      const token = String(b.token ?? '');
      if (token.length < 20 || token.length > 4096) return json({ error: 'bad-request' }, 400);
      await hub(user.uid).addPushToken(token);
      return json({ ok: true });
    }

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
      if (!('error' in r)) await hub(user.uid).setTable(tableId);
      return 'error' in r ? json(r, 400) : json({ ok: true, tableId });
    }

    return json({ error: 'not-found' }, 404);
}
