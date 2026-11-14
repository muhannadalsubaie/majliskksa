// تفعيل شهر تجربة الباقة الاحترافية لمستخدمين بأسمائهم (مرة وحدة لكل حساب، نفس تجربة المجرّبين):
// Actions ← Grant pro trial ← Run workflow
import { Firestore, parseServiceAccount } from '../worker/src/firestore';
import { usernameKey } from '../shared/username';
import { extendGift, proUntilOf } from '../shared/pro';

const names = (process.argv[2] ?? '').split(/[,،\n]/).map((n) => n.trim()).filter(Boolean);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const db = new Firestore(parseServiceAccount(sa).project_id, sa);
let failed = 0;
for (const name of names) {
  const holder = await db.get('usernames', usernameKey(name));
  const uid = holder?.uid ? String(holder.uid) : '';
  if (!uid) { console.log(`✗ ${name}: لا يوجد مستخدم بهذا الاسم`); failed++; continue; }
  await db.update('users', uid, { proAccess: true });
  if (await db.createIfMissing('gifts', `protrial-${uid}`, { uid, coins: 0, at: new Date() })) {
    const p = await db.get('users', uid);
    const proGiftUntil = extendGift(p?.proGiftUntil);
    await db.update('users', uid, { proGiftUntil, proUntil: proUntilOf(p?.proSubUntil, proGiftUntil) });
    console.log(`✓ ${holder!.username ?? name}: تفعّل شهر التجربة لين ${new Date(proGiftUntil).toISOString().slice(0, 10)}`);
  } else {
    console.log(`• ${holder!.username ?? name}: أخذ شهر التجربة من قبل`);
  }
}
if (failed) process.exit(1);
