import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { SELECT } from "../../lib/ui";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const { config, activeLanguageId, setActiveLanguage } = useWorkspaceStore();

  if (config.languages.length <= 1) return null;

  return (
    <select
      className={`${SELECT} w-full text-xs bg-neutral text-neutral-content border-neutral-content/20`}
      value={activeLanguageId}
      onChange={(e) => setActiveLanguage(e.target.value)}
      title={t("workspace.switchLanguage")}
    >
      {config.languages.map((lang) => (
        <option key={lang.language_id} value={lang.language_id}>
          {lang.name}
        </option>
      ))}
    </select>
  );
}
