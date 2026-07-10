import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Engine logic lives in packages/* (core scoring/engine tests land in S2).
    include: ['packages/**/*.{test,spec}.ts'],
    environment: 'node',
    // No failure when a package has no tests yet (pre-S2).
    passWithNoTests: true,
  },
});
