import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      // Never put credentials or mail into browser storage (CLAUDE.md rule 1).
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'Do not store mailbox data or credentials in browser storage.' },
        { name: 'sessionStorage', message: 'Do not store mailbox data or credentials in browser storage.' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
