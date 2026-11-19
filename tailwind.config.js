/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slatebg: {
          950: "#0b1120",
          900: "#0f172a",
          800: "#1e293b",
          700: "#334155",
        },
        accent: {
          cyan: "#38bdf8",
          emerald: "#10b981",
        },
      },
    },
  },
  plugins: [],
};
