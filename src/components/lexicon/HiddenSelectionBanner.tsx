/**
 * HiddenSelectionBanner.tsx — 隐藏选中项提示条（Roadmap v3 / Pillar 2）
 *
 * 批量编辑时若选中集合包含被当前筛选隐藏的词条，明确提示数量并支持一键清除。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { EyeOff } from "lucide-react";

interface HiddenSelectionBannerProps {
  selectedCount: number;
  hiddenCount: number;
  onClearHidden: () => void;
}

export const HiddenSelectionBanner: React.FC<HiddenSelectionBannerProps> = ({
  selectedCount,
  hiddenCount,
  onClearHidden,
}) => {
  const { t } = useTranslation();
  if (hiddenCount <= 0) return null;

  return (
    <div className="mx-3 mb-1 flex items-center gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning-content">
      <EyeOff size={12} className="shrink-0" />
      <span className="flex-1">
        {t("lexicon.batchV3.hiddenSelectedBanner", {
          selected: selectedCount,
          hidden: hiddenCount,
        })}
      </span>
      <button type="button" className="underline" onClick={onClearHidden}>
        {t("lexicon.batchV3.clearHiddenSelection")}
      </button>
    </div>
  );
};
