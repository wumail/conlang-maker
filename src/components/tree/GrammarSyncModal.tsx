import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, GitMerge } from "lucide-react";
import type { GrammarConfig, GrammarLoadResult, OperationLog } from "../../types";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useSCAStore } from "../../store/scaStore";
import { usePhonoStore } from "../../store/phonoStore";
import {
  generateOperationId,
  recordGuiOperationId,
} from "../../store/conflictStore";
import {
  applyGrammarPullSync,
  planGrammarPullSync,
  type GrammarSyncRow,
} from "../../core/workflows/grammarPullSync";
import { ModalPortal } from "../common/ModalPortal";
import { GrammarSyncTable } from "./GrammarSyncTable";
import { BADGE, BTN_GHOST, BTN_PRIMARY } from "../../lib/ui";

interface GrammarSyncModalProps {
  open: boolean;
  onClose: () => void;
}

export function GrammarSyncModal({ open, onClose }: GrammarSyncModalProps) {
  const { t } = useTranslation();
  const {
    config: wsConfig,
    activeLanguageId,
    projectPath,
  } = useWorkspaceStore();
  const grammarConfig = useGrammarStore((state) => state.config);
  const applyGrammarSyncPatch = useGrammarStore(
    (state) => state.applyGrammarSyncPatch,
  );
  const scaConfig = useSCAStore((state) => state.config);
  const phonoConfig = usePhonoStore((state) => state.config);

  const [parentGrammar, setParentGrammar] = useState<GrammarConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [applied, setApplied] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const child = wsConfig.languages.find(
    (language) => language.language_id === activeLanguageId,
  );
  const parent = child?.parent_id
    ? wsConfig.languages.find((language) => language.language_id === child.parent_id)
    : null;

  useEffect(() => {
    if (!open || !parent) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setApplied(0);
    invoke<GrammarLoadResult>("load_grammar_with_revision", {
      projectPath,
      languagePath: parent.path,
    })
      .then((loaded) => {
        if (!cancelled) setParentGrammar(loaded.config);
      })
      .catch((error) => {
        console.warn(`Failed to load parent grammar: ${error}`);
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, parent, projectPath]);

  const plan = useMemo(() => {
    if (!parentGrammar) return null;
    return planGrammarPullSync({
      parentGrammar,
      childGrammar: grammarConfig,
      childSca: scaConfig,
      inventory: phonoConfig.phoneme_inventory,
      phonotactics: phonoConfig.phonotactics,
      phonology: phonoConfig,
    });
  }, [parentGrammar, grammarConfig, scaConfig, phonoConfig]);

  const rows: GrammarSyncRow[] = useMemo(() => {
    if (!plan) return [];
    return [...plan.inflection, ...plan.derivation, ...plan.irregular].filter(
      (row) => row.status !== "unchanged",
    );
  }, [plan]);

  const applyIds = useMemo(
    () => rows.filter((row) => row.status === "apply").map((row) => row.ruleId),
    [rows],
  );

  const allSelected = applyIds.length > 0 && applyIds.every((id) => selected.has(id));

  const toggle = (ruleId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(applyIds));
  };

  const handleApply = async (): Promise<void> => {
    if (!plan) return;
    const skipRuleIds = applyIds.filter((id) => !selected.has(id));
    const next = applyGrammarPullSync(grammarConfig, plan, { skipRuleIds });
    const count = applyIds.length - skipRuleIds.length;

    // 先建立语法快照恢复点，再原子写入三组规则（PullSync 同款流程）
    if (child) {
      const opId = generateOperationId();
      recordGuiOperationId(opId);
      try {
        await invoke<OperationLog>("create_snapshot", {
          projectPath,
          languagePath: child.path,
          operationType: "grammar_sync",
          sourceLanguageId: parent?.language_id ?? "",
          targetLanguageId: child.language_id,
          description: `Synced ${count} grammar rule(s) via sound changes`,
          scope: "grammar",
          origin: "gui",
          operationId: opId,
        });
      } catch (error) {
        console.warn("Failed to create snapshot before grammar sync:", error);
      }
    }

    applyGrammarSyncPatch({
      inflection_rules: next.inflection_rules,
      derivation_rules: next.derivation_rules,
      irregular_overrides: next.irregular_overrides,
    });
    setSelected(new Set());
    setApplied(count);
  };

  const changed = plan
    ? plan.stats.inflectionChanged +
      plan.stats.derivationChanged +
      plan.stats.irregularChanged
    : 0;
  const total = plan
    ? plan.stats.inflectionTotal +
      plan.stats.derivationTotal +
      plan.stats.irregularTotal
    : 0;

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open z-50" data-testid="grammar-sync-modal">
        <div className="modal-box max-w-3xl space-y-3">
          <h3 className="font-bold text-base flex items-center gap-2">
            <GitMerge className="w-4 h-4 text-primary" />
            {t("tree.grammarSync.title")}
          </h3>
          <p className="text-xs text-base-content/60">
            {t("tree.grammarSync.desc", {
              parent: parent?.name ?? "",
              child: child?.name ?? "",
            })}
          </p>

          {loading && (
            <div className="py-4 text-center text-xs text-base-content/60">
              <span className="loading loading-spinner loading-sm mr-2" />
              {t("tree.grammarSync.loading")}
            </div>
          )}

          {failed && (
            <div className="alert alert-error alert-soft py-2 px-3 text-xs">
              {t("tree.grammarSync.failed")}
            </div>
          )}

          {plan && !loading && (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className={`${BADGE} badge-primary`}>
                  {t("tree.grammarSync.summary", { changed, total })}
                </span>
                <span className={`${BADGE} badge-ghost`}>
                  {t("tree.grammarSync.lockedCount", {
                    count: plan.stats.lockedCount,
                  })}
                </span>
                {applied > 0 && (
                  <span className={`${BADGE} badge-success`}>
                    {t("tree.grammarSync.applied", { count: applied })}
                  </span>
                )}
              </div>

              {plan.collisions.length > 0 && (
                <div className="alert alert-warning alert-soft py-2 px-3 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t("tree.grammarSync.collisionsTitle", {
                      count: plan.collisions.length,
                    })}
                  </div>
                  <ul className="list-disc list-inside font-mono">
                    {plan.collisions.slice(0, 8).map((collision) => (
                      <li key={`${collision.ruleIds[0]}:${collision.ruleIds[1]}`}>
                        {t("tree.grammarSync.collisionLine", {
                          tags: collision.tags.join(" / "),
                          form: collision.form,
                          pos: collision.posId,
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {rows.length === 0 ? (
                <p className="text-xs text-base-content/50 py-3">
                  {t("tree.grammarSync.empty")}
                </p>
              ) : (
                <GrammarSyncTable
                  rows={rows}
                  selected={selected}
                  allSelected={allSelected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                />
              )}
            </>
          )}

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              {t("tree.grammarSync.close")}
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={!plan || loading || selected.size === 0}
              onClick={() => void handleApply()}
              data-testid="apply-grammar-sync"
            >
              <GitMerge className="w-4 h-4" />
              {t("tree.grammarSync.apply", { count: selected.size })}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/** 拉取同步面板里的入口按钮：自带开关状态，避免宿主组件变长 */
export function GrammarSyncLauncher() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={BTN_PRIMARY} onClick={() => setOpen(true)}>
        <GitMerge className="w-4 h-4" />
        {t("tree.grammarSync.open")}
      </button>
      <GrammarSyncModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
