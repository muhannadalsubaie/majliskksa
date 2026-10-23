// التحقق من مكافآت إعلانات AdMob من جهة الخادم (SSV):
// Google تستدعي رابطنا بعد مشاهدة الإعلان كاملاً، مع توقيع ECDSA نتحقق منه بمفاتيحها العامة.
// https://developers.google.com/admob/android/ssv

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
let keyCache: { at: number; keys: Map<string, CryptoKey> } | null = null;

function b64ToBytes(b64: string): Uint8Array {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** توقيع DER (ASN.1) → صيغة r||s الخام التي يتطلبها WebCrypto */
export function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2; // 0x30 len
  if (der[1] & 0x80) i += der[1] & 0x7f;
  const read = () => {
    if (der[i] !== 0x02) throw new Error('bad-der');
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function googleKeys(): Promise<Map<string, CryptoKey>> {
  if (keyCache && Date.now() - keyCache.at < 12 * 3600_000) return keyCache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`keys ${res.status}`);
  const data = (await res.json()) as { keys: { keyId: number; base64: string }[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of data.keys) {
    keys.set(String(k.keyId), await crypto.subtle.importKey('spki', b64ToBytes(k.base64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']));
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}

export interface SsvReward { userId: string; transactionId: string; amount: number }

/**
 * يتحقق من رابط SSV. يرجع بيانات المكافأة إن كان التوقيع صحيحاً، وإلا null.
 * `keys` قابلة للحقن في الاختبارات.
 */
export async function verifySsv(url: URL, keys?: Map<string, CryptoKey>): Promise<SsvReward | null> {
  const query = url.search.slice(1);
  const sigAt = query.indexOf('&signature=');
  if (sigAt < 0) return null;
  const message = new TextEncoder().encode(query.slice(0, sigAt));
  const signature = url.searchParams.get('signature');
  const keyId = url.searchParams.get('key_id');
  if (!signature || !keyId) return null;
  const key = (keys ?? (await googleKeys())).get(keyId);
  if (!key) return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64ToBytes(signature)), message);
  if (!ok) return null;
  return {
    userId: url.searchParams.get('user_id') ?? '',
    transactionId: url.searchParams.get('transaction_id') ?? '',
    amount: Number(url.searchParams.get('reward_amount') ?? 0),
  };
}
