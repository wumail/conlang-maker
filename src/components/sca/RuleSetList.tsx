import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../common/ConfirmModal";
import { useSCAStore } from "../../store/scaStore";
import type { SCARule } from "../../types";
import { CARD } from "../../lib/ui";
import { SCARuleCard } from "./SCARuleCard";
import { SCARuleSetImportModal } from "./SCARuleSetImportModal";
import { SCARuleSetToolbar } from "./SCARuleSetToolbar";
import { parseRuleSetImport } from "../../lib/scaRuleSetImport";
import {
  copyTextToClipboard,
  downloadTextFile,
  safeRuleSetFileName,
  serializeAllRuleSets,
  serializeRuleSet,
} from "../../utils/scaRuleSetTransfer";

function generateId(): string {
  return `sca_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

interface PendingDeleteRule {
  rulesetId: string;
  ruleId: string;
}

export function RuleSetList() {
  const { t } = useTranslation();
  const {
    config,
    addRuleSet,
    updateRuleSet,
    deleteRuleSet,
    addRule,
    updateRule,
    deleteRule,
  } = useSCAStore();
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] =
    useState<PendingDeleteRule | null>(null);
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

  const pushTransferNotice = (type: "success" | "error", text: string) => {
    setTransferNotice({ type, text });
    window.setTimeout(() => setTransferNotice(null), 2400);
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

  const findRule = (rulesetId: string, ruleId: string): SCARule | undefined =>
    config.rule_sets
      .find((ruleSet) => ruleSet.ruleset_id === rulesetId)
      ?.rules.find((rule) => rule.rule_id === ruleId);

  const handleUpdateRule = (
    rulesetId: string,
    ruleId: string,
    field: keyof SCARule,
    value: string,
  ) => {
    const rule = findRule(rulesetId, ruleId);
    if (!rule) return;
    if (field === "exceptions") {
      updateRule(rulesetId, ruleId, {
        ...rule,
        exceptions: value
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      });
      return;
    }
    updateRule(rulesetId, ruleId, { ...rule, [field]: value });
  };

  const handlePatchRule = (rulesetId: string, ruleId: string, next: SCARule) => {
    updateRule(rulesetId, ruleId, next);
  };

  const handleToggleFeatureMode = (rulesetId: string, ruleId: string) => {
    const rule = findRule(rulesetId, ruleId);
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

  const handleCopyRuleSet = async (rulesetId: string) => {
    const ruleSet = config.rule_sets.find((item) => item.ruleset_id === rulesetId);
    if (!ruleSet) return;
    const displayName = ruleSet.name || t("sca.unnamed");
    const ok = await copyTextToClipboard(serializeRuleSet(ruleSet, t("sca.unnamed")));
    pushTransferNotice(
      ok ? "success" : "error",
      ok
        ? t("sca.copyRuleSetSuccess", { name: displayName })
        : t("sca.copyRuleSetFailed"),
    );
  };

  const handleDownloadRuleSet = (rulesetId: string) => {
    const ruleSet = config.rule_sets.find((item) => item.ruleset_id === rulesetId);
    if (!ruleSet) return;
    const displayName = ruleSet.name || t("sca.unnamed");
    const filename = `${safeRuleSetFileName(displayName)}.txt`;
    downloadTextFile(filename, serializeRuleSet(ruleSet, t("sca.unnamed")));
    pushTransferNotice("success", t("sca.downloadRuleSetSuccess", { filename }));
  };

  const handleDownloadAllRuleSets = () => {
    if (config.rule_sets.length === 0) {
      pushTransferNotice("error", t("sca.exportAllRuleSetsEmpty"));
      return;
    }
    const filename = `sca_rulesets_${new Date().toISOString().slice(0, 10)}.txt`;
    downloadTextFile(filename, serializeAllRuleSets(config.rule_sets, t("sca.unnamed")));
    pushTransferNotice("success", t("sca.downloadAllRuleSetsSuccess", { filename }));
  };

  const handleImportRuleSet = () => {
    const result = parseRuleSetImport(importText, generateId, t);
    if (result.errors.length > 0) {
      setImportErrors(result.errors);
      return;
    }

    const id = generateId();
    addRuleSet({
      ruleset_id: id,
      name:
        importRuleSetName.trim() ||
        t("sca.importRuleSetDefaultName", t("sca.newRuleSet")),
      order: config.rule_sets.length + 1,
      rules: result.rules,
    });
    setExpandedSets((prev) => new Set(prev).add(id));
    closeImportModal();
  };

  return (
    <div className={`${CARD} p-6 space-y-4`}>
      <SCARuleSetToolbar
        canExport={config.rule_sets.length > 0}
        notice={transferNotice}
        onDownloadAll={handleDownloadAllRuleSets}
        onOpenImport={openImportModal}
        onAddRuleSet={handleAddRuleSet}
      />

      {config.rule_sets.length === 0 && (
        <p className="text-base-content/50 text-sm">{t("sca.noRuleSets")}</p>
      )}

      {config.rule_sets.map((ruleSet) => (
        <SCARuleCard
          key={ruleSet.ruleset_id}
          ruleSet={ruleSet}
          expanded={expandedSets.has(ruleSet.ruleset_id)}
          onToggleExpand={() => toggleExpand(ruleSet.ruleset_id)}
          onCopy={() => void handleCopyRuleSet(ruleSet.ruleset_id)}
          onDownload={() => handleDownloadRuleSet(ruleSet.ruleset_id)}
          onRequestDelete={() => setConfirmDeleteId(ruleSet.ruleset_id)}
          onAddRule={() => handleAddRule(ruleSet.ruleset_id)}
          onRuleFieldChange={(ruleId, field, value) =>
            handleUpdateRule(ruleSet.ruleset_id, ruleId, field, value)
          }
          onPatchRule={(ruleId, next) =>
            handlePatchRule(ruleSet.ruleset_id, ruleId, next)
          }
          onToggleRuleFeatureMode={(ruleId) =>
            handleToggleFeatureMode(ruleSet.ruleset_id, ruleId)
          }
          onRequestDeleteRule={(ruleId) =>
            setConfirmDeleteRuleId({ rulesetId: ruleSet.ruleset_id, ruleId })
          }
          onReplaceRules={(rules) =>
            updateRuleSet(ruleSet.ruleset_id, { ...ruleSet, rules })
          }
        />
      ))}

      <SCARuleSetImportModal
        open={showImportModal}
        name={importRuleSetName}
        text={importText}
        errors={importErrors}
        onNameChange={setImportRuleSetName}
        onTextChange={(value) => {
          setImportText(value);
          if (importErrors.length > 0) setImportErrors([]);
        }}
        onConfirm={handleImportRuleSet}
        onClose={closeImportModal}
      />

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
        message={t("sca.deleteRuleConfirm")}
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
