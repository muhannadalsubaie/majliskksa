// عدد الحسابات المسجلة (قراءة فقط): Actions ← Count users ← Run workflow
import { Firestore, parseServiceAccount } from '../worker/src/firestore';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const db = new Firestore(parseServiceAccount(sa).project_id, sa);
const ids = await db.listIds('users');
let named = 0;
for (let i = 0; i < ids.length; i += 25) {
  const docs = await Promise.all(ids.slice(i, i + 25).map((id) => db.get('users', id)));
  named += docs.filter((d) => typeof d?.username === 'string' && d.username).length;
}
console.log(`عدد الحسابات: ${ids.length}`);
console.log(`منها باسم مستخدم: ${named}`);
