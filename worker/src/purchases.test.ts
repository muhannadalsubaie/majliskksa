import { expect, it } from 'vitest';
import { COIN_PACKS } from '../../shared/economy';
import { accountTokenFor, packCoins } from './purchases';

it('derives a stable UUID per account for linking purchases', async () => {
  const a = await accountTokenFor('uid-1');
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(await accountTokenFor('uid-1')).toBe(a);
  expect(await accountTokenFor('uid-2')).not.toBe(a);
});

it('knows the coins in each pack and nothing else', () => {
  expect(COIN_PACKS.map((p) => [p.id, packCoins(p.id)])).toEqual([['coins_20', 20], ['coins_70', 70], ['coins_190', 190], ['coins_550', 550]]);
  expect(packCoins('coins_9999')).toBe(0);
});
