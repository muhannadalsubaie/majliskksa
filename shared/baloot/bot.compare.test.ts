// مقارنة الروبوت الحالي بالنسخة السابقة بمباريات تجريبية. لا يعمل ضمن الاختبارات العادية:
//   COMPARE=1 COMPARE_N=400 npx vitest run shared/baloot/bot.compare.test.ts
import { it } from 'vitest';
import { DEFAULT_BOT, PREVIOUS_BOT } from './bot';
import { winRate } from './botSim';

it.runIf(import.meta.env.COMPARE)('current bot vs previous bot', { timeout: 3_600_000 }, () => {
  const N = Number(import.meta.env.COMPARE_N ?? 200);
  const t0 = Date.now();
  const r = winRate(DEFAULT_BOT, PREVIOUS_BOT, N, Number(import.meta.env.COMPARE_SEED ?? 3));
  console.log(`current vs previous: ${(r * 100).toFixed(1)}% of ${N} matches (${Date.now() - t0}ms)`);
});
