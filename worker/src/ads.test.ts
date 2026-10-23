import { expect, it } from 'vitest';
import { verifySsv } from './ads';

/** توقيع خام r||s → DER (كما ترسله Google) */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let v = b;
    while (v.length > 1 && v[0] === 0 && !(v[1] & 0x80)) v = v.slice(1);
    if (v[0] & 0x80) v = Uint8Array.from([0, ...v]);
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

it('verifies a correctly signed SSV callback and rejects tampering', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const keys = new Map([['42', pair.publicKey]]);
  const q = 'ad_network=5450213213286189855&ad_unit=1234&reward_amount=2&reward_item=coins&timestamp=1700000000000&transaction_id=tx1&user_id=uid-123';
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(q)));
  const url = new URL(`https://x/api/ads/ssv?${q}&signature=${b64url(rawToDer(sig))}&key_id=42`);
  expect(await verifySsv(url, keys)).toEqual({ userId: 'uid-123', transactionId: 'tx1', amount: 2 });

  const forged = new URL(url.toString().replace('user_id=uid-123', 'user_id=attacker'));
  expect(await verifySsv(forged, keys)).toBeNull();
  expect(await verifySsv(new URL(url.toString().replace('key_id=42', 'key_id=7')), keys)).toBeNull();
});
