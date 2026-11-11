// قياس حي لانتقال الدور على السيرفر الفعلي: أربعة لاعبين وهميين (حسابات probe مؤقتة) يلعبون بلوت،
// ونقيس الوقت من إرسال الحركة لين توصل الحالة اللي بعدها — مع لعب سريع ومع توقف (تفكير) قبل بعض الحركات.
// بدون أي بيانات لاعبين حقيقيين. الطاولة خاصة وتنقفل بعد القياس، والحسابات المؤقتة تنحذف.
import { createPrivateKey, createSign } from 'node:crypto';
const API = 'https://majlisk-api.majlisk.workers.dev/api';
const WEB_KEY = 'AIzaSyC0w2ECqZgz8yWpid9vgKsnVuXGnRypL8A'; // مفتاح Firebase العام للتطبيق (ليس سراً)
function parseKey(raw) {
  let out = '', inStr = false, esc = false;
  for (const ch of raw.trim()) {
    if (inStr) { if (esc) { esc = false; out += ch; continue; } if (ch === '\\') { esc = true; out += ch; continue; } if (ch === '"') { inStr = false; out += ch; continue; } if (ch === '\n') { out += '\\n'; continue; } if (ch === '\r') continue; out += ch; }
    else { if (ch === '"') inStr = true; out += ch; }
  }
  return JSON.parse(out);
}
const sa = parseKey(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const b64u = (x) => Buffer.from(x).toString('base64url');
const pem = String(sa.private_key).replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
const key = createPrivateKey({ key: Buffer.from(pem, 'base64'), format: 'der', type: 'pkcs8' });
const sign = (claims) => { const now = Math.floor(Date.now() / 1000); const u = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iat: now, exp: now + 3000, ...claims }))}`; return `${u}.${createSign('RSA-SHA256').update(u).sign(key, 'base64url')}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const oauth = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sign({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token' })}` })).json()).access_token;
const FS = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const run = Date.now().toString(36);
const users = [0, 1, 2, 3].map((i) => ({ uid: `probe-${run}-${i}`, name: `probe${i}${run.slice(-3)}` }));

async function idToken(uid) {
  const custom = sign({ iss: sa.client_email, sub: sa.client_email, aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit', uid });
  for (const headers of [{}, { 'X-Android-Package': 'com.majlisk.app' }]) {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
    const j = await r.json();
    if (j.idToken) return j.idToken;
    console.log('sign-in failed:', r.status, JSON.stringify(j.error?.message ?? j).slice(0, 160));
  }
  throw new Error('no id token');
}
const cleanup = async () => { for (const u of users) { await fetch(`${FS}/users/${u.uid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${oauth}` } }).catch(() => {});
  await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:delete`, { method: 'POST', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ localId: u.uid }) }).catch(() => {}); } };

try {
  for (const u of users) {
    const r = await fetch(`${FS}/users/${u.uid}`, { method: 'PATCH', headers: { Authorization: `Bearer ${oauth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { username: { stringValue: u.name }, coins: { integerValue: '50' }, unlimited: { booleanValue: true } } }) });
    if (!r.ok) throw new Error(`firestore ${r.status} ${(await r.text()).slice(0, 120)}`);
    u.token = await idToken(u.uid);
  }
  const post = async (path, body, u) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` }, body: JSON.stringify(body ?? {}) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
  const created = await post('/tables', { isPrivate: false }, users[0]);
  const id = created.json.id; if (!id) throw new Error(`create ${created.status} ${JSON.stringify(created.json)}`);
  for (const u of users.slice(1)) { const j = await post(`/tables/${id}/join`, {}, u); if (j.status !== 200) throw new Error(`join ${j.status} ${JSON.stringify(j.json)}`); }
  await post(`/tables/${id}/join`, {}, users[0]).catch(() => {});

  const S = {}; const gaps = []; let last = null; let plays = 0; let pongs = [];
  const mode = { think: 0 };
  const act = (u, a, label) => { const g = S[u.uid].v.game; last = { t: Date.now(), label, trickNo: g.trickNo, tl: g.trick.length, think: mode.think }; S[u.uid].w.send(JSON.stringify({ type: 'action', action: a })); };
  async function onState(u, v) {
    S[u.uid].v = v; const g = v.game; if (!g) return; const A = g.actions;
    if (!(A.legal.length || A.bids.length || A.canPassDouble || A.chooseLock)) return;
    if (last) { gaps.push({ ms: Date.now() - last.t, after: last.label, trickNo: last.trickNo, tl: last.tl, think: last.think, declared: g.declared.length }); last = null; }
    // كل سابع حركة: توقف 13 ثانية (لاعب يفكر) — يكشف تأخير صحوة الطاولة من النوم
    plays++; mode.think = plays % 7 === 0 ? 13000 : 0;
    if (mode.think) await sleep(mode.think); else await sleep(150);
    if (A.legal.length) act(u, { type: 'play', card: A.legal[0] }, 'play');
    else if (A.chooseLock) act(u, { type: 'doubleLock', locked: false }, 'lock');
    else if (A.canPassDouble) act(u, { type: 'doublePass' }, 'dpass');
    else { const b = A.bids.find((x) => x.type === 'hokm') ?? A.bids.find((x) => x.type === 'confirmHokm') ?? A.bids.find((x) => x.type === 'secondHokm') ?? A.bids.find((x) => x.type === 'pass'); act(u, { type: 'bid', bid: b }, 'bid:' + b.type); }
  }
  for (const u of users) await new Promise((res, rej) => {
    const w = new WebSocket(`${API.replace('https', 'wss')}/tables/${id}/ws?token=${encodeURIComponent(u.token)}`);
    S[u.uid] = { w }; let pingAt = 0;
    w.onmessage = (e) => { if (e.data === 'pong') { pongs.push(Date.now() - pingAt); return; } const m = JSON.parse(e.data); if (m.type === 'state') onState(u, m.view); };
    w.onopen = () => { setInterval(() => { pingAt = Date.now(); try { w.send('ping'); } catch {} }, 3000); res(); };
    w.onerror = () => rej(new Error('ws error')); w.onclose = (e) => console.log('ws closed', u.name, e.code);
  });
  await sleep(500);
  // نخليها خاصة على طول عشان ما تظهر في قائمة الطاولات
  S[users[0].uid].w.send(JSON.stringify({ type: 'setPrivate', isPrivate: true }));
  await sleep(300);
  S[users[0].uid].w.send(JSON.stringify({ type: 'start' }));
  await sleep(Number(process.env.PROBE_SECONDS || 240) * 1000);
  for (const u of users) { try { S[u.uid].w.send(JSON.stringify({ type: 'leave' })); } catch {} }
  await sleep(1500);

  const stat = (a) => { a = [...a].sort((x, y) => x - y); return a.length ? `n=${a.length} min=${a[0]} median=${a[a.length >> 1]} p90=${a[Math.floor(a.length * 0.9)]} max=${a.at(-1)}` : 'n=0'; };
  console.log('### قياس انتقال الدور على السيرفر الفعلي (بالملّي ثانية)');
  console.log('- زمن الرد على النبضة (الشبكة بين المختبِر والخادم): ' + stat(pongs));
  const playGaps = gaps.filter((g) => g.after === 'play');
  // أول لفتين (trickNo 0 و1) فيها مهلة كشف المشروع المتعمّدة، وآخر ورقة في الصكة (trickNo 7, tl 3) فيها مهلة نهاية الصكة
  const clean = playGaps.filter((g) => g.trickNo >= 2 && !(g.trickNo === 7 && g.tl === 3));
  console.log('- ورقة وسط الصكة، لعب سريع (بدون أي مهلة متعمّدة): ' + stat(clean.filter((g) => !g.think).map((g) => g.ms)));
  console.log('- ورقة وسط الصكة، بعد توقف 13 ثانية (صحوة الطاولة): ' + stat(clean.filter((g) => g.think).map((g) => g.ms)));
  console.log('- أول لفتين (فيها مهلة المشروع): ' + stat(playGaps.filter((g) => g.trickNo < 2).map((g) => g.ms)));
  console.log('- الشراء «بس»: ' + stat(gaps.filter((g) => g.after === 'bid:pass').map((g) => g.ms)));
  console.log('- أبطأ الحالات وسط الصكة: ' + JSON.stringify(clean.filter((g) => g.ms > 400).slice(0, 12)));
} finally { await cleanup(); }
process.exit(0);
