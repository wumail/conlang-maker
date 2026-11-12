import { useTranslation } from "react-i18next";
import { Plus, Download } from "lucide-react";
import { BTN_PRIMARY, BTN_GHOST } from "../../lib/ui";

interface SCARuleSetToolbarProps {
  canExport: boolean;
  notice: { type: "success" | "error"; text: string } | null;
  onDownloadAll: () => void;
  onOpenImport: () => void;
  onAddRuleSet: () => void;
}

/** 规则集页头：全量导出 / 文本导入 / 新建规则集 */
export const SCARuleSetToolbar: React.FC<SCARuleSetToolbarProps> = ({
  canExport,
  notice,
  onDownloadAll,
  onOpenImport,
  onAddRuleSet,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base-content/80">{t("sca.ruleSets")}</h3>
        <div className="flex items-center gap-2">
          <button className={BTN_GHOST} onClick={onDownloadAll} disabled={!canExport}>
            <Download className="w-4 h-4" /> {t("sca.exportAllRuleSets")}
          </button>
          <button className={BTN_GHOST} onClick={onOpenImport}>
            {t("sca.importRuleSet")}
          </button>
          <button className={BTN_PRIMARY} onClick={onAddRuleSet}>
            <Plus className="w-4 h-4" /> {t("sca.addRuleSet")}
          </button>
        </div>
      </div>

      {notice && (
        <p
          className={`text-xs ${notice.type === "success" ? "text-success" : "text-error"}`}
        >
          {notice.text}
        </p>
      )}
    </>
  );
};
