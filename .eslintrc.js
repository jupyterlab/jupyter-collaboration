const config = {
  root: true,
  env: {
    browser: true,
    es6: true,
  },
  ignorePatterns: ["packages/rtc-store-dummy"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/eslint-recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "prettier/@typescript-eslint",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: [
      "./examples/jupyter/tsconfig.json",
      "./examples/lumino/tsconfig.json",
      "./examples/todo/tsconfig.json",
      "./packages/jupyter/tsconfig.json",
      "./packages/node/tsconfig.json",
      "./packages/relay/tsconfig.json",
      "./packages/supernode/tsconfig.json",
      "./tools/debugger/tsconfig.json",
      "./tools/dummy-store/tsconfig.json",
    ],
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2018,
    sourceType: "module",
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  plugins: ["@typescript-eslint"],
  rules: {
    // Disable because warns incorrectly when we use React.FC<Props>
    "react/prop-types": "off",
    // Sometimes it's clearer to define functions after they are used
    "@typescript-eslint/no-use-before-define": "off",
  },
};

/**
 * Exports.
 */
module.exports = config;
