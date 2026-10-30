// يضبط إيميلات Firebase Auth بالعربي (تشغيل يدوي): اسم المرسل "مجلسك"، وعنوان عربي، واللغة الافتراضية عربية.
// يغيّر الواجهة فقط (المرسل والعنوان)؛ نص الرسالة تكتبه Firebase.
import { accessToken, parseServiceAccount } from '../worker/src/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const project = parseServiceAccount(sa).project_id;
const token = await accessToken(sa, 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase');
const url = `https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`;
const mask = [
  'notification.defaultLocale',
  'notification.sendEmail.verifyEmailTemplate.senderDisplayName',
  'notification.sendEmail.verifyEmailTemplate.subject',
  'notification.sendEmail.resetPasswordTemplate.senderDisplayName',
  'notification.sendEmail.resetPasswordTemplate.subject',
].join(',');
const body = {
  notification: {
    defaultLocale: 'ar',
    sendEmail: {
      verifyEmailTemplate: { senderDisplayName: 'مجلسك', subject: 'تحقق من بريدك في مجلسك' },
      resetPasswordTemplate: { senderDisplayName: 'مجلسك', subject: 'استعادة كلمة المرور في مجلسك' },
    },
  },
};
const res = await fetch(`${url}?updateMask=${encodeURIComponent(mask)}`, {
  method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const out = await res.json() as Record<string, any>;
if (!res.ok) { console.log('error', res.status, JSON.stringify(out).slice(0, 600)); process.exit(1); }
const t = out.notification?.sendEmail?.verifyEmailTemplate ?? {};
console.log('updated:', JSON.stringify({ locale: out.notification?.defaultLocale, name: t.senderDisplayName, subject: t.subject }));
