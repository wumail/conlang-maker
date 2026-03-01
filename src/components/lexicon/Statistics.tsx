import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { computeStatistics } from "../../utils/statistics";
import { analyzeTypology } from "../../utils/typologyAnalyzer";
import { BarChart3 } from "lucide-react";
import { BADGE, SECTION_HEADER } from "../../lib/ui";
import { PageHeader } from "../common/PageHeader";

export const Statistics: React.FC = () => {
  const { t } = useTranslation();
  const wordsMap = useLexiconStore((s) => s.wordsMap);
  const phonoConfig = usePhonoStore((s) => s.config);
  const grammarConfig = useGrammarStore((s) => s.config);

  const words = useMemo(() => Object.values(wordsMap), [wordsMap]);
  const stats = useMemo(
    () => computeStatistics(words, phonoConfig, grammarConfig),
    [words, phonoConfig, grammarConfig],
  );
  const typologyEst = useMemo(
    () => analyzeTypology(words, grammarConfig),
    [words, grammarConfig],
  );

  const maxPosCount = Math.max(1, ...stats.posDistribution.map((d) => d.count));
  const maxPhonemeCount = Math.max(
    1,
    ...stats.phonemeFrequency.slice(0, 30).map((f) => f.count),
  );
  const maxCharCount = Math.max(
    1,
    ...stats.charFrequency.slice(0, 30).map((f) => f.count),
  );

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        icon={<BarChart3 size={20} />}
        title={t("statistics.title")}
        size="md"
      />

      {/* Total */}
      <div className="text-3xl font-bold text-primary">
        {stats.totalWords}{" "}
        <span className="text-base font-normal text-base-content/60">
          {t("statistics.totalWords")}
        </span>
      </div>

      {/* POS Distribution */}
      <section>
        <h3 className={SECTION_HEADER}>{t("statistics.byPos")}</h3>
        <div className="space-y-1">
          {stats.posDistribution.map((d) => (
            <div key={d.posId} className="flex items-center gap-2 text-sm">
              <span className="w-24 text-base-content/80 truncate">
                {d.posName}
              </span>
              <div className="flex-1 h-5 bg-base-200 rounded overflow-hidden">
                <div
                  className="h-full bg-primary/60 rounded"
                  style={{ width: `${(d.count / maxPosCount) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono text-xs">
                {d.count}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Phoneme Frequency */}
      <section>
        <h3 className={SECTION_HEADER}>{t("statistics.phonemeFrequency")}</h3>
        <div className="flex flex-wrap gap-1">
          {stats.phonemeFrequency.slice(0, 30).map((f) => (
            <div
              key={f.char}
              className="text-center"
              title={`${f.count} (${f.percentage.toFixed(1)}%)`}
            >
              <div
                className="w-8 bg-base-200 rounded-t relative"
                style={{
                  height: `${Math.max(4, (f.count / maxPhonemeCount) * 60)}px`,
                }}
              >
                <div
                  className="absolute bottom-0 w-full bg-primary rounded-t"
                  style={{ height: `${(f.count / maxPhonemeCount) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono block mt-0.5">{f.char}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Character Frequency */}
      <section>
        <h3 className={SECTION_HEADER}>{t("statistics.charFrequency")}</h3>
        <div className="flex flex-wrap gap-1">
          {stats.charFrequency.slice(0, 30).map((f) => (
            <div
              key={f.char}
              className="text-center"
              title={`${f.count} (${f.percentage.toFixed(1)}%)`}
            >
              <div
                className="w-8 bg-base-200 rounded-t relative"
                style={{
                  height: `${Math.max(4, (f.count / maxCharCount) * 60)}px`,
                }}
              >
                <div
                  className="absolute bottom-0 w-full bg-emerald-400 rounded-t"
                  style={{ height: `${(f.count / maxCharCount) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono block mt-0.5">{f.char}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Bigram Heatmap */}
      <section>
        <h3 className={SECTION_HEADER}>{t("statistics.bigramHeatmap")}</h3>
        <div className="flex flex-wrap gap-1">
          {stats.bigramFrequency.slice(0, 40).map((b) => {
            const maxBi = stats.bigramFrequency[0]?.count ?? 1;
            const intensity = Math.min(1, b.count / maxBi);
            return (
              <span
                key={b.bigram}
                className="font-mono text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: `rgba(99, 102, 241, ${0.1 + intensity * 0.9})`,
                  color: intensity > 0.5 ? "white" : "inherit",
                }}
                title={`${b.bigram}: ${b.count}`}
              >
                {b.bigram}
              </span>
            );
          })}
        </div>
      </section>

      {/* Syllable Distribution */}
      {stats.syllableDistribution.length > 0 && (
        <section>
          <h3 className={SECTION_HEADER}>
            {t("statistics.syllableDistribution")}
          </h3>
          <div className="flex items-end gap-2">
            {stats.syllableDistribution.map((s) => (
              <div key={s.syllableCount} className="text-center">
                <div
                  className="w-10 bg-base-200 rounded-t relative"
                  style={{ height: `${Math.max(8, s.percentage * 2)}px` }}
                >
                  <div
                    className="absolute bottom-0 w-full bg-violet-400 rounded-t"
                    style={{ height: "100%" }}
                  />
                </div>
                <span className="text-xs font-mono block mt-0.5">
                  {s.syllableCount}
                </span>
                <span className="text-[10px] text-base-content/50">
                  {s.percentage.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Romanization Lookup Table */}
      {stats.romanizationLookup.length > 0 && (
        <section>
          <h3 className={SECTION_HEADER}>
            {t("statistics.romanizationLookup")}
          </h3>
          <div className="flex flex-wrap gap-1">
            {stats.romanizationLookup.map((r, i) => (
              <span
                key={i}
                className="font-mono text-xs px-2 py-1 rounded bg-base-200 border border-base-300"
              >
                <span className="font-bold">{r.input}</span>
                <span className="text-base-content/50 mx-1">→</span>
                <span className="text-primary">{r.phoneme}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Typology Analysis */}
      <section>
        <h3 className={SECTION_HEADER}>{t("typology.analysisTitle")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-info/10 rounded-lg border border-info/20">
            <div className="text-xs text-base-content/60 mb-1">
              {t("typology.morphologicalType")}
            </div>
            <div className="flex items-center gap-2">
              <span className={`${BADGE} badge-primary font-semibold`}>
                {t(
                  `typology.types.${grammarConfig.typology.morphological_type}`,
                )}
              </span>
              <span className={`${BADGE} badge-ghost`}>
                {grammarConfig.typology.auto_estimated
                  ? t("typology.autoEstimated")
                  : t("typology.manualMode")}
              </span>
            </div>
          </div>

          <div className="p-3 bg-secondary/10 rounded-lg border border-secondary/20">
            <div className="text-xs text-base-content/60 mb-1">
              {t("typology.headMarking")}
            </div>
            <span className={`${BADGE} badge-secondary font-semibold`}>
              {t(
                `typology.headMarkingOptions.${grammarConfig.typology.head_marking}`,
              )}
            </span>
          </div>

          <div className="p-3 bg-success/10 rounded-lg border border-success/20">
            <div className="text-xs text-base-content/60 mb-1">
              {t("typology.estimatedSynthesis")}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-success">
                {typologyEst.synthesis_index.toFixed(1)}
              </span>
              <span className="text-xs text-base-content/50">
                {t("typology.morphemesPerWord")}
              </span>
            </div>
            {grammarConfig.typology.auto_estimated ? null : (
              <div className="text-xs text-base-content/50 mt-1">
                {t("typology.manualMode")}:{" "}
                {grammarConfig.typology.synthesis_index.toFixed(1)}
              </div>
            )}
          </div>

          <div className="p-3 bg-warning/10 rounded-lg border border-warning/20">
            <div className="text-xs text-base-content/60 mb-1">
              {t("typology.estimatedFusion")}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-warning">
                {typologyEst.fusion_index.toFixed(1)}
              </span>
              <span className="text-xs text-base-content/50">
                {t("typology.meaningsPerAffix")}
              </span>
            </div>
            {grammarConfig.typology.auto_estimated ? null : (
              <div className="text-xs text-base-content/50 mt-1">
                {t("typology.manualMode")}:{" "}
                {grammarConfig.typology.fusion_index.toFixed(1)}
              </div>
            )}
          </div>
        </div>

        {words.length === 0 && (
          <p className="text-sm text-base-content/50 italic mt-2">
            {t("typology.noDataForAnalysis")}
          </p>
        )}
      </section>
    </div>
  );
};
