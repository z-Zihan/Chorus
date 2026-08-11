import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enChat from "./locales/en/chat.json";
import enCommon from "./locales/en/common.json";
import enErrors from "./locales/en/errors.json";
import enSettings from "./locales/en/settings.json";
import enSidebar from "./locales/en/sidebar.json";
import zhChat from "./locales/zh-CN/chat.json";
import zhCommon from "./locales/zh-CN/common.json";
import zhErrors from "./locales/zh-CN/errors.json";
import zhSettings from "./locales/zh-CN/settings.json";
import zhSidebar from "./locales/zh-CN/sidebar.json";

export const LANGUAGE_STORAGE_KEY = "chorus-lang";
export type AppLanguage = "zh-CN" | "en";

function normalizeLanguage(language?: string | null): AppLanguage | null {
  if (!language) return null;
  const normalized = language.toLowerCase();
  if (normalized.startsWith("zh")) return "zh-CN";
  if (normalized.startsWith("en")) return "en";
  return null;
}

function getStoredLanguage(): AppLanguage | null {
  try {
    return normalizeLanguage(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function detectLanguage(): AppLanguage {
  const stored = typeof window === "undefined" ? null : getStoredLanguage();
  if (stored) return stored;

  if (typeof navigator !== "undefined") {
    for (const language of navigator.languages ?? [navigator.language]) {
      const detected = normalizeLanguage(language);
      if (detected) return detected;
    }
  }

  return normalizeLanguage(import.meta.env.VITE_DEFAULT_LANG) ?? "zh-CN";
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      common: zhCommon,
      sidebar: zhSidebar,
      chat: zhChat,
      settings: zhSettings,
      errors: zhErrors,
    },
    en: {
      common: enCommon,
      sidebar: enSidebar,
      chat: enChat,
      settings: enSettings,
      errors: enErrors,
    },
  },
  lng: detectLanguage(),
  fallbackLng: normalizeLanguage(import.meta.env.VITE_DEFAULT_LANG) ?? "zh-CN",
  supportedLngs: ["zh-CN", "en"],
  defaultNS: "common",
  ns: ["common", "sidebar", "chat", "settings", "errors"],
  interpolation: { escapeValue: false },
  react: { useSuspense: true },
});

export function currentLanguage(): AppLanguage {
  return normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ?? "zh-CN";
}

export async function changeLanguage(language: AppLanguage): Promise<void> {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  await i18n.changeLanguage(language);
}

export default i18n;
