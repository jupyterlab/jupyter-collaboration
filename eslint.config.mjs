/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import jupyter from '@jupyter/eslint-plugin';

export default tseslint.config(
  {
    // Replaces the former .eslintignore
    ignores: [
      '**/lib/**',
      '**/node_modules/**',
      '**/style/**',
      '**/*.d.ts',
      '**/test/**',
      '**/ui-tests/**',
      '**/labextension/**',
      'docs/**',
      'tests/**',
      'eslint.config.mjs',
      '.eslintrc.js',
      'jupyter-config/**',
      'jupyter_collaboration/**',
      '**/babel.config.js',
      '**/jest.config.js'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    plugins: { jupyter }
  },
  ...jupyter.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module'
      }
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: true
          }
        }
      ],
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      curly: ['error', 'all'],
      eqeqeq: 'error',
      'prefer-arrow-callback': 'error'
    }
  }
);
