import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { CorpusDiffScope, CorpusScaDiffItem } from "../../core/workflows/autoGloss";
import { BTN_PRIMARY, BTN_GHOST } from "../../lib/ui";

interface CorpusScaDiffPanelProps {
  items: CorpusScaDiffItem[];
  selectedCount: number;
  onToggleAll: (selected: boolean) => void;
  onToggle: (id: string) => void;
  onApply: () => void;
  onClose: () => void;
}

/** 语料级 SCA 差异预览面板（勾选后批量应用） */
export const CorpusScaDiffPanel: React.FC<CorpusScaDiffPanelProps> = ({
  items,
  selectedCount,
  onToggleAll,
  onToggle,
  onApply,
  onClose,
}) => {
  const { t } = useTranslation();
  const scopeLabel = (scope: CorpusDiffScope): string =>
    scope === "originalText"
      ? t("corpus.scaDiffOriginalText")
      : scope === "lineOriginal"
        ? t("corpus.scaDiffLineOriginal")
        : t("corpus.scaDiffTokenSurface");

  return (
    <div className="relative border border-primary/30 bg-primary/5 rounded-lg p-3 space-y-2">
      <button
        className="btn btn-xs btn-circle btn-outline border-error text-error hover:bg-error/10 absolute -top-3 -right-3 bg-base-100 scale-75"
        onClick={onClose}
        title={t("common.close")}
        aria-label={t("common.close")}
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {t("corpus.scaDiffTitle", { count: items.length })}
        </div>
        <div className="flex gap-2">
          <button className={BTN_GHOST} onClick={() => onToggleAll(true)}>
            {t("common.selectAll")}
          </button>
          <button className={BTN_GHOST} onClick={() => onToggleAll(false)}>
            {t("common.deselect")}
          </button>
          <button className={BTN_PRIMARY} onClick={onApply} disabled={selectedCount === 0}>
            {t("corpus.applySelectedScaChanges", { count: selectedCount })}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-base-content/60">{t("corpus.applyScaNoChanges")}</p>
      ) : (
        <div className="max-h-60 overflow-auto border border-base-300 rounded bg-base-100">
          <table className="table table-xs w-full">
            <thead>
              <tr>
                <th />
                <th>{t("corpus.scaDiffScope")}</th>
                <th>{t("corpus.originalText")}</th>
                <th>{t("corpus.result")}</th>
                <th>{t("corpus.scaDiffContext")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((diff) => (
                <tr key={diff.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={diff.selected}
                      onChange={() => onToggle(diff.id)}
                    />
                  </td>
                  <td>{scopeLabel(diff.scope)}</td>
                  <td className="font-mono">{diff.before}</td>
                  <td className="font-mono">{diff.after}</td>
                  <td className="text-base-content/60">{diff.context}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
