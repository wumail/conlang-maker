/**
 * BatchDiffPreviewModal.tsx — 统一批量差异预览弹窗（Roadmap v3 / Pillar 2）
 *
 * 供 Wave 3 的词典批量编辑、概念对齐、语料重标注与 CSV 导入复用。
 * 必须通过 ModalPortal 挂载；open=false 时不渲染。
 */
import { useTranslation } from "react-i18next";
import { ModalPortal } from "./ModalPortal";
import { BTN_GHOST, BTN_PRIMARY, BTN_OUTLINE_ERROR } from "../../lib/ui";
import type { BatchDiffRow } from "../../core/workflows/batchPreview";

export interface BatchDiffPreviewModalProps {
  open: boolean;
  title: string;
  summaryText: string;
  hiddenSelectedCount?: number;
  staleRevisionDetected?: boolean;
  rows: BatchDiffRow[];
  onRefreshPreview?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BatchDiffPreviewModal({
  open,
  title,
  summaryText,
  hiddenSelectedCount,
  staleRevisionDetected,
  rows,
  onRefreshPreview,
  onConfirm,
  onCancel,
}: BatchDiffPreviewModalProps) {
  const { t } = useTranslation();

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-2xl">
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-sm opacity-80 mt-1">{summaryText}</p>

          {hiddenSelectedCount !== undefined && hiddenSelectedCount > 0 && (
            <div className="alert alert-warning text-xs mt-2 py-2">
              {t("lexicon.batchV3.hiddenSelectedBanner", {
                selected: (hiddenSelectedCount ?? 0) + rows.length,
                hidden: hiddenSelectedCount,
              })}
            </div>
          )}

          {staleRevisionDetected && (
            <div className="alert alert-error text-xs mt-2 py-2">
              <span>{t("lexicon.batchV3.staleRevisionWarning")}</span>
              {onRefreshPreview && (
                <button type="button" className={BTN_OUTLINE_ERROR} onClick={onRefreshPreview}>
                  {t("lexicon.batchV3.refreshPreview")}
                </button>
              )}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto mt-3 border border-base-300 rounded-box divide-y divide-base-200">
            {rows.map((row) => (
              <div key={row.id} className="px-3 py-2 text-sm">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium">{row.label}</span>
                  {row.sublabel && <span className="text-xs opacity-60">{row.sublabel}</span>}
                </div>
                <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                  <span className="line-through opacity-50 break-all">{row.before || "∅"}</span>
                  <span className="opacity-40">→</span>
                  <span className="break-all">{row.after || "∅"}</span>
                </div>
                {row.warning && (
                  <div className="text-xs text-warning mt-1">{row.warning}</div>
                )}
              </div>
            ))}
          </div>

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={onConfirm}
              disabled={staleRevisionDetected}
            >
              {t("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
