// إشعارات الجوال (Firebase Cloud Messaging) — نفس حساب الخدمة المستخدم لـ Firestore.
// تُستخدم لدعوات الأصدقاء: تصل حتى لو كان الصديق غير متصل، والضغط عليها يدخله الطاولة.
import { accessToken } from './firestore';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface PushMessage { title: string; body: string; data: Record<string, string> }

/** يرسل الإشعار لكل أجهزة المستخدم، ويرجع الرموز المنتهية (للحذف) */
export async function sendPush(projectId: string, serviceAccountJson: string, tokens: string[], msg: PushMessage): Promise<string[]> {
  if (!tokens.length || !serviceAccountJson) return [];
  const auth = await accessToken(serviceAccountJson, FCM_SCOPE);
  const dead: string[] = [];
  await Promise.all(tokens.map(async (token) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: msg.data,
          android: { priority: 'HIGH', notification: { channel_id: 'invites2', sound: 'notify' } },
          apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'notify.caf' } } },
        },
      }),
    }).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      const t = await res.text();
      // يظهر في سجل الخادم: لو الإشعارات ما توصل نعرف السبب (صلاحية، مفتاح Apple، رمز منتهي…)
      console.log('push error', res.status, t.slice(0, 300));
      if ((res.status === 404 || res.status === 400) && (t.includes('UNREGISTERED') || t.includes('INVALID_ARGUMENT'))) dead.push(token);
    }
  }));
  return dead;
}
