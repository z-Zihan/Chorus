import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PasswordInput({
  label,
  value,
  onChange,
  placeholder,
}: PasswordInputProps) {
  const { t } = useTranslation(["common", "settings"]);
  const inputId = useId();
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div>
      <label
        htmlFor={inputId}
        className="mb-2 block text-sm font-medium text-[var(--text-primary)]"
      >
        {label}
      </label>
      <span className="relative block">
        <input
          id={inputId}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-base)] px-3 py-2.5 pr-11 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)] focus:border-[var(--accent-color)] focus:ring-2 focus:ring-indigo-500/20"
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? t("settings:apiKeyHide") : t("settings:apiKeyShow")}
          title={isVisible ? t("common:buttons.hide") : t("common:buttons.show")}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {isVisible ? (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4.5 10 8a12.7 12.7 0 0 1-2.2 4.1M6.6 6.6A12.8 12.8 0 0 0 2 12c1 3.5 5 8 10 8 1.4 0 2.7-.4 3.9-1" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" strokeWidth={1.8} />
            </svg>
          )}
        </button>
      </span>
    </div>
  );
}
