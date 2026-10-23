import { describe, expect, it } from 'vitest';
import { cleanUsername, usernameKey, validateUsername } from './username';

describe('validateUsername', () => {
  it('accepts Arabic, English, digits and underscore', () => {
    expect(validateUsername('مهند')).toBeNull();
    expect(validateUsername('Mohanad_99')).toBeNull();
    expect(validateUsername('أبو_فهد٧')).toBeNull();
  });
  it('rejects bad input', () => {
    expect(validateUsername('ab')).toBe('too-short');
    expect(validateUsername('a'.repeat(17))).toBe('too-long');
    expect(validateUsername('مهند علي')).toBe('invalid-chars');
    expect(validateUsername('moh@nad')).toBe('invalid-chars');
    expect(validateUsername('___')).toBe('only-underscores');
  });
  it('tashkeel and tatweel do not count toward length', () => {
    expect(validateUsername('أَحـــ')).toBe('too-short');
    expect(cleanUsername(' أحـــمَد ')).toBe('أحمد');
  });
});

describe('usernameKey — look-alike names collide', () => {
  it('Arabic letter variants', () => {
    const k = usernameKey('أحمد');
    expect(usernameKey('احمد')).toBe(k);
    expect(usernameKey('إحمد')).toBe(k);
    expect(usernameKey('أحـــمَد')).toBe(k);
    expect(usernameKey('فاطمة')).toBe(usernameKey('فاطمه'));
    expect(usernameKey('علي')).toBe(usernameKey('على'));
  });
  it('case and digits', () => {
    expect(usernameKey('Ahmed_7')).toBe(usernameKey('ahmed_٧'));
  });
  it('different names stay different', () => {
    expect(usernameKey('احمد')).not.toBe(usernameKey('محمد'));
  });
});
