// تغيير اسم مستخدم من الإدارة: يدخل للخادم برمز Google لحساب الخدمة (ما يحتاج أي سر إضافي)
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
// RIG_ACES: أول توزيع جديد فيه هاللاعب يعطيه الأكات الأربع (مرة وحدة)؛ وإلا تغيير اسم
const rig = process.env.RIG_ACES;
const res = await fetch(`https://majlisk-api.majlisk.workers.dev/api/admin/${rig ? 'rig-aces' : 'rename'}`, {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(rig ? { username: rig } : { from: process.env.FROM, to: process.env.TO }),
});
console.log(`### ${rig ? 'الأكات الأربع' : 'تغيير الاسم'}: ${res.status} ${await res.text()}`);
if (!res.ok) process.exit(1);
