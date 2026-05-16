import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular"],
      },
      colors: {
        bg: {
          0: "rgb(var(--bg-0) / <alpha-value>)",
          1: "rgb(var(--bg-1) / <alpha-value>)",
          2: "rgb(var(--bg-2) / <alpha-value>)",
        },
        fg: {
          0: "rgb(var(--fg-0) / <alpha-value>)",
          1: "rgb(var(--fg-1) / <alpha-value>)",
        },
        border: {
          0: "rgb(var(--border-0) / <alpha-value>)",
        },
        accent: {
          ok: "rgb(var(--accent-ok) / <alpha-value>)",
          danger: "rgb(var(--accent-danger) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
