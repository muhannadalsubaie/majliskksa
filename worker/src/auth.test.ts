import { expect, it } from 'vitest';
import { isUnlimited } from './auth';

const HASH = '34c088887a89d4497a11ba360b3f80ec39bfbdee8c3cffb5fb74c7f440622f1a';
const user = (email: string, emailVerified: boolean) => ({ uid: 'u', name: '', email, emailVerified });

it('unlimited coins only for the verified developer email', async () => {
  expect(await isUnlimited(user('mohanadsbe3e@gmail.com', true), HASH)).toBe(true);
  expect(await isUnlimited(user('Mohanadsbe3e@Gmail.com ', true), HASH)).toBe(true);
  // نفس الإيميل بدون توثيق (حساب بريد وكلمة مرور أنشأه شخص آخر) — مرفوض
  expect(await isUnlimited(user('mohanadsbe3e@gmail.com', false), HASH)).toBe(false);
  expect(await isUnlimited(user('someone@gmail.com', true), HASH)).toBe(false);
  expect(await isUnlimited(user('mohanadsbe3e@gmail.com', true), undefined)).toBe(false);
});
