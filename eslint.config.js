const { defineConfig } = require("eslint/config");
const expoFlat = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoFlat,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "import/order": [
        "warn",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
        },
      ],
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    ignores: [
      "node_modules/",
      ".expo/",
      ".history/",
      "dist/",
      "components/",
      "supabase/functions/",
    ],
  },
]);
