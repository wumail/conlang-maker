/**
 * LexiconPage — 词典主页面
 *
 * 左侧：Sidebar（词条列表）
 * 右侧：EditorPane + 顶部工具栏（质检/统计按钮）
 * 点击质检/统计按钮后弹出全屏模态框
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck, BarChart3, X } from "lucide-react";
import { Sidebar } from "../components/lexicon/Sidebar";
import { EditorPane } from "../components/lexicon/EditorPane";
import { QualityCheck } from "../components/lexicon/QualityCheck";
import { Statistics } from "../components/lexicon/Statistics";
import { BTN_GHOST } from "../lib/ui";
import { ModalPortal } from "../components/common/ModalPortal";

type ModalView = "qc" | "statistics" | null;

export function LexiconPage() {
  const { t } = useTranslation();
  const [modalView, setModalView] = useState<ModalView>(null);

  return (
    <div className="flex-1 flex overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="bg-base-200 border-base-300 shrink-0 border-b border-base-200 px-4 py-1 flex items-center gap-2 justify-end">
          <button className={BTN_GHOST} onClick={() => setModalView("qc")}>
            <ShieldCheck size={16} />
            {t("lexicon.tabs.qc")}
          </button>
          <button
            className={BTN_GHOST}
            onClick={() => setModalView("statistics")}
          >
            <BarChart3 size={16} />
            {t("lexicon.tabs.statistics")}
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-y-auto">
          <EditorPane />
        </div>
      </div>

      {/* Modal */}
      {modalView && (
        <ModalPortal open={!!modalView}>
          <div className="modal modal-open">
            <div className="modal-box max-w-4xl w-full max-h-[90vh] p-0">
              <div className="sticky top-0 z-10 bg-base-100 flex items-center justify-between px-4 py-2 border-b border-base-200">
                <span className="font-semibold">
                  {modalView === "qc"
                    ? t("lexicon.tabs.qc")
                    : t("lexicon.tabs.statistics")}
                </span>
                <button
                  className={BTN_GHOST}
                  onClick={() => setModalView(null)}
                >
                  <X size={16} />
                  {t("common.close")}
                </button>
              </div>
              <div className="overflow-y-auto max-h-[calc(90vh-3rem)]">
                {modalView === "qc" ? (
                  <QualityCheck onNavigateToWord={() => setModalView(null)} />
                ) : (
                  <Statistics />
                )}
              </div>
            </div>
            <div
              className="modal-backdrop"
              onClick={() => setModalView(null)}
            />
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
