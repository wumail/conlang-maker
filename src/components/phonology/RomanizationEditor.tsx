import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { RomanizationMap, RomanizationRule } from "../../types";
import { Plus, Trash2, ChevronDown, ChevronRight, Code2 } from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import { BTN_PRIMARY, BTN_ERROR, BTN_LINK, BADGE } from "../../lib/ui";
import { RuleTable } from "./RuleTable";
import {
  RomanizationLintBanner,
  buildRuleLintIndex,
} from "./RomanizationLintBanner";
import { analyzeRomanization } from "../../core/engines/romanizationLint";
import {
  parseRomanizationDsl,
  serializeRomanizationDsl,
} from "../../core/engines/ruleDsl";
import { RuleDslEditor } from "../common/RuleDslEditor";

const emptyRule = (): RomanizationRule => ({
  rule_id: crypto.randomUUID(),
  input: "",
  output_phoneme: "",
  context_before: "",
  context_after: "",
});

export const RomanizationEditor: React.FC = () => {
  const { t } = useTranslation();
  const {
    config,
    addRomanizationMap,
    updateRomanizationMap,
    deleteRomanizationMap,
  } = usePhonoStore();
  const maps = config.romanization_maps;
  const inventory = config.phoneme_inventory;
  const [expandedMapId, setExpandedMapId] = useState<string | null>(
    maps[0]?.map_id ?? null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [dslMapId, setDslMapId] = useState<string | null>(null);

  // 映射表与音素表变化时实时重算静态诊断（纯函数，6 类检查）
  const analysis = useMemo(
    () => analyzeRomanization(config, { mapScope: "all" }),
    [config],
  );
  const lintIndex = useMemo(() => buildRuleLintIndex(analysis), [analysis]);

  const handleAddMap = () => {
    const newMap: RomanizationMap = {
      map_id: crypto.randomUUID(),
      name: `${t("phonology.romanization.map")} ${maps.length + 1}`,
      is_default: maps.length === 0,
      rules: [],
    };
    addRomanizationMap(newMap);
    setExpandedMapId(newMap.map_id);
  };

  const handleDeleteMap = (mapId: string) => {
    deleteRomanizationMap(mapId);
    if (expandedMapId === mapId) setExpandedMapId(null);
    setConfirmDeleteId(null);
  };

  const handleAddRule = (map: RomanizationMap) => {
    updateRomanizationMap(map.map_id, {
      ...map,
      rules: [...map.rules, emptyRule()],
    });
  };

  const handleUpdateRule = (
    map: RomanizationMap,
    ruleIdx: number,
    patch: Partial<RomanizationRule>,
  ) => {
    const newRules = [...map.rules];
    newRules[ruleIdx] = { ...newRules[ruleIdx], ...patch };
    updateRomanizationMap(map.map_id, { ...map, rules: newRules });
  };

  const handleDeleteRule = (map: RomanizationMap, ruleIdx: number) => {
    const newRules = map.rules.filter((_, i) => i !== ruleIdx);
    updateRomanizationMap(map.map_id, { ...map, rules: newRules });
  };

  const handleSetDefault = (mapId: string) => {
    maps.forEach((m) => {
      updateRomanizationMap(m.map_id, { ...m, is_default: m.map_id === mapId });
    });
  };

  const handleMapNameChange = (map: RomanizationMap, name: string) => {
    updateRomanizationMap(map.map_id, { ...map, name });
  };

  // Auto-sort rules: longest input first (greedy matching priority)
  const handleSortRules = (map: RomanizationMap) => {
    const sorted = [...map.rules].sort(
      (a, b) => b.input.length - a.input.length,
    );
    updateRomanizationMap(map.map_id, { ...map, rules: sorted });
  };

  return (
    <div className="bg-base-100 p-6 min-w-[900px] flex-1">
      <div className="mb-4">
        <RomanizationLintBanner analysis={analysis} />
      </div>
      <div className="flex justify-end items-center mb-4">
        <button onClick={handleAddMap} className={BTN_PRIMARY}>
          <Plus size={16} /> {t("phonology.romanization.addMap")}
        </button>
      </div>

      {maps.length === 0 && (
        <EmptyState message={t("phonology.romanization.noMaps")} />
      )}

      <div className="space-y-3">
        {maps.map((map) => (
          <div key={map.map_id} className="border border-base-300 rounded-lg">
            {/* Map header */}
            <div
              className="flex items-center justify-between p-3 bg-base-200/50 cursor-pointer hover:bg-base-200 rounded-t-lg"
              onClick={() =>
                setExpandedMapId(
                  expandedMapId === map.map_id ? null : map.map_id,
                )
              }
            >
              <div className="flex items-center gap-2 min-w-0">
                {expandedMapId === map.map_id ? (
                  <ChevronDown size={16} />
                ) : (
                  <ChevronRight size={16} />
                )}
                <input
                  type="text"
                  value={map.name}
                  onChange={(e) => handleMapNameChange(map, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-0 bg-transparent border-b border-transparent hover:border-base-300 focus:border-primary outline-none font-semibold text-base-content"
                />
                {map.is_default && (
                  <span className={`${BADGE} badge-info shrink-0 whitespace-nowrap`}>
                    {t("common.default")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!map.is_default && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetDefault(map.map_id);
                    }}
                    className={BTN_LINK}
                  >
                    {t("common.setDefault")}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDslMapId(map.map_id);
                  }}
                  className={BTN_LINK}
                  title={t("ruleDsl.open")}
                >
                  <Code2 size={13} /> DSL
                </button>
                {confirmDeleteId === map.map_id ? null : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(map.map_id);
                    }}
                    className={BTN_ERROR}
                    title={t("common.delete")}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Map rules */}
            {expandedMapId === map.map_id && (
              <RuleTable
                map={map}
                consonants={inventory.consonants}
                vowels={inventory.vowels}
                onUpdateRule={handleUpdateRule}
                onAddRule={handleAddRule}
                onDeleteRule={handleDeleteRule}
                onSortRules={handleSortRules}
                lintIndex={lintIndex}
              />
            )}
          </div>
        ))}
      </div>

      <RuleDslEditor
        open={dslMapId !== null}
        title={t("ruleDsl.romanizationTitle")}
        hint={t("ruleDsl.romanizationHint")}
        initialText={serializeRomanizationDsl(
          maps.find((map) => map.map_id === dslMapId)?.rules ?? [],
        )}
        parse={parseRomanizationDsl}
        onApply={(rules) => {
          const target = maps.find((map) => map.map_id === dslMapId);
          if (target) updateRomanizationMap(target.map_id, { ...target, rules });
        }}
        onClose={() => setDslMapId(null)}
      />

      <ConfirmModal
        open={!!confirmDeleteId}
        title={t("common.delete")}
        message={t("phonology.romanization.deleteMapConfirm")}
        onConfirm={() => {
          if (confirmDeleteId) handleDeleteMap(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};
