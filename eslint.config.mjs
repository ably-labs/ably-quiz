import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/*.tsbuildinfo',
      '**/next-env.d.ts',
      '**/.claude/**', // gitignored ephemeral worktrees — don't lint their copies
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Web app: React hooks correctness + Next.js rules.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router only — this rule scans for a Pages Router dir and just warns it's missing.
      '@next/next/no-html-link-for-pages': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  // Prettier last: disable formatting rules that would fight Prettier.
  prettier,
);
