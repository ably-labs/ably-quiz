import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Engine logic in packages/* (S2) plus server-side lib tests in apps/web (S1.4).
    include: ['packages/**/*.{test,spec}.ts', 'apps/web/lib/**/*.{test,spec}.ts'],
    environment: 'node',
    // No failure when a package has no tests yet (pre-S2).
    passWithNoTests: true,
  },
});
