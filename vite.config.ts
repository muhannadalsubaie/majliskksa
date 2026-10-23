import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  test: { include: ['shared/**/*.test.ts', 'src/**/*.test.ts'] },
} as never);
