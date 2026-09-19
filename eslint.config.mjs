import tidgiConfig from 'eslint-config-tidgi';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  ...tidgiConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['./*.js', './*.mjs', './wiki/tiddlers/tests/playwright/*.ts'],
        },
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'unicorn/prevent-abbreviations': 'off',
    },
  },
];
