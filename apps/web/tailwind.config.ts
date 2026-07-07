import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        "ink-faint": "var(--ink-faint)",
        hairline: "var(--hairline)",
        gold: "var(--gold)",
        "gold-soft": "var(--gold-soft)",
        "gold-strong": "var(--gold-strong)",
        danger: "var(--danger)",
        success: "var(--success)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        lg: "12px",
        md: "10px",
        sm: "8px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(20,18,12,0.04), 0 4px 16px -6px rgba(20,18,12,0.08)",
        lift: "0 2px 4px rgba(20,18,12,0.05), 0 12px 32px -10px rgba(20,18,12,0.14)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.2, 0, 0, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        blink: { "50%": { opacity: "0.2" } },
      },
      animation: {
        "fade-in": "fade-in 0.24s cubic-bezier(0.2,0,0,1)",
        shimmer: "shimmer 1.6s infinite",
        blink: "blink 1s step-start infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
