import { format, formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { currentLanguage } from "@/i18n";

function dateLocale() {
  return currentLanguage() === "zh-CN" ? zhCN : enUS;
}

export function formatMessageTime(value: Date | string | number): string {
  return format(new Date(value), "HH:mm", { locale: dateLocale() });
}

export function formatConversationTime(value: Date | string | number): string {
  return formatDistanceToNow(new Date(value), {
    addSuffix: true,
    locale: dateLocale(),
  });
}
