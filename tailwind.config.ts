import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1b1f24",
        steel: "#51606f",
        signal: "#d82c2c",
        mint: "#1f8a70"
      },
      boxShadow: {
        panel: "0 20px 55px rgba(27, 31, 36, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
