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
      // Story 14-4: catch raw shadow primitives in JS-style objects at the
      // ESLint AST layer. The companion bash gate (`scripts/check-design-tokens.sh`)
      // also covers the NativeWind `className="rounded-[Npx]"` surface that
      // ESLint cannot see; this rule fires IDE-time on the JS-style-object
      // surface. Spread `...Shadows.card / .hero / .bottomSheet / .subtle`
      // from `@/src/lib/design` instead. Escape hatch: add an inline
      // `// design-token-exempt: <rationale>` comment AND wrap the line in
      // `// eslint-disable-next-line no-restricted-syntax`.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name=/^shadow(Opacity|Radius)$/][value.type='Literal']",
          message:
            "Use Shadows.* tokens from @/src/lib/design instead of raw shadowOpacity/shadowRadius literals (Story 14-4).",
        },
      ],
    },
  },
  {
    // The token definitions themselves live in design.ts — exempt from
    // the no-restricted-syntax shadow-literal rule. The two design-token
    // scripts already exclude this file from their pattern scan.
    files: ["src/lib/design.ts"],
    rules: {
      "no-restricted-syntax": "off",
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
