import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/** Node builtins must never appear in renderer or shared code. */
const nodeBuiltins = ['node:*', 'fs', 'path', 'os', 'child_process', 'crypto']

export default defineConfig([
  globalIgnores(['out/**', 'dist/**', 'release/**', 'node_modules/**', '*.cjs']),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // The IPC contract mixes object shapes, discriminated unions and mapped
      // types. Switching notation per shape is churn with no safety benefit,
      // so this codebase uses `type` throughout.
      '@typescript-eslint/consistent-type-definitions': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNonNullExpression',
          message: 'No non-null assertions. Handle the undefined case.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },

  // ── Boundary: renderer is a browser. No Node, no Electron, no main. ────────
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*', ...nodeBuiltins],
              message:
                'The renderer is sandboxed. Go through the preload bridge (window.luna).',
            },
            {
              group: ['**/main/**', '**/preload/**'],
              // Type-only imports are erased at build time, so they cross no
              // real boundary. global.d.ts needs `typeof api` from the preload
              // to stay in sync with it automatically.
              allowTypeImports: true,
              message:
                'The renderer may only import values from src/shared and src/renderer.',
            },
          ],
        },
      ],
    },
  },

  // ── Boundary: shared is loaded by all three. Pure TS only. ────────────────
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electron', 'electron/*', ...nodeBuiltins, 'react', 'react-dom'],
              message: 'src/shared is loaded by all three processes. Keep it pure TypeScript.',
            },
            {
              group: ['**/main/**', '**/preload/**', '**/renderer/**'],
              message: 'src/shared must not depend on any process-specific code.',
            },
          ],
        },
      ],
    },
  },

  // ── Boundary: main has no DOM and no renderer code. ──────────────────────
  {
    files: ['src/main/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/renderer/**', 'react', 'react-dom'],
              message: 'There is no DOM in the main process.',
            },
          ],
        },
      ],
    },
  },

  // ── Tests may reach further than production code. ────────────────────────
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // ── Config files run in Node before any boundary applies. ────────────────
  {
    files: ['*.config.{ts,js}', 'eslint.config.js'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
