module.exports = {
  env: {
    node: true,
    es2022: true,
  },
  extends: [
    'airbnb-base',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:prettier/recommended',
  ],
  plugins: ['import', 'prettier'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // --- Style ---
    'prettier/prettier': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // --- Node.js best practices ---
    'no-process-exit': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'consistent-return': 'off',

    // --- Imports ---
    'import/prefer-default-export': 'off',
    'import/no-extraneous-dependencies': ['error', { devDependencies: ['**/*.test.js', '**/*.spec.js'] }],

    // --- Async patterns ---
    'no-await-in-loop': 'warn',
    'require-await': 'error',

    // --- Classes & objects ---
    'class-methods-use-this': 'off',
    'no-underscore-dangle': ['error', { allow: ['_id', '__v'] }],
  },
  ignorePatterns: ['node_modules/', 'dist/', 'coverage/', '*.min.js'],
};
