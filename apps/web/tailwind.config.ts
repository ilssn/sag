import type { Config } from "tailwindcss";

const c = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

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
        // shadcn 标准
        background: c("--background"),
        foreground: c("--foreground"),
        card: { DEFAULT: c("--card"), foreground: c("--card-foreground") },
        popover: { DEFAULT: c("--popover"), foreground: c("--popover-foreground") },
        primary: { DEFAULT: c("--primary"), foreground: c("--primary-foreground") },
        secondary: { DEFAULT: c("--secondary"), foreground: c("--secondary-foreground") },
        muted: { DEFAULT: c("--muted"), foreground: c("--muted-foreground") },
        accent: { DEFAULT: c("--accent"), foreground: c("--accent-foreground") },
        destructive: { DEFAULT: c("--destructive"), foreground: c("--destructive-foreground") },
        border: c("--border"),
        input: c("--input"),
        ring: c("--ring"),

        // 信号蓝强调
        signal: {
          DEFAULT: c("--signal"),
          strong: c("--signal-strong"),
          soft: c("--signal-soft"),
          foreground: c("--signal-foreground"),
        },
        success: c("--success"),

        // 语义别名（沿用既有类名）
        paper: c("--background"),
        surface: c("--card"),
        "surface-2": c("--muted"),
        ink: c("--foreground"),
        "ink-muted": c("--muted-foreground"),
        "ink-faint": c("--ink-faint"),
        hairline: c("--border"),
        gold: {
          DEFAULT: c("--signal"),
          strong: c("--signal-strong"),
          soft: c("--signal-soft"),
          foreground: c("--signal-foreground"),
        },
        danger: c("--destructive"),
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        // 极轻，边框优先（Notion/Codex）
        soft: "0 1px 2px 0 rgb(9 9 11 / 0.05), 0 1px 1px -0.5px rgb(9 9 11 / 0.04)",
        lift: "0 10px 30px -12px rgb(9 9 11 / 0.18), 0 3px 8px -3px rgb(9 9 11 / 0.08)",
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
