/**
 * CognateTracePopover.tsx — 同源组气泡（Roadmap v3 / Pillar 5）
 *
 * 点击矩阵单元格上的同源组徽章后，浮层列出本行属于同一同源组的全部词形，
 * 便于横向比较音变与借入替换。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type {
  CognateMatrixLanguage,
  CognateMatrixRow,
} from "../../core/engines/cognateMatrix";
import { BTN_GHOST_SQ, BADGE } from "../../lib/ui";
import { ModalPortal } from "../common/ModalPortal";

interface CognateTracePopoverProps {
  open: boolean;
  row: CognateMatrixRow | null;
  setId: string | null;
  languages: CognateMatrixLanguage[];
  onClose: () => void;
}

export const CognateTracePopover: React.FC<CognateTracePopoverProps> = ({
  open,
  row,
  setId,
  languages,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!open || !row || !setId) return null;
  const members = row.cells.filter((cell) => cell.cognateSetId === setId);
  const nameOf = (languageId: string): string =>
    languages.find((language) => language.languageId === languageId)?.name ?? languageId;

  return (
    <ModalPortal open>
      <div className="fixed bottom-6 right-6 z-[1200] w-80 rounded-lg border border-base-300 bg-base-100 p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {t("cognates.v3.tracePopoverTitle", { setId })}
        </span>
        <button type="button" className={BTN_GHOST_SQ} onClick={onClose} title={t("common.close")}>
          <X size={13} />
        </button>
      </div>
      <p className="mb-2 text-[11px] text-base-content/50">{row.glossZh || row.glossEn}</p>
      <ul className="space-y-1">
        {members.map((cell) => (
          <li
            key={cell.languageId}
            className="flex items-center justify-between gap-2 rounded bg-base-200/60 px-2 py-1 text-xs"
          >
            <span className="truncate text-base-content/60">{nameOf(cell.languageId)}</span>
            <span className="font-mono">{cell.form}</span>
            <span className="flex items-center gap-1">
              {cell.primaryReason === "manual_override" && (
                <span className={`${BADGE} badge-primary badge-xs`}>
                  {t("cognates.v3.setPrimary")}
                </span>
              )}
              <span className="font-mono text-[10px] text-base-content/40">
                {cell.formChangedFromRoot ? t("cognates.v3.filterFormChanged") : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      </div>
    </ModalPortal>
  );
};
