/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        aviax: {
          bg: "#2B1214",
          card: "#3F1D20",
          primary: "#F7931E",
          accent: "#E5352B",
          text: "#FFEBD2",
          success: "#3FA34D",
        },
      },
      fontFamily: {
        sans: ["Nunito", "sans-serif"],
      },
    },
  },
  plugins: [],
};
