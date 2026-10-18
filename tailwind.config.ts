import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ivory: { DEFAULT: "#FBF7F0", 50: "#FFFDF9", 100: "#FBF7F0", 200: "#F3EDE2", 300: "#E8DFD0" },
        ink: { DEFAULT: "#2D2A26", soft: "#5C574F", faint: "#8A847A" },
        sage: { 50: "#F1F5EF", 100: "#E2EBDD", 200: "#C6D6BD", 400: "#8DAA7E", 600: "#5F7E52", 700: "#4A6440", 800: "#384C31" },
        mist: { 50: "#EEF4F8", 100: "#DCE8F0", 300: "#A9C4D6", 600: "#4F7690", 700: "#3E5E74" },
        clay: { 50: "#FBF0EB", 100: "#F6DFD4", 300: "#E5A98F", 500: "#C9714F", 600: "#B05C3C", 700: "#8E4930" },
      },
      fontFamily: {
        display: ['"Fraunces Variable"', "Georgia", "serif"],
        sans: ['"DM Sans Variable"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { xl2: "1.25rem" },
      boxShadow: { soft: "0 1px 2px rgba(45,42,38,.04), 0 4px 16px rgba(45,42,38,.05)" },
    },
  },
  plugins: [],
};
export default config;
