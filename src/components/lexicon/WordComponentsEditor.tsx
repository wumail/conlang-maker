import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, RefreshCw, AlertTriangle } from "lucide-react";
import type { CompoundRelation, Etymology, WordEntry } from "../../types";
import { computeComponentsDigest, wouldIntroduceCycle } from "../../core/engines/wordFamily";
import { useGrammarStore } from "../../store/grammarStore";
import { INPUT, SELECT, BTN_LINK, BTN_GHOST_SQ, BTN_ERROR, BADGE } from "../../lib/ui";
import { useCompoundRelationLabels } from "../../lib/labelMaps";

const RELATIONS: CompoundRelation[] = ["root", "modifier", "head", "affix", "reduplicant"];

interface WordComponentsEditorProps {
  word: WordEntry;
  wordsMap: Record<string, WordEntry>;
  onChange: (field: keyof WordEntry, value: WordEntry[keyof WordEntry]) => void;
}

/** 共时构词成分编辑器（DAG，含环检测与读音摘要刷新） */
export const WordComponentsEditor: React.FC<WordComponentsEditorProps> = ({
  word,
  wordsMap,
  onChange,
}) => {
  const { t } = useTranslation();
  const relationLabels = useCompoundRelationLabels();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [affixRuleId, setAffixRuleId] = useState("");
  const derivationRules = useGrammarStore((s) => s.config.derivation_rules);
  const affixRules = useMemo(
    () => derivationRules.filter((rule) => rule.affix.trim().length > 0),
    [derivationRules],
  );
  const components = word.etymology?.components ?? [];

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const used = new Set(components.map((component) => component.entry_id));
    return Object.values(wordsMap)
      .filter(
        (candidate) =>
          candidate.entry_id !== word.entry_id &&
          !used.has(candidate.entry_id) &&
          candidate.con_word_romanized.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [query, wordsMap, word.entry_id, components]);

  const commit = (next: Etymology) => {
    onChange("etymology", {
      ...next,
      components: next.components,
      compounds_stale_digest: computeComponentsDigest(next.components ?? [], wordsMap),
    });
  };

  /** 当前成分的实时读音摘要；与已保存摘要不一致说明上游成分读音已变 */
  const liveDigest = useMemo(
    () => computeComponentsDigest(components, wordsMap),
    [components, wordsMap],
  );
  const storedDigest = word.etymology?.compounds_stale_digest ?? "";
  const isStale =
    components.length > 0 && storedDigest !== "" && storedDigest !== liveDigest;

  /** 一键同步核验摘要（复用 refreshDigest 的 commit 逻辑） */
  const refreshDigest = () => commit({ ...(word.etymology as Etymology) });

  const addComponent = (entryId: string) => {
    if (wouldIntroduceCycle(word.entry_id, entryId, wordsMap)) {
      setError(t("lexicon.family.cycleBlocked"));
      return;
    }
    setError(null);
    setQuery("");
    commit({
      ...(word.etymology as Etymology),
      origin_type: word.etymology?.origin_type ?? "derived",
      components: [...components, { entry_id: entryId, relation: "root" }],
    });
  };

  const removeComponent = (index: number) => {
    setError(null);
    commit({
      ...(word.etymology as Etymology),
      components: components.filter((_, i) => i !== index),
    });
  };

  const setRelation = (index: number, relation: CompoundRelation) => {
    commit({
      ...(word.etymology as Etymology),
      components: components.map((component, i) =>
        i === index ? { ...component, relation } : component,
      ),
    });
  };

  /** 追加词缀成分：记录派生规则 ID 与其表层形式，供词源链展示 */
  const addAffixComponent = (ruleId: string) => {
    const rule = affixRules.find((candidate) => candidate.rule_id === ruleId);
    if (!rule) return;
    setAffixRuleId("");
    commit({
      ...(word.etymology as Etymology),
      origin_type: word.etymology?.origin_type ?? "derived",
      components: [
        ...components,
        {
          relation: "affix",
          derivation_rule_id: rule.rule_id,
          surface_override: rule.affix,
        },
      ],
    });
  };

  return (
    <div className="space-y-2">
      {isStale && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning-content">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">{t("lexicon.family.staleWarning")}</span>
          <button className={`${BTN_LINK} text-[11px]`} onClick={refreshDigest}>
            <RefreshCw size={11} /> {t("lexicon.family.refreshDigest")}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-base-content/60">
          {t("lexicon.family.components")}
        </span>
        <span className="text-[10px] text-base-content/40">
          {t("lexicon.family.componentsHint")}
        </span>
      </div>

      {components.length > 0 && (
        <ul className="space-y-1">
          {components.map((component, index) => {
            const target = component.entry_id ? wordsMap[component.entry_id] : undefined;
            return (
              <li key={`${component.entry_id ?? "surface"}_${index}`} className="flex items-center gap-1.5">
                <span className="font-mono text-sm">
                  {target?.con_word_romanized ?? component.surface_override ?? "?"}
                </span>
                {component.entry_id && !target && (
                  <span className={`${BADGE} badge-xs badge-error`}>{t("lexicon.family.missing")}</span>
                )}
                <select
                  className={`${SELECT} select-xs`}
                  value={component.relation}
                  onChange={(event) => setRelation(index, event.target.value as CompoundRelation)}
                >
                  {RELATIONS.map((relation) => (
                    <option key={relation} value={relation}>
                      {relationLabels[relation] ?? relation}
                    </option>
                  ))}
                </select>
                <button
                  className={BTN_ERROR}
                  onClick={() => removeComponent(index)}
                  title={t("common.delete")}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative flex items-center gap-1">
        <input
          className={`${INPUT} h-7 flex-1 text-xs`}
          placeholder={t("lexicon.family.addPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && candidates[0]) addComponent(candidates[0].entry_id);
          }}
        />
        {components.length > 0 && (
          <button
            className={BTN_GHOST_SQ}
            title={t("lexicon.family.refreshDigest")}
            onClick={refreshDigest}
          >
            <RefreshCw size={12} />
          </button>
        )}
        {candidates.length > 0 && (
          <div className="absolute left-0 top-8 z-20 w-full overflow-hidden rounded border border-base-300 bg-base-100 shadow">
            {candidates.map((candidate) => (
              <button
                key={candidate.entry_id}
                type="button"
                onClick={() => addComponent(candidate.entry_id)}
                className="flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs hover:bg-base-200"
              >
                <span className="font-mono">{candidate.con_word_romanized}</span>
                <span className="truncate text-base-content/50">
                  {candidate.senses[0]?.gloss ?? ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      {affixRules.length > 0 && (
        <div className="flex items-center gap-1">
          <select
            className={`${SELECT} select-xs flex-1`}
            value={affixRuleId}
            onChange={(event) => setAffixRuleId(event.target.value)}
          >
            <option value="">{t("lexicon.family.addAffixPlaceholder")}</option>
            {affixRules.map((rule) => (
              <option key={rule.rule_id} value={rule.rule_id}>
                {rule.affix} · {rule.name || rule.rule_id}
              </option>
            ))}
          </select>
          <button
            className={BTN_GHOST_SQ}
            type="button"
            disabled={!affixRuleId}
            title={t("lexicon.family.components")}
            onClick={() => addAffixComponent(affixRuleId)}
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {components.length > 0 && (
        <p className="flex items-center gap-1 text-[10px] text-base-content/40">
          <Plus size={9} />
          {t("lexicon.family.digestHint", {
            digest: word.etymology?.compounds_stale_digest ?? "—",
          })}
          <button className={`${BTN_LINK} text-[10px]`} onClick={refreshDigest}>
            {t("lexicon.family.refreshDigest")}
          </button>
        </p>
      )}
    </div>
  );
};
