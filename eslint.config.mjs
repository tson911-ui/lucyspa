import js from '@eslint/js';
import next from '@next/eslint-plugin-next';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/next-env.d.ts',
      '.local/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: { '@typescript-eslint/consistent-type-imports': 'error' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { '@next/next': next },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@lucy-spa/server',
                '@lucy-spa/server/*',
                '@lucy-spa/database',
                '@lucy-spa/database/*',
                '@prisma/*',
                'pg',
                'ioredis',
                'bullmq',
              ],
              message: 'Web/UI must use API contracts; backend infrastructure is server-only.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
