/**
 * ExportPresetCards.tsx — 四大场景化导出预设（Roadmap v3 / Pillar 7）
 *
 * 参考语法书 / 检索词典 / 语料文集 / 完整备份；
 * 词典预设支持「排除废弃古词」与按标签过滤。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Archive, BookOpen, BookType, FileText } from "lucide-react";
import { BTN_PRIMARY, CHECKBOX, INPUT, CARD, BADGE } from "../../lib/ui";

export interface DictionaryExportOptions {
  excludeDeprecated: boolean;
  tagFilter: string;
}

interface ExportPresetCardsProps {
  onGrammarBook: () => void;
  onDictionary: (options: DictionaryExportOptions) => void;
  onCorpus: () => void;
  onBackup: () => void;
}

export const ExportPresetCards: React.FC<ExportPresetCardsProps> = ({
  onGrammarBook,
  onDictionary,
  onCorpus,
  onBackup,
}) => {
  const { t } = useTranslation();
  const [excludeDeprecated, setExcludeDeprecated] = useState(true);
  const [tagFilter, setTagFilter] = useState("");

  const cards = [
    {
      key: "grammar",
      icon: <BookType size={18} />,
      title: t("export.presets.referenceGrammarTitle"),
      desc: t("export.presets.referenceGrammarDesc"),
      run: onGrammarBook,
    },
    {
      key: "dictionary",
      icon: <BookOpen size={18} />,
      title: t("export.presets.lookupDictTitle"),
      desc: t("export.presets.lookupDictDesc"),
      run: () => onDictionary({ excludeDeprecated, tagFilter }),
    },
    {
      key: "corpus",
      icon: <FileText size={18} />,
      title: t("export.presets.corpusAnthologyTitle"),
      desc: t("export.presets.corpusAnthologyDesc"),
      run: onCorpus,
    },
    {
      key: "backup",
      icon: <Archive size={18} />,
      title: t("export.presets.fullBackupTitle"),
      desc: t("export.presets.fullBackupDesc"),
      run: onBackup,
    },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`${CARD} flex-row items-start gap-2 p-3 text-left hover:border-primary/60`}
            onClick={card.run}
          >
            <span className="text-primary">{card.icon}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{card.title}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-base-content/60">
                {card.desc}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`${BADGE} badge-ghost badge-sm`}>{t("export.presets.dictionaryOptions")}</span>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={excludeDeprecated}
            onChange={(event) => setExcludeDeprecated(event.target.checked)}
          />
          {t("export.presets.excludeDeprecated")}
        </label>
        <input
          className={`${INPUT} input-xs w-40 text-xs`}
          placeholder={t("export.presets.tagFilter")}
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
        />
        <button type="button" className={`${BTN_PRIMARY} ml-auto`} onClick={onBackup}>
          <Archive size={13} /> {t("export.presets.fullBackupTitle")}
        </button>
      </div>
    </div>
  );
};
