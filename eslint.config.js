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
    ignores: ["node_modules/", ".expo/", ".history/", "dist/", "supabase/functions/"],
  },
  // Accessibility lint — evaluated plugins (2026-03):
  //
  // 1. eslint-plugin-react-native-a11y v3.5.1:
  //    NOT added — incompatible with ESLint 9 flat config.
  //    Peer deps cap at ESLint ^8, no flat config export.
  //    PR #167 (FormidableLabs/eslint-plugin-react-native-a11y) stalled since May 2025.
  //
  // 2. eslint-plugin-jsx-a11y:
  //    NOT added — designed for web DOM elements (div, button, img), not React Native
  //    components (View, TouchableOpacity, Pressable). Rules do not map to RN's
  //    accessibilityRole/accessibilityLabel props. Would produce only false negatives.
  //
  // Revisit when eslint-plugin-react-native-a11y ships a flat-config-compatible release.
]);
