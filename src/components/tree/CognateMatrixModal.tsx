/**
 * CognateMatrixModal.tsx — 语系页内的同源词矩阵弹窗
 *
 * 内容复用 `CognateMatrixView`（加载全语系词典、筛选、表格、候选抽屉与追溯气泡）。
 * 仅在打开时挂载，关闭后不保留全语系扫描与监听。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Table2, X } from "lucide-react";
import { ModalPortal } from "../common/ModalPortal";
import { BTN_GHOST } from "../../lib/ui";
import { CognateMatrixView } from "./CognateMatrixView";

interface CognateMatrixModalProps {
  open: boolean;
  onClose: () => void;
}

export const CognateMatrixModal: React.FC<CognateMatrixModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box flex h-[86vh] w-[96vw] max-w-[1500px] flex-col gap-2 p-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-base-200 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Table2 size={18} className="shrink-0 text-primary" />
              <span className="shrink-0 font-semibold">{t("cognate.title")}</span>
              <span className="hidden truncate text-xs text-base-content/50 lg:inline">
                {t("cognate.description")}
              </span>
            </div>
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              <X size={16} />
              {t("common.close")}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
            <CognateMatrixView onNavigateAway={onClose} />
          </div>
        </div>
        <div className="modal-backdrop" onClick={onClose} />
      </div>
    </ModalPortal>
  );
};
