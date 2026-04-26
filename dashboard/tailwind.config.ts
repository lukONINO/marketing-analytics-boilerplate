import type { Config } from "tailwindcss";

/**
 * Acme design tokens.
 *
 * The full brand palette is expressed here so components can reach for
 * semantic names — `primary-600`, `ink-900`, `surface`, `border-subtle`,
 * `success` — rather than raw hex.
 *
 * Tokens are ADDITIONS to Tailwind's default palette; slate/emerald/etc.
 * still resolve so legacy classes don't break during the rollout.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Acme Primary (deep teal) ----------------------------------
        primary: {
          50:  "#F4F7F8",
          100: "#E8F1F3",
          200: "#D0E4E8",
          300: "#ABC3C9",
          400: "#81A6AE",
          500: "#578893",
          600: "#2D6B78",
          700: "#265B66",
          800: "#1D4A54",
          900: "#17363C",
          950: "#0B1B1E",
          DEFAULT: "#2D6B78",
        },

        // --- Acme Purple (accent / creative) ---------------------------
        accent: {
          50:  "#F6F6FD",
          100: "#EEEDFE",
          200: "#D7D6FC",
          300: "#B7B5EF",
          400: "#8D8BE7",
          500: "#7B7ADE",
          600: "#5754D5",
          700: "#4745AF",
          800: "#3F3CB0",
          900: "#27255F",
          950: "#17163A",
          DEFAULT: "#5754D5",
        },

        // --- Ink / text scale (warm-neutral, matches platform DS) -------
        ink: {
          900: "#111111",  // foreground
          700: "#2E2E2E",
          600: "#666666",  // muted-foreground
          500: "#8B8B87",  // tertiary
          400: "#B8B9B6",
          300: "#CBCCC9",  // border (warm)
        },

        // --- Surface tokens (warm canvas, white cards) ------------------
        surface: {
          canvas:   "#F2F3F0",  // platform background
          muted:    "#E7E8E5",  // sidebar / secondary
          DEFAULT:  "#FFFFFF",
          elevated: "#FFFFFF",
          sidebar:  "#E7E8E5",
        },

        // --- Borders (warm gray) ----------------------------------------
        hairline: {
          DEFAULT: "#CBCCC9",  // platform border
          subtle:  "#DEDFDC",
          strong:  "#B6B7B4",
        },

        // --- Secondary (teal tint, lighter than primary) ----------------
        secondary: {
          50:  "#E0F4F7",
          100: "#C3E8EE",
          400: "#4FA8B4",
          500: "#188999",
          600: "#0F6270",
          DEFAULT: "#188999",
        },

        // --- Semantic ----------------------------------------------------
        success: {
          50:  "#DCFCE7",
          500: "#16A34A",
          600: "#15803D",
          DEFAULT: "#16A34A",
        },
        danger: {
          50:  "#FEE2E2",
          500: "#DC2626",
          600: "#991B1B",
          DEFAULT: "#DC2626",
        },
        warning: {
          50:  "#FEF3C7",
          500: "#D97706",
          600: "#B45309",
          DEFAULT: "#D97706",
        },
        info: {
          50:  "#DBEAFE",
          500: "#2563EB",
          600: "#1E40AF",
          DEFAULT: "#2563EB",
        },

        // Legacy brand alias — retained for any old references.
        brand: {
          50:  "#F4F7F8",
          100: "#E8F1F3",
          500: "#2D6B78",
          700: "#265B66",
          900: "#17363C",
        },
      },

      borderRadius: {
        // Acme --radius-m = 16
        "ds":  "16px",
        "4xl": "2rem",
      },

      boxShadow: {
        // Soft, warm-tinted to sit on the #F2F3F0 canvas without looking cold.
        card:         "0 1px 0 0 rgba(17, 17, 17, 0.025), 0 1px 2px 0 rgba(17, 17, 17, 0.035)",
        "card-hover": "0 1px 0 0 rgba(17, 17, 17, 0.04), 0 8px 24px -10px rgba(17, 17, 17, 0.10), 0 2px 4px -2px rgba(17, 17, 17, 0.04)",
        pop:          "0 12px 36px -14px rgba(17, 17, 17, 0.18), 0 4px 10px -4px rgba(17, 17, 17, 0.06)",
        inset:        "inset 0 0 0 1px rgba(17, 17, 17, 0.04)",
      },

      backgroundImage: {
        // Very subtle warm wash — the platform DS uses a flat warm canvas.
        "brand-glow":
          "radial-gradient(70% 50% at 0% 0%, rgba(45, 107, 120, 0.035) 0%, transparent 55%), radial-gradient(70% 50% at 100% 0%, rgba(87, 84, 213, 0.03) 0%, transparent 55%)",
      },

      fontFamily: {
        // Acme platform: Geist for body, JetBrains Mono for headings.
        sans: [
          "Geist",
          "ui-sans-serif", "system-ui", "-apple-system",
          "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif",
        ],
        display: [
          "JetBrains Mono",
          "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace", "SFMono-Regular", "SF Mono",
          "Menlo", "Consolas", "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
