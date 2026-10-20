import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

// Ground rule 4 of the split plan: no platform-specific code outside launch/ and screenshot/
// (and the user config folder, which each OS keeps in its own place), and processes spawned
// with argument arrays, never shell strings.
const PLATFORM_FILES = ['src/launch/**/*.ts', 'src/screenshot/**/*.ts', 'src/config/userDir.ts'];

export default [
  { ignores: ['dist/**', 'node_modules/**', 'conformance/fixtures/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      ...typescript.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off',
      'no-console': 'error',
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'cwd',
          message: 'Only src/cli.ts reads the working directory; take repoRoot as an argument.'
        },
        {
          object: 'process',
          property: 'platform',
          message: 'Platform-specific code belongs in src/launch/ or src/screenshot/.'
        }
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['child_process', 'node:child_process'].map(name => ({
            name,
            importNames: ['exec', 'execSync'],
            message: 'Spawn with an argument array (spawn, execFile), never a shell string.'
          }))
        }
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: 'Spawn with an argument array, never through a shell.'
        }
      ]
    }
  },
  {
    files: ['src/cli.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'platform',
          message: 'Platform-specific code belongs in src/launch/ or src/screenshot/.'
        }
      ]
    }
  },
  {
    files: PLATFORM_FILES,
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'cwd',
          message: 'Only src/cli.ts reads the working directory; take repoRoot as an argument.'
        }
      ]
    }
  },
  // The local UI: a browser app, checked against its own tsconfig.
  {
    files: ['ui/**/*.{ts,tsx}'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        project: ['./ui/tsconfig.json', './ui/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      ...typescript.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-undef': 'off',
      'no-console': 'error'
    }
  },
  prettier
];
