// الحسابات اللي يعتبرها السيرفر مشتركة الحين (قراءة فقط): Actions ← List pro ← Run workflow
import { Firestore, parseServiceAccount } from '../worker/src/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const db = new Firestore(parseServiceAccount(sa).project_id, sa);
const ids = await db.listIds('users');
const now = Date.now();
const day = (ms: unknown) => (typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '-');
for (let i = 0; i < ids.length; i += 25) {
  const docs = await Promise.all(ids.slice(i, i + 25).map(async (id) => [id, await db.get('users', id)] as const));
  for (const [id, d] of docs) {
    if (!d || !(typeof d.proUntil === 'number' && d.proUntil > now)) continue;
    const trial = await db.get('gifts', `protrial-${id}`).catch(() => null);
    console.log(`- ${d.username ?? '?'} · حتى ${day(d.proUntil)} · اشتراك ${day(d.proSubUntil)} · هدية ${day(d.proGiftUntil)} · تجربة ${trial ? 'نعم' : 'لا'} · وصول ${d.proAccess === true ? 'نعم' : 'لا'}`);
  }
}
