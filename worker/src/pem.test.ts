import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { importPKCS8 } from 'jose';
import { normalizePem, parseServiceAccount } from './firestore';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('normalizePem', () => {
  it('accepts a clean key', async () => { await importPKCS8(normalizePem(pem), 'RS256'); });
  it('fixes literal \\n', async () => { await importPKCS8(normalizePem(pem.replace(/\n/g, '\\n')), 'RS256'); });
  it('fixes spaces instead of newlines', async () => { await importPKCS8(normalizePem(pem.replace(/\n/g, ' ')), 'RS256'); });
  it('fixes CRLF and indentation', async () => { await importPKCS8(normalizePem(pem.replace(/\n/g, '\r\n   ')), 'RS256'); });
  it('parses JSON with doubled escapes', async () => {
    const raw = JSON.stringify({ client_email: 'a@b', private_key: pem.replace(/\n/g, '\\n') });
    await importPKCS8(parseServiceAccount(raw).private_key, 'RS256');
  });
  it('parses JSON pasted with real newlines', async () => {
    const raw = `{"client_email":"a@b","private_key":"${pem}"}`;
    expect(parseServiceAccount(raw).client_email).toBe('a@b');
    await importPKCS8(parseServiceAccount(raw).private_key, 'RS256');
  });
});

describe('normalizePem lenient', () => {
  it('fixes em dashes from phone keyboards', async () => {
    await importPKCS8(normalizePem(pem.replace(/-----/g, '—-—')), 'RS256');
  });
});
