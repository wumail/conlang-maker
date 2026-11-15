/**
 * LexiconTableModal.tsx — 词典表格视图弹窗
 *
 * 表格视图不再占用右侧详情面板，改为从词典标题旁的「表格」按钮打开，
 * 内容复用 `LexiconTableView`（虚拟行、列显隐、行内编辑、TSV 粘贴）。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Table2, X } from "lucide-react";
import { ModalPortal } from "../common/ModalPortal";
import { BTN_GHOST } from "../../lib/ui";
import { LexiconTableView } from "./LexiconTableView";

interface LexiconTableModalProps {
  open: boolean;
  onClose: () => void;
  onOpenPaste: () => void;
}

export const LexiconTableModal: React.FC<LexiconTableModalProps> = ({
  open,
  onClose,
  onOpenPaste,
}) => {
  const { t } = useTranslation();

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box flex h-[90vh] w-[96vw] max-w-[1600px] flex-col gap-2 p-0">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-base-200 px-4 py-2">
            <div className="flex items-center gap-2">
              <Table2 size={18} className="text-primary" />
              <span className="font-semibold">{t("lexicon.table.viewTable")}</span>
            </div>
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              <X size={16} />
              {t("common.close")}
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col pb-2">
            {/* onClose 透传：行级「定位到详情」需要先收起弹窗才能看到右侧详情面板 */}
            <LexiconTableView onOpenPaste={onOpenPaste} onClose={onClose} />
          </div>
        </div>
        <div className="modal-backdrop" onClick={onClose} />
      </div>
    </ModalPortal>
  );
};
