const config = {
  root: true,
  env: {
    browser: true,
    es6: true,
  },
  ignorePatterns: ["packages/dummystore"],
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
      "./packages/rtc-node/tsconfig.json",
      "./packages/rtc-relay/tsconfig.json",
      "./packages/rtc-todo-example/tsconfig.json",
      "./packages/rtc-jupyter/tsconfig.json",
      "./packages/rtc-jupyter-example/tsconfig.json",
      "./packages/rtc-debugger/tsconfig.json",
      "./packages/rtc-jupyter-supernode/tsconfig.json",
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
