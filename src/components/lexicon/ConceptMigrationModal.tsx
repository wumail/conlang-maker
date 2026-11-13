import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { ConceptDefinition, WordEntry } from "../../types";
import { ModalPortal } from "../common/ModalPortal";
import { BADGE, BTN_GHOST, BTN_PRIMARY, TOGGLE } from "../../lib/ui";
import { CORE_CONCEPTS } from "../../data/core_concepts";
import {
  applyConceptMigration,
  candidateKey,
  scanConceptTags,
  type ConceptMigrationResult,
  type ConceptTagStatus,
} from "../../core/workflows/conceptMigration";
import {
  useConceptMigrationStatusLabels,
  useSemanticFieldLabels,
} from "../../lib/labelMaps";

interface ConceptMigrationModalProps {
  open: boolean;
  words: readonly WordEntry[];
  customConcepts: readonly ConceptDefinition[];
  onApply: (result: ConceptMigrationResult) => void;
  onClose: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  resolved: "badge-success",
  needs_confirm: "badge-warning",
  "already-applied": "badge-ghost",
  conflict: "badge-error",
  unresolved: "badge-warning",
};

/** 可勾选的状态（conflict / already-applied 不参与迁移） */
const SELECTABLE: ReadonlySet<ConceptTagStatus> = new Set<ConceptTagStatus>([
  "resolved",
  "needs_confirm",
  "unresolved",
]);

/** 纯数字序号猜测默认不勾选，其余可迁移项默认勾选 */
function defaultChecked(status: ConceptTagStatus): boolean {
  return status === "resolved" || status === "unresolved";
}

/** 旧式概念标签迁移向导（dry-run 预览 → 勾选清理 → 应用） */
export const ConceptMigrationModal: React.FC<ConceptMigrationModalProps> = ({
  open,
  words,
  customConcepts,
  onApply,
  onClose,
}) => {
  const { t } = useTranslation();
  const statusLabels = useConceptMigrationStatusLabels();
  const fieldLabels = useSemanticFieldLabels();
  const [stripTags, setStripTags] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const plan = useMemo(
    () => (open ? scanConceptTags(words, customConcepts) : null),
    [open, words, customConcepts],
  );

  const checkedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!plan) return keys;
    for (const candidate of plan.candidates) {
      if (!SELECTABLE.has(candidate.status)) continue;
      const key = candidateKey(candidate);
      const checked = overrides[key] ?? defaultChecked(candidate.status);
      if (checked) keys.add(key);
    }
    return keys;
  }, [plan, overrides]);

  const preview = useMemo(() => {
    if (!plan || !open) return null;
    return applyConceptMigration(words, plan, { stripTags, applyKeys: checkedKeys });
  }, [plan, words, stripTags, open, checkedKeys]);

  const fieldById = useMemo(() => {
    const map = new Map<string, string>();
    for (const concept of [...CORE_CONCEPTS, ...customConcepts]) {
      map.set(concept.concept_id, concept.semantic_field);
    }
    return map;
  }, [customConcepts]);

  const bindable = checkedKeys.size;

  const toggle = (key: string, checked: boolean) => {
    setOverrides((prev) => ({ ...prev, [key]: checked }));
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-4xl">
          <h3 className="text-lg font-bold">{t("concept.migration.title")}</h3>
          <p className="mt-1 text-xs text-base-content/60">{t("concept.migration.hint")}</p>

          {plan && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-base-content/70">
                <span>
                  {t("concept.migration.summary", {
                    resolved: plan.resolved.length,
                    conflict: plan.conflicts.length,
                    unresolved: plan.unresolved.length,
                  })}
                </span>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className={TOGGLE}
                    checked={stripTags}
                    onChange={(event) => setStripTags(event.target.checked)}
                  />
                  {t("concept.migration.stripTags")}
                </label>
              </div>

              {plan.needsConfirm.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded bg-warning/10 px-2 py-1 text-xs text-warning">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{t("concept.migration.needsConfirmHint")}</span>
                </p>
              )}

              {plan.candidates.length === 0 ? (
                <p className="mt-6 flex items-center gap-2 text-sm text-success">
                  <CheckCircle2 size={16} /> {t("concept.migration.empty")}
                </p>
              ) : (
                <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-base-300">
                  <table className="table table-xs w-full">
                    <thead className="sticky top-0 bg-base-200">
                      <tr>
                        <th />
                        <th>{t("lexicon.word")}</th>
                        <th>{t("lexicon.tagsPlaceholder")}</th>
                        <th>{t("lexicon.concept.pick")}</th>
                        <th>{t("lexicon.concept.fieldFilter")}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {plan.candidates.map((candidate, index) => {
                        const key = candidateKey(candidate);
                        const selectable = SELECTABLE.has(candidate.status);
                        const checked =
                          selectable &&
                          (overrides[key] ?? defaultChecked(candidate.status));
                        return (
                          <tr
                            key={`${key}_${index}`}
                            className={candidate.status === "needs_confirm" ? "bg-warning/5" : ""}
                          >
                            <td>
                              <input
                                type="checkbox"
                                className={TOGGLE}
                                disabled={!selectable}
                                checked={checked}
                                aria-label={candidate.tag}
                                onChange={(event) => toggle(key, event.target.checked)}
                              />
                            </td>
                            <td className="font-mono">{candidate.word}</td>
                            <td className="truncate">{candidate.tag}</td>
                            <td>
                              {candidate.conceptId ? (
                                <span className="font-mono text-xs">{candidate.conceptId}</span>
                              ) : (
                                <span className="text-base-content/50">{candidate.label}</span>
                              )}
                            </td>
                            <td className="text-base-content/50">
                              {(() => {
                                const fieldKey = candidate.conceptId
                                  ? fieldById.get(candidate.conceptId)
                                  : undefined;
                                return fieldKey
                                  ? (fieldLabels[fieldKey] ?? fieldKey)
                                  : "—";
                              })()}
                            </td>
                            <td>
                              <span
                                className={`${BADGE} badge-xs ${STATUS_BADGE[candidate.status]}`}
                              >
                                {candidate.status === "needs_confirm"
                                  ? t("concept.migration.status.needsConfirm")
                                  : (statusLabels[candidate.status] ?? candidate.status)}
                              </span>
                              {candidate.conflictWith && (
                                <span
                                  className="ml-1 inline-flex items-center text-warning"
                                  title={candidate.conflictWith}
                                >
                                  <AlertTriangle size={11} />
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          <div className="modal-action">
            <button
              className={BTN_PRIMARY}
              disabled={!preview || bindable === 0}
              onClick={() => {
                if (preview) onApply(preview);
                onClose();
              }}
            >
              <RefreshCw size={14} />
              {t("concept.migration.apply", { count: bindable })}
            </button>
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
