export const THEME_STORAGE_KEY = "chorus-theme";
export type ThemePreference = "dark" | "light" | "system";

const systemThemeQuery = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null | undefined): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

export function getThemePreference(): ThemePreference {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Continue with the configured default when storage is unavailable.
  }
  if (isThemePreference(stored)) return stored;
  const configured = import.meta.env.VITE_DEFAULT_THEME;
  return isThemePreference(configured) ? configured : "dark";
}

function resolvedTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return window.matchMedia(systemThemeQuery).matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
  const theme = resolvedTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setThemePreference(preference: ThemePreference): boolean {
  let persisted = true;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    persisted = false;
  }
  applyTheme(preference);
  window.dispatchEvent(new CustomEvent("chorus-theme-change", { detail: preference }));
  return persisted;
}

export function initializeTheme(): () => void {
  const media = window.matchMedia(systemThemeQuery);
  const handleSystemChange = () => {
    if (getThemePreference() === "system") applyTheme("system");
  };
  applyTheme(getThemePreference());
  media.addEventListener("change", handleSystemChange);
  return () => media.removeEventListener("change", handleSystemChange);
}
