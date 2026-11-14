// سجل اللعب الشامل من الإدارة: يدخل للخادم برمز Google لحساب الخدمة (ما يحتاج أي سر إضافي)
import { createPrivateKey, createSign } from 'node:crypto';
// المفتاح أحياناً منسوخ بأسطر حقيقية داخل النص: نصلحها قبل القراءة
function parseKey(raw) {
  let out = '', inStr = false, esc = false;
  for (const ch of raw.trim()) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  return JSON.parse(out);
}
const sa = parseKey(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const b64u = (x) => Buffer.from(x).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }))}`;
// المفتاح الخاص: نأخذ الجزء المشفّر بس (مهما كانت الأسطر أو المسافات حوله) ونبنيه من جديد
const body = String(sa.private_key).replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
const key = createPrivateKey({ key: Buffer.from(body, 'base64'), format: 'der', type: 'pkcs8' });
const sig = createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url');
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}` })).json()).access_token;
// سجل اللعب الشامل: LIMIT = عدد الأسطر، Q = نص للبحث (رمز الطاولة t=xxxx، «تعليق»، «رفض»، أو وقت 2026-11-14T11:2)
const res = await fetch('https://majlisk-api.majlisk.workers.dev/api/admin/gamelog', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ limit: Number(process.env.LIMIT || 500), q: process.env.Q || '' }),
});
const out = await res.json();
if (!res.ok) { console.log(JSON.stringify(out)); process.exit(1); }
console.log(`عدد الأسطر: ${out.lines.length}`);
for (const l of out.lines) console.log(l);
