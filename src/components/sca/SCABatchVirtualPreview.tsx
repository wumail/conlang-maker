import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle } from "lucide-react";
import { BTN_SUCCESS } from "../../lib/ui";
import type { ScaPreviewRow } from "../../utils/scaPreviewPatch";

interface SCABatchVirtualPreviewProps {
  rows: ScaPreviewRow[];
  applied: boolean;
  onApply: () => void;
}

const ROW_GRID =
  "grid grid-cols-[100px_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2";

/**
 * 全量音变预览表：动态高度虚拟滚动替代旧版 100 条/页硬分页。
 *
 * 测量节点严格按 EXECUTION_PLAN §7.2-A 书写：只写绝对定位与 transform，
 * 行间距由内层 `pb-1` 提供，禁止写死 height / margin。
 */
export const SCABatchVirtualPreview: React.FC<SCABatchVirtualPreviewProps> = ({
  rows,
  applied,
  onApply,
}) => {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  const scopeLabel = (scope: ScaPreviewRow["scope"]): string => {
    if (scope === "lexicon") return t("sca.scopeLexicon");
    if (scope === "inflection") return t("sca.scopeInflection");
    return t("sca.scopeDerivation");
  };

  return (
    <div className="border border-base-200 rounded-lg p-4">
      <div className={`${ROW_GRID} px-1 pb-1 text-xs font-medium text-base-content/60`}>
        <div>{t("sca.scope")}</div>
        <div>{t("sca.label")}</div>
        <div>{t("sca.field")}</div>
        <div>{t("sca.original")}</div>
        <div>{t("sca.result")}</div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-base-content/50 mt-2">{t("sca.noChanges")}</p>
      ) : (
        <div ref={parentRef} className="max-h-96 overflow-y-auto contain-strict">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className={`${ROW_GRID} pb-1 text-xs font-mono bg-success/5 px-1 py-1`}>
                    <div className="text-base-content/70">{scopeLabel(row.scope)}</div>
                    <div className="truncate">{row.label}</div>
                    <div className="truncate">{row.field}</div>
                    <div className="truncate">{row.original}</div>
                    <div className="truncate font-bold">{row.result}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-base-content/60">
            {t("sca.changedCountAll", { count: rows.length })}
          </span>
          {applied ? (
            <span className="text-success text-sm flex items-center gap-1">
              <CheckCircle className="w-4 h-4" /> {t("sca.applied")}
            </span>
          ) : (
            <button className={BTN_SUCCESS} onClick={onApply}>
              <CheckCircle className="w-4 h-4" /> {t("sca.batchApplyAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
