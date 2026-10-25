import { SignJWT, importPKCS8 } from 'jose';

interface ServiceAccount { client_email: string; private_key: string; project_id: string }


/**
 * يقرأ ملف حساب الخدمة حتى لو حُوّلت رموز \n داخل النصوص إلى أسطر حقيقية
 * (يحدث عند نسخ الملف ولصقه من الجوال).
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    let out = '';
    let inString = false;
    let escaped = false;
    for (const ch of raw) {
      if (inString) {
        if (escaped) { escaped = false; out += ch; continue; }
        if (ch === '\\') { escaped = true; out += ch; continue; }
        if (ch === '"') { inString = false; out += ch; continue; }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') continue;
        out += ch;
      } else {
        if (ch === '"') inString = true;
        out += ch;
      }
    }
    return JSON.parse(out) as ServiceAccount;
  }
}

/** توكن وصول OAuth لحساب الخدمة (يُخزّن مؤقتاً لكل مجموعة صلاحيات حتى قرب انتهائه). */
const tokenCache = new Map<string, { token: string; exp: number }>();

// Firestore + إدارة حسابات Firebase Auth (لحذف الحساب عند طلب صاحبه)
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform';

export async function accessToken(serviceAccountJson: string, scope = DEFAULT_SCOPE): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokenCache.get(scope);
  if (cached && cached.exp - 60 > now) return cached.token;
  const sa = parseServiceAccount(serviceAccountJson);
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(scope, { token: data.access_token, exp: now + data.expires_in });
  return data.access_token;
}

type FsValue = { stringValue: string } | { integerValue: string } | { timestampValue: string } | { booleanValue: boolean };

export function fields(obj: Record<string, string | number | Date | boolean>): Record<string, FsValue> {
  const out: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v instanceof Date ? { timestampValue: v.toISOString() }
      : typeof v === 'boolean' ? { booleanValue: v }
        : typeof v === 'number' ? { integerValue: String(Math.trunc(v)) }
          : { stringValue: v };
  }
  return out;
}

export class Firestore {
  constructor(private projectId: string, private serviceAccountJson: string) {}

  private base() {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents`;
  }

  /** ينشئ مستنداً فقط إن لم يكن موجوداً. يرجع false إن كان موجوداً مسبقاً. */
  async createIfMissing(collection: string, id: string, data: Record<string, string | number | Date>): Promise<boolean> {
    const res = await fetch(`${this.base()}/${collection}?documentId=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields(data) }),
    });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
    return true;
  }

  /** يحدّث حقولاً محددة فقط في مستند موجود. */
  async update(collection: string, id: string, data: Record<string, string | number | Date | boolean>): Promise<void> {
    const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    const res = await fetch(`${this.base()}/${collection}/${encodeURIComponent(id)}?${mask}&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields(data) }),
    });
    if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
  }

  /** يقرأ مستنداً (الحقول النصية والرقمية فقط). يرجع null إن لم يوجد. */
  async get(collection: string, id: string): Promise<Record<string, string | number> | null> {
    const res = await fetch(`${this.base()}/${collection}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}` },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
    const doc = (await res.json()) as { fields?: Record<string, { stringValue?: string; integerValue?: string }> };
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(doc.fields ?? {})) {
      if (v.stringValue !== undefined) out[k] = v.stringValue;
      else if (v.integerValue !== undefined) out[k] = Number(v.integerValue);
    }
    return out;
  }

  /**
   * يضيف/يخصم عملات بأمان ضد السباق (قراءة ثم كتابة مشروطة بوقت آخر تعديل).
   * يرمي 'not-enough-coins' إن كان الرصيد لا يكفي.
   */
  async adjustCoins(uid: string, delta: number): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${this.base()}/users/${encodeURIComponent(uid)}`, {
        headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}` },
      });
      if (!res.ok) throw new Error(res.status === 404 ? 'no-profile' : `firestore ${res.status}`);
      const doc = (await res.json()) as {
        updateTime: string;
        fields?: { coins?: { integerValue?: string }; unlimited?: { booleanValue?: boolean } };
      };
      const current = Number(doc.fields?.coins?.integerValue ?? 0);
      // حساب المطوّر: لا يُخصم منه شيء
      if (delta < 0 && doc.fields?.unlimited?.booleanValue === true) return current;
      const coins = current + delta;
      if (coins < 0) throw new Error('not-enough-coins');
      const patch = await fetch(
        `${this.base()}/users/${encodeURIComponent(uid)}?updateMask.fieldPaths=coins&currentDocument.updateTime=${encodeURIComponent(doc.updateTime)}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: fields({ coins }) }),
        },
      );
      if (patch.ok) return coins;
      // تغيّر المستند بين القراءة والكتابة — نعيد المحاولة
      if (patch.status === 400 || patch.status === 409 || patch.status === 412) continue;
      throw new Error(`firestore ${patch.status}`);
    }
    throw new Error('busy');
  }

  async remove(collection: string, id: string): Promise<void> {
    const res = await fetch(`${this.base()}/${collection}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`firestore ${res.status}`);
  }

  /** ينشئ أو يستبدل مستنداً بالكامل. */
  async set(collection: string, id: string, data: Record<string, string | number | Date | boolean>): Promise<void> {
    const res = await fetch(`${this.base()}/${collection}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: fields(data) }),
    });
    if (!res.ok) throw new Error(`firestore ${res.status}: ${await res.text()}`);
  }

  /** معرّفات مستندات مجموعة (حتى 300) */
  async listIds(collection: string): Promise<string[]> {
    const res = await fetch(`${this.base()}/${collection}?pageSize=300&mask.fieldPaths=status`, {
      headers: { Authorization: `Bearer ${await accessToken(this.serviceAccountJson)}` },
    });
    if (!res.ok) throw new Error(`firestore ${res.status}`);
    const data = (await res.json()) as { documents?: { name: string }[] };
    return (data.documents ?? []).map((d) => d.name.split('/').pop()!);
  }
}

/** يحذف حساب Firebase Auth نهائياً (بصلاحية حساب الخدمة) */
export async function deleteAuthUser(projectId: string, serviceAccountJson: string, uid: string): Promise<void> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken(serviceAccountJson)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid }),
  });
  if (!res.ok) throw new Error(`auth-delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
