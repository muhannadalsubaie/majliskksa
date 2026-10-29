// قائمة الطاولات المنشورة (للتشخيص، قراءة فقط): Actions ← List tables ← Run workflow
import { Firestore, parseServiceAccount } from '../worker/src/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const db = new Firestore(parseServiceAccount(sa).project_id, sa);
const ids = await db.listIds('tables');
console.log(`عدد الطاولات: ${ids.length}`);
for (const id of ids) {
  const t = await db.get('tables', id);
  console.log(`- ${id.slice(0, 8)} · طاولة ${t?.ownerName ?? '?'} · ${t?.kind ?? 'baloot'} · لاعبون ${t?.players ?? '?'} · حاضرون ${t?.people ?? '?'} · ${t?.status ?? '?'}`);
}
