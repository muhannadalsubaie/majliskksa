// ضبط عتبات الروبوت بمباريات تجريبية بين نسخه. لا يعمل ضمن الاختبارات العادية:
//   TUNE=1 npx vitest run shared/baloot/bot.tuning.test.ts
import { it } from 'vitest';
import { type BotParams, DEFAULT_BOT } from './bot';
import { winRate } from './botSim';

it.runIf(import.meta.env.TUNE)('tune bot thresholds by self-play', { timeout: 3_600_000 }, () => {
  const N = Number(import.meta.env.TUNE_N ?? 120);
  const t0 = Date.now();
  console.log('default vs random:', winRate(DEFAULT_BOT, 'random', 40).toFixed(2), `(${Date.now() - t0}ms for 40 matches)`);
  let best: BotParams = DEFAULT_BOT;
  // بحث إحداثي: نحسّن كل عتبة على حدة ضد أفضل نسخة حتى الآن، جولتين
  const grid: Record<Exclude<keyof BotParams, 'smart' | 'expert'>, number[]> = {
    hokm: [3.5, 4, 4.5, 5, 5.5, 6],
    sun: [2.5, 3, 3.5, 4, 4.5, 5],
    overPartner: [1, 2.5, 4],
    double: [5, 5.5, 6, 6.5, 7.5],
    raise: [8, 9, 10.5],
  };
  for (let round = 0; round < 2; round++) {
    for (const key of Object.keys(grid) as (keyof typeof grid)[]) {
      const results = grid[key].map((v) => {
        const cand = { ...best, [key]: v };
        const r = v === best[key] ? 0.5 : winRate(cand, best, N, round * 100 + v * 10);
        return { v, r };
      });
      const top = results.reduce((a, b) => (b.r > a.r ? b : a));
      console.log(`round ${round} ${key}:`, results.map((x) => `${x.v}=${x.r.toFixed(2)}`).join(' '));
      if (top.r > 0.53) best = { ...best, [key]: top.v };
    }
    console.log('best so far:', JSON.stringify(best));
  }
  console.log('final vs default:', winRate(best, DEFAULT_BOT, N * 2, 999).toFixed(3), JSON.stringify(best));
});
