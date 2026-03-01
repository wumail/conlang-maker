import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { useSCAStore } from "../../store/scaStore";
import { SCARule as SCAType } from "../../types";
import {
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST,
  INPUT,
  INPUT_MONO,
  CARD,
  TOGGLE,
} from "../../lib/ui";
import { FeatureExprEditor, FeatureReplEditor } from "./FeatureSelector";

function generateId(): string {
  return `sca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function RuleSetList() {
  const { t } = useTranslation();
  const { config, addRuleSet, deleteRuleSet, addRule, updateRule, deleteRule } =
    useSCAStore();
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<{ rulesetId: string, ruleId: string } | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedSets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddRuleSet = () => {
    const id = generateId();
    addRuleSet({
      ruleset_id: id,
      name: t("sca.newRuleSet"),
      order: config.rule_sets.length + 1,
      rules: [],
    });
    setExpandedSets((prev) => new Set(prev).add(id));
  };

  const handleAddRule = (rulesetId: string) => {
    addRule(rulesetId, {
      rule_id: generateId(),
      description: "",
      target: "",
      replacement: "",
      context_before: "",
      context_after: "",
      exceptions: [],
      feature_mode: false,
      target_features: null,
      replacement_features: null,
      context_before_features: null,
      context_after_features: null,
    });
  };

  const handleUpdateRule = (
    rulesetId: string,
    ruleId: string,
    field: keyof SCAType,
    value: string,
  ) => {
    const ruleSet = config.rule_sets.find((rs) => rs.ruleset_id === rulesetId);
    const rule = ruleSet?.rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;

    if (field === "exceptions") {
      updateRule(rulesetId, ruleId, {
        ...rule,
        exceptions: value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    } else {
      updateRule(rulesetId, ruleId, { ...rule, [field]: value });
    }
  };

  const handleToggleFeatureMode = (rulesetId: string, ruleId: string) => {
    const ruleSet = config.rule_sets.find((rs) => rs.ruleset_id === rulesetId);
    const rule = ruleSet?.rules.find((r) => r.rule_id === ruleId);
    if (!rule) return;
    updateRule(rulesetId, ruleId, {
      ...rule,
      feature_mode: !rule.feature_mode,
      target_features: rule.target_features || { positive: [], negative: [] },
      replacement_features: rule.replacement_features || {
        set_features: [],
        remove_features: [],
      },
      context_before_features: rule.context_before_features || {
        positive: [],
        negative: [],
      },
      context_after_features: rule.context_after_features || {
        positive: [],
        negative: [],
      },
    });
  };

  return (
    <div className={`${CARD} p-6 space-y-4`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base-content/80">
          {t("sca.ruleSets")}
        </h3>
        <button className={BTN_PRIMARY} onClick={handleAddRuleSet}>
          <Plus className="w-4 h-4" /> {t("sca.addRuleSet")}
        </button>
      </div>

      {config.rule_sets.length === 0 && (
        <p className="text-base-content/50 text-sm">{t("sca.noRuleSets")}</p>
      )}

      {config.rule_sets.map((rs) => (
        <div key={rs.ruleset_id} className="border border-base-200 rounded-lg">
          <div className="p-4">
            <div className="flex items-center gap-2">
              <button
                className={BTN_GHOST}
                onClick={() => toggleExpand(rs.ruleset_id)}
                title={t("sca.toggleExpand")}
              >
                {expandedSets.has(rs.ruleset_id) ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
              <span className="font-medium text-sm flex-1">
                {rs.name || t("sca.unnamed")}
              </span>
              <span className="text-xs text-base-content/50">#{rs.order}</span>
              <button
                className={BTN_ERROR}
                onClick={() => setConfirmDeleteId(rs.ruleset_id)}
                title={t("sca.deleteRuleSet")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {expandedSets.has(rs.ruleset_id) && (
              <div className="mt-3 space-y-3">
                {rs.rules.map((rule) => (
                  <div
                    key={rule.rule_id}
                    className="border border-base-200 rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        className={`${INPUT} flex-1 text-sm`}
                        placeholder={t("sca.descriptionPlaceholder")}
                        value={rule.description}
                        onChange={(e) =>
                          handleUpdateRule(
                            rs.ruleset_id,
                            rule.rule_id,
                            "description",
                            e.target.value,
                          )
                        }
                      />
                      <label className="flex items-center gap-1 text-xs text-base-content/60 whitespace-nowrap">
                        <input
                          type="checkbox"
                          className={TOGGLE}
                          checked={!!rule.feature_mode}
                          onChange={() =>
                            handleToggleFeatureMode(rs.ruleset_id, rule.rule_id)
                          }
                        />
                        {t("sca.featureMode")}
                      </label>
                      <button
                        className={BTN_ERROR}
                        onClick={() => setConfirmDeleteRuleId({ rulesetId: rs.ruleset_id, ruleId: rule.rule_id })}
                        title={t("sca.deleteRule")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {rule.feature_mode ? (
                      <div className="space-y-2">
                        <FeatureExprEditor
                          label={t("sca.targetFeatures")}
                          value={rule.target_features}
                          onChange={(val) =>
                            updateRule(rs.ruleset_id, rule.rule_id, {
                              ...rule,
                              target_features: val,
                            })
                          }
                        />
                        <FeatureReplEditor
                          label={t("sca.replacementFeatures")}
                          value={rule.replacement_features}
                          onChange={(val) =>
                            updateRule(rs.ruleset_id, rule.rule_id, {
                              ...rule,
                              replacement_features: val,
                            })
                          }
                        />
                        <FeatureExprEditor
                          label={t("sca.contextBeforeFeatures")}
                          value={rule.context_before_features}
                          onChange={(val) =>
                            updateRule(rs.ruleset_id, rule.rule_id, {
                              ...rule,
                              context_before_features: val,
                            })
                          }
                        />
                        <FeatureExprEditor
                          label={t("sca.contextAfterFeatures")}
                          value={rule.context_after_features}
                          onChange={(val) =>
                            updateRule(rs.ruleset_id, rule.rule_id, {
                              ...rule,
                              context_after_features: val,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-base-content/60">
                            {t("sca.target")}
                          </label>
                          <input
                            className={`${INPUT_MONO} w-full text-sm`}
                            placeholder="p t k"
                            value={rule.target}
                            onChange={(e) =>
                              handleUpdateRule(
                                rs.ruleset_id,
                                rule.rule_id,
                                "target",
                                e.target.value,
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-base-content/60">
                            {t("sca.replacement")}
                          </label>
                          <input
                            className={`${INPUT_MONO} w-full text-sm`}
                            placeholder="b d g"
                            value={rule.replacement}
                            onChange={(e) =>
                              handleUpdateRule(
                                rs.ruleset_id,
                                rule.rule_id,
                                "replacement",
                                e.target.value,
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-base-content/60">
                            {t("sca.contextBefore")}
                          </label>
                          <input
                            className={`${INPUT_MONO} w-full text-sm`}
                            placeholder="V"
                            value={rule.context_before}
                            onChange={(e) =>
                              handleUpdateRule(
                                rs.ruleset_id,
                                rule.rule_id,
                                "context_before",
                                e.target.value,
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-xs text-base-content/60">
                            {t("sca.contextAfter")}
                          </label>
                          <input
                            className={`${INPUT_MONO} w-full text-sm`}
                            placeholder="V"
                            value={rule.context_after}
                            onChange={(e) =>
                              handleUpdateRule(
                                rs.ruleset_id,
                                rule.rule_id,
                                "context_after",
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  className={BTN_GHOST}
                  onClick={() => handleAddRule(rs.ruleset_id)}
                >
                  <Plus className="w-4 h-4" /> {t("sca.addRule")}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}

      <ConfirmModal
        open={!!confirmDeleteId}
        title={t("common.delete")}
        message={t("sca.deleteRuleSetConfirm")}
        onConfirm={() => {
          if (confirmDeleteId) deleteRuleSet(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ConfirmModal
        open={!!confirmDeleteRuleId}
        title={t("common.delete")}
        message={t("sca.deleteRuleConfirm", "Are you sure you want to delete this rule?")}
        onConfirm={() => {
          if (confirmDeleteRuleId) {
            deleteRule(confirmDeleteRuleId.rulesetId, confirmDeleteRuleId.ruleId);
            setConfirmDeleteRuleId(null);
          }
        }}
        onCancel={() => setConfirmDeleteRuleId(null)}
      />
    </div>
  );
}
