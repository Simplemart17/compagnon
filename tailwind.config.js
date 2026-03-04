/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#1E3A5F",
          50: "#E8EFF6",
          100: "#C5D5E8",
          200: "#9DB6D4",
          300: "#7597C0",
          400: "#4D78AC",
          500: "#1E3A5F",
          600: "#1A3354",
          700: "#152B48",
          800: "#11233D",
          900: "#0D1B31",
        },
        accent: {
          DEFAULT: "#F5A623",
          50: "#FEF5E7",
          100: "#FDE6C3",
          200: "#FBD39B",
          300: "#F9C073",
          400: "#F7B34B",
          500: "#F5A623",
          600: "#DC951F",
          700: "#B87B1A",
          800: "#946215",
          900: "#704A10",
        },
        success: {
          DEFAULT: "#34C759",
          50: "#E9F9ED",
          500: "#34C759",
        },
        error: {
          DEFAULT: "#FF3B30",
          50: "#FFECEB",
          500: "#FF3B30",
        },
        surface: {
          DEFAULT: "#F5F5F0",
          50: "#FFFFFF",
          100: "#F5F5F0",
          200: "#EBEBDF",
          300: "#E0E0CE",
        },
      },
      fontFamily: {
        sans: ["System"],
      },
    },
  },
  plugins: [],
};
