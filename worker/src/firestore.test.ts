import { expect, it } from 'vitest';
import { parseServiceAccount } from './firestore';
it('parses JSON whose private_key has real newlines', () => {
  const good = JSON.stringify({ client_email: 'a@b', private_key: '-----BEGIN PRIVATE KEY-----\nABC\nDEF\n-----END PRIVATE KEY-----\n', project_id: 'p' }, null, 2);
  const broken = good.replace(/\\n/g, '\n');
  expect(() => JSON.parse(broken)).toThrow();
  const sa = parseServiceAccount(broken);
  // المفتاح يترتب من جديد (أسطر 64 حرف)
  expect(sa.private_key).toBe('-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----\n');
  expect(parseServiceAccount(good).client_email).toBe('a@b');
  const crlf = broken.replace(/\n/g, '\r\n');
  expect(parseServiceAccount(crlf).private_key).toContain('\nABCDEF\n');
});
