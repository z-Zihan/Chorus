import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function PasswordInput({ label, value, onChange, placeholder }: PasswordInputProps) {
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
        <Input
          id={inputId}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          className="pr-11"
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? t("settings:apiKeyHide") : t("settings:apiKeyShow")}
          title={isVisible ? t("common:buttons.hide") : t("common:buttons.show")}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          {isVisible ? (
            <EyeOff aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Eye aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
      </span>
    </div>
  );
}
