// اختبارات المسودات (ألعاب جاهزة لم تُضف للمشروع بعد): npx vitest run --config drafts/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['drafts/**/*.test.ts'], root: '.' } });
