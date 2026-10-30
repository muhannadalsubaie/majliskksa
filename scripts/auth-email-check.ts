// فحص إعداد إيميلات Firebase Auth (قراءة فقط): هل إرسال إيميل التحقق مفعّل، ومن المرسل، والنطاقات المسموحة
import { accessToken, parseServiceAccount } from '../worker/src/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const project = parseServiceAccount(sa).project_id;
const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase');
const res = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, { headers: { Authorization: `Bearer ${token}` } });
const cfg = await res.json() as Record<string, any>;
if (!res.ok) { console.log('error', res.status, JSON.stringify(cfg).slice(0, 500)); process.exit(1); }
const send = cfg.notification?.sendEmail ?? {};
console.log('email sign-in:', JSON.stringify(cfg.signIn?.email ?? null));
console.log('send method:', send.method ?? '(default)');
console.log('callbackUri:', send.callbackUri ?? '(none)');
console.log('verify template:', JSON.stringify({ sender: send.verifyEmailTemplate?.senderLocalPart, name: send.verifyEmailTemplate?.senderDisplayName, subject: send.verifyEmailTemplate?.subject, custom: send.verifyEmailTemplate?.customized }));
console.log('smtp:', send.smtp ? JSON.stringify({ host: send.smtp.host, port: send.smtp.port, sender: send.smtp.senderEmail }) : '(none)');
console.log('default locale:', cfg.notification?.defaultLocale ?? '(none)');
console.log('authorized domains:', (cfg.authorizedDomains ?? []).join(', '));
console.log('quota:', JSON.stringify(cfg.quota ?? null));
