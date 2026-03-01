import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { RomanizationMap, RomanizationRule } from "../../types";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { EmptyState } from "../common/EmptyState";
import { BTN_PRIMARY, BTN_ERROR, BTN_LINK, BADGE } from "../../lib/ui";
import { RuleTable } from "./RuleTable";

const emptyRule = (): RomanizationRule => ({
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
    field: keyof RomanizationRule,
    value: string,
  ) => {
    const newRules = [...map.rules];
    newRules[ruleIdx] = { ...newRules[ruleIdx], [field]: value };
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
              <div className="flex items-center gap-2">
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
                  className="bg-transparent border-b border-transparent hover:border-base-300 focus:border-primary outline-none font-semibold text-base-content"
                />
                {map.is_default && (
                  <span className={`${BADGE} badge-info`}>
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
              />
            )}
          </div>
        ))}
      </div>

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
