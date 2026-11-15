/**
 * LexiconPage — 词典主页面（Roadmap v3 / Pillar 4）
 *
 * 左侧：Sidebar（筛选 / 快捷筛选 / 批量编辑）
 * 右侧：详情视图（EditorPane）；表格视图改为弹窗，由词典标题旁的表格按钮打开。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChart3, ShieldCheck, X } from "lucide-react";
import { Sidebar } from "../components/lexicon/Sidebar";
import { EditorPane } from "../components/lexicon/EditorPane";
import { LexiconTableModal } from "../components/lexicon/LexiconTableModal";
import { LexiconTablePasteModal } from "../components/lexicon/LexiconTablePasteModal";
import { QualityCheck } from "../components/lexicon/QualityCheck";
import { Statistics } from "../components/lexicon/Statistics";
import { BTN_GHOST } from "../lib/ui";
import { ModalPortal } from "../components/common/ModalPortal";

type ModalView = "qc" | "statistics" | null;

export function LexiconPage() {
  const { t } = useTranslation();
  const [modalView, setModalView] = useState<ModalView>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  return (
    <div className="flex flex-1 overflow-hidden">
      <Sidebar onOpenTable={() => setTableOpen(true)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-end gap-1 border-b border-base-200 bg-base-200 px-4 py-1">
          <button className={BTN_GHOST} onClick={() => setModalView("qc")}>
            <ShieldCheck size={16} />
            {t("lexicon.tabs.qc")}
          </button>
          <button className={BTN_GHOST} onClick={() => setModalView("statistics")}>
            <BarChart3 size={16} />
            {t("lexicon.tabs.statistics")}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <EditorPane />
        </div>
      </div>

      {/* 惰性挂载：关闭时不执行虚拟化与写盘相关计算 */}
      {tableOpen && (
        <LexiconTableModal
          open
          onClose={() => setTableOpen(false)}
          onOpenPaste={() => setPasteOpen(true)}
        />
      )}
      {pasteOpen && <LexiconTablePasteModal open onClose={() => setPasteOpen(false)} />}

      {modalView && (
        <ModalPortal open={!!modalView}>
          <div className="modal modal-open">
            <div className="modal-box max-h-[90vh] w-full max-w-4xl p-0">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-base-200 bg-base-100 px-4 py-2">
                <span className="font-semibold">
                  {modalView === "qc" ? t("lexicon.tabs.qc") : t("lexicon.tabs.statistics")}
                </span>
                <button className={BTN_GHOST} onClick={() => setModalView(null)}>
                  <X size={16} />
                  {t("common.close")}
                </button>
              </div>
              <div className="max-h-[calc(90vh-3rem)] overflow-y-auto">
                {modalView === "qc" ? (
                  <QualityCheck onNavigateToWord={() => setModalView(null)} />
                ) : (
                  <Statistics />
                )}
              </div>
            </div>
            <div className="modal-backdrop" onClick={() => setModalView(null)} />
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
