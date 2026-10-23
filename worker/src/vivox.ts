// مولّد توكنات Vivox — منقول من tokenGenerator.js إلى Web Crypto (بيئة Workers لا تحتوي node:crypto افتراضياً)

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const enc = new TextEncoder();

export interface VivoxTokenOptions {
  key: string;
  issuer: string;
  expirySeconds: number;
  action: string;
  requestId: number | string;
  from: string;
  to?: string;
}

export async function generateVivoxToken({ key, issuer, expirySeconds, action, requestId, from, to }: VivoxTokenOptions): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expirySeconds;
  const claims = { iss: issuer, exp, vxa: action, vxi: requestId, f: from, t: to };
  const header = base64UrlEncode(enc.encode('{}'));
  const payload = base64UrlEncode(enc.encode(JSON.stringify(claims)));
  const toSign = `${header}.${payload}`;
  const hmacKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(toSign)));
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}
