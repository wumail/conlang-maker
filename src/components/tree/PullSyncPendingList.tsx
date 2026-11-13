import { useTranslation } from "react-i18next";
import type { WordEntry } from "../../types";
import { BADGE, BTN_PRIMARY } from "../../lib/ui";

export interface PendingSyncWord {
  word: WordEntry;
  mode: "add" | "update";
}

interface PullSyncPendingListProps {
  pendingSyncWords: PendingSyncWord[];
  addCount: number;
  updateCount: number;
  conflictCount: number;
  loading: boolean;
  onPullAll: () => void;
}

/** 拉取同步预览：待新增 / 待更新 / 冲突提示 + 应用按钮 */
export function PullSyncPendingList({
  pendingSyncWords,
  addCount,
  updateCount,
  conflictCount,
  loading,
  onPullAll,
}: PullSyncPendingListProps) {
  const { t } = useTranslation();

  if (pendingSyncWords.length === 0 && !loading) {
    return <p className="text-xs text-base-content/50">{t("tree.upToDate")}</p>;
  }
  if (pendingSyncWords.length === 0) return null;

  return (
    <div className="space-y-2">
      {addCount > 0 && (
        <p className="text-sm">{t("tree.newWordsAvailable", { count: addCount })}</p>
      )}
      {updateCount > 0 && (
        <p className="text-sm">{t("tree.updatedWordsAvailable", { count: updateCount })}</p>
      )}
      {conflictCount > 0 && (
        <p className="text-xs text-warning">
          {t("tree.syncConflicts", { count: conflictCount })}
        </p>
      )}
      <div className="max-h-40 overflow-y-auto space-y-1">
        {pendingSyncWords.slice(0, 20).map((item) => (
          <span key={item.word.entry_id} className={`${BADGE} mr-1`}>
            {item.word.con_word_romanized}
          </span>
        ))}
        {pendingSyncWords.length > 20 && (
          <span className="text-xs text-base-content/50">
            +{pendingSyncWords.length - 20} {t("common.more")}
          </span>
        )}
      </div>
      <button className={BTN_PRIMARY} onClick={onPullAll}>
        {t("tree.pullAndEvolve")}
      </button>
    </div>
  );
}
