import { useTranslation } from "react-i18next";
import { BTN_GHOST } from "../../lib/ui";

interface LanguageToggleProps {
  className?: string;
}

/** 语言切换按钮 (zh ↔ en) */
export function LanguageToggle({ className }: LanguageToggleProps) {
  const { t, i18n } = useTranslation();

  const toggle = () => {
    const newLang = i18n.language.startsWith("zh") ? "en" : "zh";
    i18n.changeLanguage(newLang);
  };

  return (
    <button
      onClick={toggle}
      className={className ?? `${BTN_GHOST} btn-xs text-xs font-bold`}
      title={t("common.toggleLanguage")}
    >
      {i18n.language.startsWith("zh") ? "EN" : "中"}
    </button>
  );
}
