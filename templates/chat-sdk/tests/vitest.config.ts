import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['../react/src/**/*.ts', '../react/src/**/*.tsx', '../vanilla/**/*.js'],
      exclude: ['node_modules', 'tests']
    }
  }
});