// يمنح هدية EVERYONE_GIFT لكل حساب موجود الآن (مرة وحدة لكل حساب، نفس سجل الخادم فما تتكرر أبداً)
// ويطبع الأعداد فقط (بلا أي بيانات شخصية). يُشغَّل من GitHub Actions بسر FIREBASE_SERVICE_ACCOUNT.
import { Firestore, accessToken } from '../worker/src/firestore';
import { EVERYONE_GIFT } from '../shared/economy';

const PROJECT = 'majlisk-87eef';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT ?? '';
const db = new Firestore(PROJECT, sa);
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

async function allUsers(): Promise<string[]> {
  const out: string[] = [];
  let page = '';
  do {
    const res = await fetch(`${base}/users?pageSize=300&mask.fieldPaths=coins${page ? `&pageToken=${page}` : ''}`, {
      headers: { Authorization: `Bearer ${await accessToken(sa)}` },
    });
    if (!res.ok) throw new Error(`list ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { documents?: { name: string }[]; nextPageToken?: string };
    for (const d of j.documents ?? []) out.push(d.name.split('/').pop()!);
    page = j.nextPageToken ?? '';
  } while (page);
  return out;
}

async function main() {
const users = await allUsers();
let granted = 0, already = 0, failed = 0;
for (const uid of users) {
  try {
    if (await db.createIfMissing('gifts', `${EVERYONE_GIFT.id}-${uid}`, { uid, coins: EVERYONE_GIFT.coins, at: new Date() })) {
      await db.adjustCoins(uid, EVERYONE_GIFT.coins);
      granted++;
    } else already++;
  } catch (e) { failed++; console.log('failed:', String(e).slice(0, 120)); }
}
console.log(`### هدية ${EVERYONE_GIFT.coins} عملة: الحسابات ${users.length} — انضافت الحين ${granted} — كانت واصلة قبل ${already} — فشل ${failed}`);
}
main().catch((e) => { console.log('### فشل:', String(e).slice(0, 200)); process.exit(1); });
