// التحقق من مشتريات العملات من المتجر نفسه قبل إضافة أي عملة:
//  • Google Play: واجهة Google Play Developer API بحساب الخدمة (يُمنح صلاحية في Play Console)،
//    ثم "استهلاك" الشراء من الخادم حتى يمكن شراء الباقة مرة أخرى
//  • App Store: واجهة App Store Server API بمفتاح In-App Purchase من App Store Connect
// كل عملية تُسجَّل مرة واحدة فقط (purchases/{المعرّف}) فلا تتكرر الإضافة أبداً.
import { SignJWT, decodeJwt, importPKCS8 } from 'jose';
import { COIN_PACKS } from '../../shared/economy';
import type { Env } from './env';
import { accessToken } from './firestore';

const PACKAGE = 'com.majlisk.app';
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
/** حساب الخدمة المربوط بـ Play Console (نفسه اللي يرفع التطبيق)، وإلا حساب Firebase */
const playAccount = (env: Env) => env.PLAY_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT;

export interface VerifiedPurchase { id: string; productId: string; coins: number; accountToken: string }

export const packCoins = (productId: string) => COIN_PACKS.find((p) => p.id === productId)?.coins ?? 0;

/** يتحقق من شراء Google Play ويرجع بياناته، أو يرمي سبب الرفض */
export async function verifyGoogle(env: Env, productId: string, purchaseToken: string): Promise<VerifiedPurchase> {
  if (!packCoins(productId)) throw new Error('unknown-product');
  const token = await accessToken(playAccount(env), PLAY_SCOPE);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`play-${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const p = (await res.json()) as { purchaseState?: number; orderId?: string; obfuscatedExternalAccountId?: string };
  if (p.purchaseState !== 0) throw new Error('not-purchased'); // 0 = مدفوع، 1 = ملغى، 2 = معلّق
  return { id: `play:${p.orderId ?? purchaseToken.slice(0, 80)}`, productId, coins: packCoins(productId), accountToken: p.obfuscatedExternalAccountId ?? '' };
}

/** بعد إضافة العملات: استهلاك الشراء في Google Play (يؤكده ويسمح بشراء الباقة مجدداً) */
export async function consumeGoogle(env: Env, productId: string, purchaseToken: string): Promise<void> {
  const token = await accessToken(playAccount(env), PLAY_SCOPE);
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`;
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 400) throw new Error(`play-consume-${res.status}`); // 400 = مستهلك مسبقاً
}

/** توكن App Store Server API (صالح 20 دقيقة) */
async function appleToken(env: Env): Promise<string> {
  if (!env.APPSTORE_IAP_KEY || !env.APPSTORE_IAP_KEY_ID || !env.APPSTORE_IAP_ISSUER_ID) throw new Error('apple-not-configured');
  const key = await importPKCS8(env.APPSTORE_IAP_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({ bid: PACKAGE })
    .setProtectedHeader({ alg: 'ES256', kid: env.APPSTORE_IAP_KEY_ID, typ: 'JWT' })
    .setIssuer(env.APPSTORE_IAP_ISSUER_ID)
    .setAudience('appstoreconnect-v1')
    .setIssuedAt()
    .setExpirationTime('20m')
    .sign(key);
}

/**
 * يتحقق من شراء App Store بسؤال Apple مباشرة عن رقم العملية (الإنتاج ثم بيئة الاختبار لـ TestFlight).
 * الرد يأتي من Apple عبر اتصال آمن، فنقرأ محتواه دون حاجة للتحقق من سلسلة الشهادات.
 */
export async function verifyApple(env: Env, transactionId: string): Promise<VerifiedPurchase> {
  if (!/^\d{1,30}$/.test(transactionId)) throw new Error('bad-transaction');
  const jwt = await appleToken(env);
  for (const host of ['api.storekit.itunes.apple.com', 'api.storekit-sandbox.itunes.apple.com']) {
    const res = await fetch(`https://${host}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`apple-${res.status}`);
    const { signedTransactionInfo } = (await res.json()) as { signedTransactionInfo: string };
    const t = decodeJwt(signedTransactionInfo) as { bundleId?: string; productId?: string; revocationDate?: number; appAccountToken?: string };
    if (t.bundleId !== PACKAGE) throw new Error('wrong-app');
    if (t.revocationDate) throw new Error('revoked');
    const productId = String(t.productId ?? '');
    if (!packCoins(productId)) throw new Error('unknown-product');
    return { id: `apple:${transactionId}`, productId, coins: packCoins(productId), accountToken: t.appAccountToken ?? '' };
  }
  throw new Error('apple-not-found');
}

/** معرّف ثابت (بصيغة UUID) مشتق من حساب اللاعب — يُرفق بالشراء ليرتبط بصاحبه */
export async function accountTokenFor(uid: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`majlisk:${uid}`))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; // الإصدار 5
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
