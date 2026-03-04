/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ["expo", "plugin:@typescript-eslint/recommended"],
  plugins: ["@typescript-eslint"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
  },
  rules: {
    // Disallow `any` — use `unknown` or proper types instead
    "@typescript-eslint/no-explicit-any": "warn",
    // Catch missing awaits on async calls
    "@typescript-eslint/no-floating-promises": "error",
    // Prevent accidental unused vars
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    // Consistent import ordering
    "import/order": [
      "warn",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
      },
    ],
    // Disallow console.log in production code (use console.error/warn for intentional logging)
    "no-console": ["warn", { allow: ["error", "warn"] }],
  },
  ignorePatterns: ["node_modules/", ".expo/", "dist/", "supabase/functions/"],
};
