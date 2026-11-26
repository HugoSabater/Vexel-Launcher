/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        obsidian: {
          bg: "#07090D",
          panel: "#0D1118",
          card: "#121722",
        },
        vexel: {
          emerald: "#10B981",
          emeraldHover: "#34D399",
          cyan: "#38BDF8",
        },
      },
    },
  },
  plugins: [],
};
