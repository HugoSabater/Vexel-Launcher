import type { AccentColor } from "../types/launcher";

export interface AccentThemeTokens {
  id: AccentColor;
  label: string;
  main: string;
  hover: string;
  soft: string;
  border: string;
  foreground: string;
  rgb: string;
}

export const ACCENT_OPTIONS: AccentThemeTokens[] = [
  {
    id: "emerald",
    label: "Esmeralda",
    main: "#10b981",
    hover: "#059669",
    soft: "rgba(16, 185, 129, 0.14)",
    border: "rgba(16, 185, 129, 0.34)",
    foreground: "#06100c",
    rgb: "16, 185, 129",
  },
  {
    id: "cyan",
    label: "Cian",
    main: "#38bdf8",
    hover: "#0284c7",
    soft: "rgba(56, 189, 248, 0.14)",
    border: "rgba(56, 189, 248, 0.34)",
    foreground: "#061018",
    rgb: "56, 189, 248",
  },
  {
    id: "indigo",
    label: "Índigo",
    main: "#6366f1",
    hover: "#4f46e5",
    soft: "rgba(99, 102, 241, 0.16)",
    border: "rgba(99, 102, 241, 0.36)",
    foreground: "#ffffff",
    rgb: "99, 102, 241",
  },
  {
    id: "amber",
    label: "Ámbar",
    main: "#f59e0b",
    hover: "#d97706",
    soft: "rgba(245, 158, 11, 0.14)",
    border: "rgba(245, 158, 11, 0.34)",
    foreground: "#140d02",
    rgb: "245, 158, 11",
  },
  {
    id: "crimson",
    label: "Carmesí",
    main: "#f43f5e",
    hover: "#e11d48",
    soft: "rgba(244, 63, 94, 0.16)",
    border: "rgba(244, 63, 94, 0.36)",
    foreground: "#ffffff",
    rgb: "244, 63, 94",
  },
];

export const ACCENT_PALETTE: Record<string, AccentThemeTokens> =
  Object.fromEntries(ACCENT_OPTIONS.map((opt) => [opt.id, opt]));

export const USERNAME_REGEX = /^[A-Za-z0-9_]{3,16}$/;
