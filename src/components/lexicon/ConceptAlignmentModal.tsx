/**
 * ConceptAlignmentModal.tsx — 全语系概念对齐工作台（Roadmap v3 / Pillar 4）
 *
 * 页签 1：扫描各语言义项与本语言概念的匹配候选，勾选后批量回写；
 * 页签 2：编辑自定义概念（改名 / 别名）并预览、执行重复概念合并。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Check } from "lucide-react";
import {
  AlignmentSuggestionsPane,
  CustomConceptManagerPane,
} from "./ConceptAlignmentPanes";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useLexiconStore } from "../../store/lexiconStore";
import {
  invalidateLineageLexicon,
  listLineageSnapshots,
  loadLineageLexicon,
  useLineageLexiconCacheVersion,
} from "../../store/lineageLexiconStore";
import {
  previewMergeCustomConcepts,
  suggestCrossLanguageConceptAlignments,
  type ConceptSenseCandidate,
} from "../../core/workflows/conceptMigration";
import type { ConceptDefinition, WordEntry } from "../../types";
import { BTN_GHOST, BTN_PRIMARY } from "../../lib/ui";
import { ModalPortal } from "../common/ModalPortal";

interface ConceptAlignmentModalProps {
  open: boolean;
  onClose: () => void;
}

type Tab = "align" | "manage";

export const ConceptAlignmentModal: React.FC<ConceptAlignmentModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const languages = useWorkspaceStore((s) => s.config.languages);
  const customConcepts = useWorkspaceStore((s) => s.config.custom_concepts) ?? [];
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const replaceCustomConcepts = useWorkspaceStore((s) => s.replaceCustomConcepts);
  const upsertCustomConcept = useWorkspaceStore((s) => s.upsertCustomConcept);
  const [tab, setTab] = useState<Tab>("align");
  const [tick, setTick] = useState(0);
  const cacheVersion = useLineageLexiconCacheVersion();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !projectPath) return;
    void Promise.all(languages.map((language) => loadLineageLexicon(projectPath, language.path)));
  }, [open, projectPath, languages, tick, cacheVersion]);

  const wordsByLanguage = useMemo<Record<string, WordEntry[]>>(() => {
    if (!open || !projectPath) return {};
    const snapshots = new Map(
      listLineageSnapshots(projectPath).map((item) => [item.languagePath, item.snapshot]),
    );
    const result: Record<string, WordEntry[]> = {};
    for (const language of languages) {
      const snapshot = snapshots.get(language.path);
      result[language.language_id] = snapshot ? Object.values(snapshot.wordsById) : [];
    }
    return result;
  }, [open, projectPath, languages, tick, cacheVersion]);

  const [suggestions, setSuggestions] = useState<Record<string, Record<string, ConceptSenseCandidate[]>>>({});
  const [computing, setComputing] = useState(false);
  useEffect(() => {
    if (!open) return void (setSuggestions({}), setComputing(false));
    setComputing(true);
    const timer = window.setTimeout(() => {
      setSuggestions(
        suggestCrossLanguageConceptAlignments({ concepts: customConcepts, languages, wordsByLanguage, maxCandidatesPerLanguage: 5 }),
      );
      setComputing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, customConcepts, languages, wordsByLanguage]);

  const languageName = (languageId: string): string =>
    languages.find((item) => item.language_id === languageId)?.name ?? languageId;

  const bindKey = (c: ConceptSenseCandidate, conceptId: string) =>
    `${conceptId}::${c.languageId}::${c.entryId}::${c.senseId}`;

  /** 批量回写义项绑定：当前语言走 Store，其他语言直接 save_word */
  const applyBindings = async (
    bindings: Array<{ languageId: string; entryId: string; senseId: string; conceptId: string }>,
  ): Promise<void> => {
    if (bindings.length === 0) return;
    setBusy(true);
    try {
      const byLanguage = new Map<string, Map<string, Map<string, string>>>();
      for (const binding of bindings) {
        const entryMap = byLanguage.get(binding.languageId) ?? new Map<string, Map<string, string>>();
        const senseMap = entryMap.get(binding.entryId) ?? new Map<string, string>();
        senseMap.set(binding.senseId, binding.conceptId);
        entryMap.set(binding.entryId, senseMap);
        byLanguage.set(binding.languageId, entryMap);
      }

      for (const [languageId, entries] of byLanguage) {
        const language = languages.find((item) => item.language_id === languageId);
        if (!language) continue;
        const source = new Map(
          (wordsByLanguage[languageId] ?? []).map((word) => [word.entry_id, word]),
        );
        const updated: WordEntry[] = [];
        for (const [entryId, senseBindings] of entries) {
          const word = source.get(entryId);
          if (!word) continue;
          updated.push({
            ...word,
            senses: word.senses.map((sense) =>
              senseBindings.has(sense.sense_id)
                ? { ...sense, concept_id: senseBindings.get(sense.sense_id) }
                : sense,
            ),
          });
        }
        if (updated.length === 0) continue;
        if (languageId === activeLanguageId) {
          useLexiconStore.getState().importWords(updated);
          await useLexiconStore.getState().flushSaves();
        } else {
          for (const word of updated) {
            await invoke("save_word", {
              projectPath,
              languagePath: language.path,
              word,
              oldRomanized: null,
              expectedRevision: null,
              operationId: null,
            });
          }
        }
        invalidateLineageLexicon(projectPath, language.path);
      }
      setSelected(new Set());
      setTick((value) => value + 1);
    } catch (err) {
      console.warn(`Concept alignment apply failed: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const applySelected = () => {
    const bindings: Array<{
      languageId: string;
      entryId: string;
      senseId: string;
      conceptId: string;
    }> = [];
    for (const concept of customConcepts) {
      const perLanguage = suggestions[concept.concept_id] ?? {};
      for (const candidates of Object.values(perLanguage)) {
        for (const candidate of candidates) {
          if (candidate.matchReason === "already_bound") continue;
          if (!selected.has(bindKey(candidate, concept.concept_id))) continue;
          bindings.push({
            languageId: candidate.languageId,
            entryId: candidate.entryId,
            senseId: candidate.senseId,
            conceptId: concept.concept_id,
          });
        }
      }
    }
    void applyBindings(bindings);
  };

  const mergeConcept = (concept: ConceptDefinition) => {
    const targetId = mergeTarget[concept.concept_id];
    if (!targetId || targetId === concept.concept_id) return;
    const preview = previewMergeCustomConcepts({
      sourceConceptId: concept.concept_id,
      targetConceptId: targetId,
      customConcepts,
      wordsByLanguage,
    });
    replaceCustomConcepts(preview.nextConcepts);
    void applyBindings(
      preview.affectedBindings.map((binding) => ({
        languageId: binding.languageId,
        entryId: binding.entryId,
        senseId: binding.senseId,
        conceptId: targetId,
      })),
    );
  };

  const editConcept = (concept: ConceptDefinition, name: string, aliases: string) => {
    upsertCustomConcept({
      ...concept,
      gloss_zh: name,
      aliases: aliases
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean),
    });
  };

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-h-[88vh] w-full max-w-4xl">
          <h3 className="text-lg font-bold">{t("lexicon.conceptsV3.alignModalTitle")}</h3>

          <div className="tabs tabs-boxed mt-2 w-fit">
            <button
              className={`tab ${tab === "align" ? "tab-active" : ""}`}
              onClick={() => setTab("align")}
            >
              {t("lexicon.table.viewConceptAlign")}
            </button>
            <button
              className={`tab ${tab === "manage" ? "tab-active" : ""}`}
              onClick={() => setTab("manage")}
            >
              {t("lexicon.conceptsV3.manageCustomTab")}
            </button>
          </div>

          {tab === "align" && computing ? (
            <p className="mt-3 text-xs text-base-content/60">{t("common.loading")}</p>
          ) : tab === "align" ? (
            <AlignmentSuggestionsPane
              concepts={customConcepts}
              suggestions={suggestions}
              selected={selected}
              bindKey={bindKey}
              languageName={languageName}
              onToggle={(key, checked) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(key);
                  else next.delete(key);
                  return next;
                })
              }
            />
          ) : (
            <CustomConceptManagerPane
              concepts={customConcepts}
              mergeTarget={mergeTarget}
              onMergeTargetChange={(conceptId, targetId) =>
                setMergeTarget((prev) => ({ ...prev, [conceptId]: targetId }))
              }
              onMerge={mergeConcept}
              onEdit={editConcept}
            />
          )}

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onClose}>
              {t("common.close")}
            </button>
            {tab === "align" && (
              <button
                type="button"
                className={BTN_PRIMARY}
                disabled={busy || computing || selected.size === 0}
                onClick={applySelected}
              >
                <Check size={14} /> {t("lexicon.conceptsV3.applySelected")} ({selected.size})
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
