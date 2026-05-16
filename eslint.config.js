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
      // Story 14-4 R1-P7 + R1-P10: extend the selector with 3 sibling branches
      // so the rule fires on the full Property-key + Property-value cross-product:
      //   - Identifier key + Literal value (canonical `shadowOpacity: 0.5`)
      //   - Identifier key + UnaryExpression-Literal value (negative-numeric, e.g. `shadowOpacity: -0.5`)
      //   - Literal-string key + Literal value (quoted-key form, e.g. `{"shadowOpacity": 0.5}`)
      //   - Literal-string key + UnaryExpression-Literal value
      // Note: computed-key with non-literal identifier (`{[SHADOW_KEY]: 0.5}`)
      // remains an enforcement gap by design — the bash gate covers the literal-key
      // surface and computed-keys are unconventional enough that runtime drift
      // would be visible in code review.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name=/^shadow(Opacity|Radius)$/][value.type='Literal']",
          message:
            "Use Shadows.* tokens from @/src/lib/design instead of raw shadowOpacity/shadowRadius literals (Story 14-4).",
        },
        {
          selector:
            "Property[key.name=/^shadow(Opacity|Radius)$/][value.type='UnaryExpression'][value.argument.type='Literal']",
          message:
            "Use Shadows.* tokens from @/src/lib/design instead of raw shadowOpacity/shadowRadius numeric literals (Story 14-4 R1-P7).",
        },
        {
          selector:
            "Property[key.type='Literal'][key.value=/^shadow(Opacity|Radius)$/][value.type='Literal']",
          message:
            "Use Shadows.* tokens from @/src/lib/design instead of raw shadowOpacity/shadowRadius literals (Story 14-4 R1-P10).",
        },
        {
          selector:
            "Property[key.type='Literal'][key.value=/^shadow(Opacity|Radius)$/][value.type='UnaryExpression'][value.argument.type='Literal']",
          message:
            "Use Shadows.* tokens from @/src/lib/design instead of raw shadowOpacity/shadowRadius numeric literals (Story 14-4 R1-P10).",
        },
      ],
    },
  },
  {
    // The token definitions themselves live in design.ts AND the drift detector
    // test asserts the patterns as literal strings inside describe/it descriptions.
    // Both are exempt from the no-restricted-syntax shadow-literal rule (Story 14-4
    // R1-P9). The bash gate's EXEMPT_PATHS array mirrors this set.
    files: ["src/lib/design.ts", "src/lib/__tests__/design-token-enforcement-source-drift.test.ts"],
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
