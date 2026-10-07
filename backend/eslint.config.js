import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'src/generado/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Todo log pasa por el logger con redacción (CLAUDE.md, RNF-08).
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
);
