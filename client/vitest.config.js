import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import viteConfig from './vite.config.js';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: viteConfig.resolve.alias },
  test: {
    include: ['test/*.test.jsx'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
