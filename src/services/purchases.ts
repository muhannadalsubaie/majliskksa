// شراء العملات من داخل التطبيق (Google Play / App Store) عبر @capgo/native-purchases.
// التطبيق لا يضيف أي عملة بنفسه: يرسل إثبات الشراء للخادم، والخادم يتحقق من المتجر مباشرة
// ثم يضيف العملات مرة واحدة فقط. أي شراء لم يكتمل تسليمه (انقطاع، إغلاق التطبيق) يُستكمل
// تلقائياً عند الفتح التالي.
import { Capacitor } from '@capacitor/core';
import { COIN_PACKS, type CoinPackId } from '../../shared/economy';
import { announce } from './announcer';
import { API_URL } from './api';
import { getToken } from './tables';

export const purchasesAvailable = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NativePurchases');

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `http-${res.status}`);
  return data as T;
}

const plugin = async () => (await import('@capgo/native-purchases'));

export interface StorePack { id: CoinPackId; coins: number; bonus: number; price: string }

/** الباقات بأسعارها الحقيقية من المتجر (بعملة المستخدم)، أو السعر المقترح إن تعذّر الجلب */
export async function loadPacks(): Promise<StorePack[]> {
  const fallback = COIN_PACKS.map((p) => ({ id: p.id, coins: p.coins, bonus: p.bonus, price: p.suggestedPrice }));
  if (!purchasesAvailable()) return fallback;
  try {
    const { NativePurchases, PURCHASE_TYPE } = await plugin();
    const { products } = await NativePurchases.getProducts({
      productIdentifiers: COIN_PACKS.map((p) => p.id), productType: PURCHASE_TYPE.INAPP,
    });
    return fallback.map((p) => ({ ...p, price: products.find((x) => x.identifier === p.id)?.priceString ?? p.price }));
  } catch {
    return fallback;
  }
}

/** يسلّم الشراء للخادم، ثم ينهيه في المتجر (الآيفون). يرجع عدد العملات المضافة. */
async function deliver(t: { productIdentifier: string; purchaseToken?: string; transactionId: string }): Promise<number> {
  const ios = Capacitor.getPlatform() === 'ios';
  const r = await post<{ coins: number; duplicate: boolean }>('/purchases/verify', {
    platform: ios ? 'ios' : 'android',
    productId: t.productIdentifier,
    purchaseToken: t.purchaseToken,
    transactionId: t.transactionId,
  });
  if (ios) {
    const { NativePurchases } = await plugin();
    await NativePurchases.finishTransaction({ transactionId: t.transactionId }).catch(() => {});
  }
  return r.duplicate ? 0 : r.coins;
}

export async function buyPack(id: CoinPackId): Promise<void> {
  if (!purchasesAvailable()) { announce('شراء العملات متاح في تطبيق الجوال فقط'); return; }
  const pack = COIN_PACKS.find((p) => p.id === id)!;
  try {
    const { NativePurchases, PURCHASE_TYPE } = await plugin();
    const { token } = await post<{ token: string }>('/purchases/account-token');
    const t = await NativePurchases.purchaseProduct({
      productIdentifier: id,
      productType: PURCHASE_TYPE.INAPP,
      quantity: 1,
      appAccountToken: token,
      // الخادم يؤكد الشراء ويستهلكه بعد إضافة العملات، فلا نؤكده هنا
      isConsumable: false,
      autoAcknowledgePurchases: false,
    });
    announce('جارٍ تأكيد الشراء…');
    const added = await deliver(t);
    announce(added ? `تم! أُضيفت ${added} عملة إلى رصيدك` : `تم تأكيد شراء ${pack.coins} عملة`);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase();
    if (msg.includes('cancel')) announce('أُلغي الشراء');
    else if (msg.includes('pending')) announce('الدفع قيد المعالجة، وستُضاف العملات عند اكتماله');
    else announce('تعذّر إتمام الشراء الآن، لم يُخصم منك شيء أو ستُضاف العملات تلقائياً عند الفتح التالي');
  }
}

/** استكمال أي شراء دُفع ولم تُسلَّم عملاته بعد (يُستدعى عند فتح التطبيق) */
export async function recoverPurchases(): Promise<void> {
  if (!purchasesAvailable()) return;
  try {
    const { NativePurchases, PURCHASE_TYPE } = await plugin();
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP });
    let total = 0;
    for (const t of purchases) {
      if (!COIN_PACKS.some((p) => p.id === t.productIdentifier)) continue;
      if (t.purchaseState && !['purchased', '1', 'PURCHASED'].includes(String(t.purchaseState))) continue;
      try { total += await deliver(t); } catch { /* نحاول في المرة القادمة */ }
    }
    if (total) announce(`أُضيفت ${total} عملة من شراء سابق إلى رصيدك`);
  } catch { /* المتجر غير متاح الآن */ }
}
