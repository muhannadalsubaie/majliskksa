// منح عملات لمستخدمين بأسماء المستخدمين (يشغّله صاحب التطبيق من GitHub Actions: Grant coins).
// الاستخدام: FIREBASE_SERVICE_ACCOUNT=... npx tsx scripts/grant-coins.ts 500 "ياسر,خالد"
import { Firestore } from '../worker/src/firestore';
import { usernameKey } from '../shared/username';

const [amountRaw, namesRaw = ''] = process.argv.slice(2);
const amount = Number(amountRaw);
if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) throw new Error(`مبلغ غير صالح: ${amountRaw}`);
const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const projectId = (JSON.parse(sa) as { project_id: string }).project_id;
const db = new Firestore(projectId, sa);

const names = namesRaw.split(/[,،\n]/).map((n) => n.trim()).filter(Boolean);
let failed = 0;
for (const name of names) {
  const holder = await db.get('usernames', usernameKey(name));
  if (!holder?.uid) { console.log(`✗ ${name}: لا يوجد مستخدم بهذا الاسم`); failed++; continue; }
  try {
    const balance = await db.adjustCoins(String(holder.uid), amount);
    console.log(`✓ ${holder.username ?? name}: ${amount > 0 ? '+' : ''}${amount} — الرصيد الآن ${balance}`);
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message}`);
    failed++;
  }
}
if (failed) process.exit(1);
