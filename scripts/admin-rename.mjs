// تغيير اسم مستخدم من الإدارة: يدخل للخادم برمز Google لحساب الخدمة (ما يحتاج أي سر إضافي)
import { createSign } from 'node:crypto';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
const b64u = (x) => Buffer.from(x).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 }))}`;
const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
const tok = (await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${sig}` })).json()).access_token;
const res = await fetch('https://majlisk-api.majlisk.workers.dev/api/admin/rename', {
  method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: process.env.FROM, to: process.env.TO }),
});
console.log(`### تغيير الاسم: ${res.status} ${await res.text()}`);
if (!res.ok) process.exit(1);
