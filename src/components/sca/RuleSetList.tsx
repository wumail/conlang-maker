import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
} from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { ModalPortal } from "../common/ModalPortal";
import { useSCAStore } from "../../store/scaStore";
import { SCARule as SCAType } from "../../types";
import {
  BTN_PRIMARY,
  BTN_ERROR,
  BTN_GHOST,
  BTN_GHOST_SQ,
  INPUT,
  INPUT_MONO,
  TEXTAREA,
  CARD,
  TOGGLE,
} from "../../lib/ui";
import { FeatureExprEditor, FeatureReplEditor } from "./FeatureSelector";
import {
  parseSCARulesText,
  serializeSCARuleSetForImport,
} from "../../utils/scaImportParser";

function generateId(): string {
  return `sca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function RuleSetList() {
  const { t } = useTranslation();
  const { config, addRuleSet, deleteRuleSet, addRule, updateRule, deleteRule } =
    useSCAStore();
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<{
    rulesetId: string;
    ruleId: string;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRuleSetName, setImportRuleSetName] = useState("");
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [transferNotice, setTransferNotice] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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

  const openImportModal = () => {
    setImportRuleSetName("");
    setImportText("");
    setImportErrors([]);
    setShowImportModal(true);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportErrors([]);
  };

  const pushTransferNotice = (type: "success" | "error", text: string) => {
    setTransferNotice({ type, text });
    window.setTimeout(() => setTransferNotice(null), 2400);
  };

  const downloadRuleSetText = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const safeRuleSetFileName = (name: string) => {
    const normalized = name
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    return normalized || "sca_ruleset";
  };

  const handleCopyRuleSet = async (rulesetId: string) => {
    const ruleSet = config.rule_sets.find((rs) => rs.ruleset_id === rulesetId);
    if (!ruleSet) return;

    const displayName = ruleSet.name || t("sca.unnamed");
    const content = serializeSCARuleSetForImport(displayName, ruleSet.rules);

    try {
      await navigator.clipboard.writeText(content);
      pushTransferNotice(
        "success",
        t("sca.copyRuleSetSuccess", { name: displayName }),
      );
    } catch {
      pushTransferNotice("error", t("sca.copyRuleSetFailed"));
    }
  };

  const handleDownloadRuleSet = (rulesetId: string) => {
    const ruleSet = config.rule_sets.find((rs) => rs.ruleset_id === rulesetId);
    if (!ruleSet) return;

    const displayName = ruleSet.name || t("sca.unnamed");
    const filename = `${safeRuleSetFileName(displayName)}.txt`;
    const content = serializeSCARuleSetForImport(displayName, ruleSet.rules);

    downloadRuleSetText(filename, content);
    pushTransferNotice(
      "success",
      t("sca.downloadRuleSetSuccess", { filename }),
    );
  };

  const handleDownloadAllRuleSets = () => {
    if (config.rule_sets.length === 0) {
      pushTransferNotice("error", t("sca.exportAllRuleSetsEmpty"));
      return;
    }

    const dateTag = new Date().toISOString().slice(0, 10);
    const filename = `sca_rulesets_${dateTag}.txt`;
    const header = [
      "# SCA Rule Sets Export",
      `# Total Rule Sets: ${config.rule_sets.length}`,
    ];

    const body = config.rule_sets.map((ruleSet) =>
      serializeSCARuleSetForImport(
        ruleSet.name || t("sca.unnamed"),
        ruleSet.rules,
      ),
    );

    downloadRuleSetText(filename, [...header, ...body].join("\n\n"));
    pushTransferNotice(
      "success",
      t("sca.downloadAllRuleSetsSuccess", { filename }),
    );
  };

  const handleImportRuleSet = () => {
    const parsed = parseSCARulesText(importText);

    if (parsed.rules.length === 0) {
      setImportErrors([t("sca.importRuleSetNoRules")]);
      return;
    }

    if (parsed.errors.length > 0) {
      const limited = parsed.errors.slice(0, 6).map((err) =>
        t("sca.importRuleSetErrorLine", {
          line: err.line,
          source: err.source.trim(),
        }),
      );
      if (parsed.errors.length > 6) {
        limited.push(
          t("sca.importRuleSetMoreErrors", {
            count: parsed.errors.length - 6,
          }),
        );
      }
      setImportErrors(limited);
      return;
    }

    const id = generateId();
    addRuleSet({
      ruleset_id: id,
      name:
        importRuleSetName.trim() ||
        t("sca.importRuleSetDefaultName", t("sca.newRuleSet")),
      order: config.rule_sets.length + 1,
      rules: parsed.rules.map((rule) => ({
        rule_id: generateId(),
        description: rule.description,
        target: rule.target,
        replacement: rule.replacement,
        context_before: rule.context_before,
        context_after: rule.context_after,
        exceptions: rule.exceptions,
        feature_mode: rule.feature_mode,
        target_features: rule.target_features,
        replacement_features: rule.replacement_features,
        context_before_features: rule.context_before_features,
        context_after_features: rule.context_after_features,
      })),
    });
    setExpandedSets((prev) => new Set(prev).add(id));
    closeImportModal();
  };

  return (
    <div className={`${CARD} p-6 space-y-4`}>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-base-content/80">
          {t("sca.ruleSets")}
        </h3>
        <div className="flex items-center gap-2">
          <button
            className={BTN_GHOST}
            onClick={handleDownloadAllRuleSets}
            disabled={config.rule_sets.length === 0}
          >
            <Download className="w-4 h-4" /> {t("sca.exportAllRuleSets")}
          </button>
          <button className={BTN_GHOST} onClick={openImportModal}>
            {t("sca.importRuleSet")}
          </button>
          <button className={BTN_PRIMARY} onClick={handleAddRuleSet}>
            <Plus className="w-4 h-4" /> {t("sca.addRuleSet")}
          </button>
        </div>
      </div>

      {transferNotice && (
        <p
          className={`text-xs ${
            transferNotice.type === "success" ? "text-success" : "text-error"
          }`}
        >
          {transferNotice.text}
        </p>
      )}

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
                className={BTN_GHOST_SQ}
                onClick={() => handleCopyRuleSet(rs.ruleset_id)}
                title={t("sca.copyRuleSet")}
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                className={BTN_GHOST_SQ}
                onClick={() => handleDownloadRuleSet(rs.ruleset_id)}
                title={t("sca.downloadRuleSet")}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
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
                        onClick={() =>
                          setConfirmDeleteRuleId({
                            rulesetId: rs.ruleset_id,
                            ruleId: rule.rule_id,
                          })
                        }
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

      <ModalPortal open={showImportModal}>
        <div className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <h3 className="font-bold text-lg">{t("sca.importRuleSetTitle")}</h3>
            <p className="text-xs text-base-content/60 mt-1">
              {t("sca.importRuleSetHint")}
            </p>

            <div className="space-y-2 mt-4">
              <label className="text-xs text-base-content/70">
                {t("sca.importRuleSetName")}
              </label>
              <input
                className={`${INPUT} w-full`}
                value={importRuleSetName}
                onChange={(e) => setImportRuleSetName(e.target.value)}
                placeholder={t("sca.importRuleSetNamePlaceholder")}
              />
            </div>

            <div className="space-y-2 mt-3">
              <label className="text-xs text-base-content/70">
                {t("sca.importRuleSetText")}
              </label>
              <textarea
                className={`w-full ${TEXTAREA} min-h-[220px] font-mono text-sm`}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value);
                  if (importErrors.length > 0) setImportErrors([]);
                }}
                placeholder={t("sca.importRuleSetPlaceholder")}
              />
              <p className="text-xs text-base-content/50 whitespace-pre-line">
                {t("sca.importRuleSetExample")}
              </p>
            </div>

            {importErrors.length > 0 && (
              <div className="mt-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error space-y-1">
                <p className="font-medium">
                  {t("sca.importRuleSetParseFailed")}
                </p>
                {importErrors.map((err, idx) => (
                  <p key={`${idx}_${err}`}>{err}</p>
                ))}
              </div>
            )}

            <div className="modal-action">
              <button className={BTN_PRIMARY} onClick={handleImportRuleSet}>
                {t("sca.importRuleSetConfirm")}
              </button>
              <button className={BTN_GHOST} onClick={closeImportModal}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>

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
        message={t(
          "sca.deleteRuleConfirm",
          "Are you sure you want to delete this rule?",
        )}
        onConfirm={() => {
          if (confirmDeleteRuleId) {
            deleteRule(
              confirmDeleteRuleId.rulesetId,
              confirmDeleteRuleId.ruleId,
            );
            setConfirmDeleteRuleId(null);
          }
        }}
        onCancel={() => setConfirmDeleteRuleId(null)}
      />
    </div>
  );
}
