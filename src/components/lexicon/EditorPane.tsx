import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useSCAStore } from "../../store/scaStore";
import { Trash2, Plus, Lock, Unlock, Tag } from "lucide-react";
import { ConfirmModal } from "../common/ConfirmModal";
import { TagsInput } from "../common/TagsInput";
import { Sense, WordEntry, PhonologyConfig, OriginType, LanguageEntry } from "../../types";
import { generateIPA } from "../../utils/ipaGenerator";
import {
  INPUT,
  SELECT,
  TEXTAREA,
  BTN_ERROR,
  BTN_GHOST_SQ,
  BTN_LINK,
  TOGGLE,
  BADGE,
} from "../../lib/ui";
import {
  getWordEvolution,
  hasWordChangedFromParent,
  WordLifecycleFlags,
} from "../../utils/wordLifecycle";

export const EditorPane: React.FC = () => {
  const { t } = useTranslation();
  const { activeWordId, wordsMap, wordsList, upsertWord, deleteWord } = useLexiconStore();
  const phonoConfig = usePhonoStore((s) => s.config);
  const partsOfSpeech = useGrammarStore((s) => s.config.parts_of_speech);
  const activeLanguageId = useWorkspaceStore((s) => s.activeLanguageId);
  const projectPath = useWorkspaceStore((s) => s.projectPath);
  const workspaceLanguages = useWorkspaceStore((s) => s.config.languages);
  const scaConfig = useSCAStore((s) => s.config);

  // TTS playback state
  // const [isPlaying, setIsPlaying] = useState(false);

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteSenseIdx, setConfirmDeleteSenseIdx] = useState<
    number | null
  >(null);

  // Track previous romanized value for IPA auto-generation
  const prevRomanizedRef = useRef<string>("");

  const word = activeWordId ? wordsMap[activeWordId] : null;
  const evolution = word ? getWordEvolution(word) : null;

  // Parent language detection
  const activeLanguage = useMemo(
    () => workspaceLanguages.find((l) => l.language_id === activeLanguageId),
    [workspaceLanguages, activeLanguageId],
  );
  const parentLanguage = useMemo(() => {
    if (!activeLanguage?.parent_id) return null;
    return workspaceLanguages.find((l) => l.language_id === activeLanguage.parent_id) ?? null;
  }, [workspaceLanguages, activeLanguage]);

  const lineageLanguages = useMemo<LanguageEntry[]>(() => {
    if (!activeLanguage) return [];
    const chain: LanguageEntry[] = [];
    const visited = new Set<string>();
    let current: LanguageEntry | null = activeLanguage;

    while (current && !visited.has(current.language_id)) {
      chain.push(current);
      visited.add(current.language_id);
      current = current.parent_id
        ? workspaceLanguages.find((l) => l.language_id === current?.parent_id) ?? null
        : null;
    }

    return chain.reverse();
  }, [activeLanguage, workspaceLanguages]);

  // Load parent word data for lifecycle labels & evolution path
  const [parentWordsById, setParentWordsById] = useState<Record<string, WordEntry>>({});
  const [parentPhonoConfig, setParentPhonoConfig] = useState<PhonologyConfig | null>(null);
  const [ancestorWordsByLanguage, setAncestorWordsByLanguage] = useState<
    Record<string, Record<string, WordEntry>>
  >({});

  useEffect(() => {
    let cancelled = false;
    if (!parentLanguage || !projectPath) {
      setParentWordsById({});
      setParentPhonoConfig(null);
      return;
    }
    (async () => {
      try {
        const [words, phono] = await Promise.all([
          invoke<WordEntry[]>("load_all_words", { projectPath, languagePath: parentLanguage.path }),
          invoke<PhonologyConfig>("load_phonology", { projectPath, languagePath: parentLanguage.path }),
        ]);
        if (cancelled) return;
        const byId: Record<string, WordEntry> = {};
        words.forEach((w) => { byId[w.entry_id] = w; });
        setParentWordsById(byId);
        setParentPhonoConfig(phono);
      } catch (err) {
        if (!cancelled) {
          setParentWordsById({});
          setParentPhonoConfig(null);
        }
        console.warn("Failed to load parent words for editor:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [parentLanguage, projectPath]);

  useEffect(() => {
    let cancelled = false;

    if (!projectPath || !activeLanguageId || lineageLanguages.length <= 1) {
      setAncestorWordsByLanguage({});
      return;
    }

    const ancestorLanguages = lineageLanguages.filter(
      (lang) => lang.language_id !== activeLanguageId,
    );

    (async () => {
      try {
        const loaded = await Promise.all(
          ancestorLanguages.map(async (lang) => {
            const words = await invoke<WordEntry[]>("load_all_words", {
              projectPath,
              languagePath: lang.path,
            });
            const byId: Record<string, WordEntry> = {};
            words.forEach((entry) => {
              byId[entry.entry_id] = entry;
            });
            return { languageId: lang.language_id, wordsById: byId };
          }),
        );

        if (cancelled) return;

        const nextMap: Record<string, Record<string, WordEntry>> = {};
        loaded.forEach(({ languageId, wordsById }) => {
          nextMap[languageId] = wordsById;
        });
        setAncestorWordsByLanguage(nextMap);
      } catch (error) {
        if (!cancelled) {
          setAncestorWordsByLanguage({});
        }
        console.warn("Failed to load ancestor words for evolution path:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectPath, activeLanguageId, lineageLanguages]);

  // Parent word for the active word
  const parentWord = word?.etymology?.parent_entry_id
    ? parentWordsById[word.etymology.parent_entry_id] ?? null
    : null;

  const evolutionPathWords = useMemo(() => {
    if (!word || !activeLanguageId) return [] as string[];

    const baseEntryId = word.etymology.parent_entry_id ?? word.entry_id;
    const wordsOnPath: string[] = [];

    lineageLanguages.forEach((lang) => {
      if (lang.language_id === activeLanguageId) {
        const current = word.con_word_romanized.trim();
        if (current) {
          wordsOnPath.push(current);
        }
        return;
      }

      const ancestorWord = ancestorWordsByLanguage[lang.language_id]?.[baseEntryId];
      const ancestorRomanized = ancestorWord?.con_word_romanized?.trim();
      if (ancestorRomanized) {
        wordsOnPath.push(ancestorRomanized);
      }
    });

    const dedupedWords = wordsOnPath.filter(
      (pathWord, index) => index === 0 || pathWord !== wordsOnPath[index - 1],
    );

    if (dedupedWords.length === 0) {
      const fallback = word.con_word_romanized.trim();
      return fallback ? [fallback] : [];
    }

    return dedupedWords;
  }, [word, activeLanguageId, lineageLanguages, ancestorWordsByLanguage]);

  // Lifecycle flags
  const lifecycleFlags = useMemo<WordLifecycleFlags | null>(() => {
    if (!word) return null;
    const evo = getWordEvolution(word);
    const isNew = !!parentLanguage && !parentWord;
    const isDeprecated = evo.is_deprecated;
    let isChanged = false;
    if (parentLanguage && parentWord) {
      isChanged = hasWordChangedFromParent(word, parentWord);
      if (!isChanged && parentPhonoConfig) {
        const childSurface = generateIPA(word.con_word_romanized, phonoConfig).surface;
        const parentSurface = generateIPA(parentWord.con_word_romanized, parentPhonoConfig).surface;
        isChanged = childSurface !== parentSurface;
      }
    }
    return { isNew, isDeprecated, isChanged: isDeprecated ? false : isChanged };
  }, [word, parentLanguage, parentWord, parentPhonoConfig, phonoConfig]);

  // SCA rule name lookup
  const scaRuleLookup = useMemo(() => {
    const map = new Map<string, string>();
    scaConfig.rule_sets.forEach((rs) => {
      rs.rules.forEach((r) => {
        map.set(r.rule_id, r.description || rs.name);
      });
    });
    return map;
  }, [scaConfig]);

  // Collect all unique tags from all words for autocomplete
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    wordsList.forEach((w) => {
      w.metadata?.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [wordsList]);

  // Auto-generate IPA when romanized form changes and override is off
  useEffect(() => {
    if (!word || word.phonetic_override) return;
    if (word.con_word_romanized === prevRomanizedRef.current) return;
    prevRomanizedRef.current = word.con_word_romanized;

    const { phonemic } = generateIPA(word.con_word_romanized, phonoConfig);
    const cleanIpa = phonemic.replace(/^\/|\/$/g, '');
    if (cleanIpa && cleanIpa !== word.phonetic_ipa) {
      upsertWord({ ...word, phonetic_ipa: cleanIpa });
    }
  }, [word?.con_word_romanized, word?.phonetic_override, phonoConfig]);

  if (!word) {
    return (
      <div className="flex-1 flex items-center justify-center text-base-content/50 mt-16 italic">
        {t("lexicon.selectWord")}
      </div>
    );
  }

  const handleChange = (
    field: keyof WordEntry,
    value: WordEntry[keyof WordEntry],
  ) => {
    upsertWord({ ...word, [field]: value });
  };

  const handleSenseChange = (
    index: number,
    field: keyof Sense,
    value: Sense[keyof Sense],
  ) => {
    const newSenses = [...word.senses];
    newSenses[index] = { ...newSenses[index], [field]: value };
    handleChange("senses", newSenses);
  };

  const addSense = () => {
    const defaultPosId = partsOfSpeech[0]?.pos_id || "";
    handleChange("senses", [
      ...word.senses,
      {
        sense_id: crypto.randomUUID(),
        pos_id: defaultPosId,
        gloss: "",
        definitions: [],
        examples: [],
      },
    ]);
  };

  const removeSense = (index: number) => {
    const newSenses = word.senses.filter((_, i) => i !== index);
    handleChange("senses", newSenses);
  };

  const handleTagsChange = (newTags: string[]) => {
    handleChange("metadata", { ...word.metadata, tags: newTags });
  };

  // Surface form (allophonic)
  const { surface } = generateIPA(word.con_word_romanized, phonoConfig);

  // const inventory = [
  //   ...phonoConfig.phoneme_inventory.consonants,
  //   ...phonoConfig.phoneme_inventory.vowels,
  // ];

  // const handlePlayTts = async () => {
  //   const ipa = word.phonetic_ipa || surface || "";
  //   if (!ipa) return;
  //   if (isPlaying) {
  //     stopConcatenatedPlayback();
  //     setIsPlaying(false);
  //     return;
  //   }
  //   setIsPlaying(true);
  //   try {
  //     await playIpaConcatenated(ipa, inventory);
  //   } catch (err) {
  //     console.warn("TTS playback error:", err);
  //   } finally {
  //     setIsPlaying(false);
  //   }
  // };

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-base-100">
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={word.con_word_romanized}
            onChange={(e) => handleChange("con_word_romanized", e.target.value)}
            className="text-4xl font-bold border-b-2 border-transparent hover:border-base-300 focus:border-primary outline-none w-full bg-transparent"
            placeholder={t("lexicon.word")}
          />
          <div className="flex items-center gap-2 mt-2 text-base-content/60">
            <span className="font-mono text-lg">
              {word.phonetic_override ? (
                <input
                  type="text"
                  value={word.phonetic_ipa}
                  onChange={(e) => handleChange("phonetic_ipa", e.target.value)}
                  className="border-b border-base-300 outline-none bg-transparent"
                />
              ) : (
                word.phonetic_ipa || (
                  <span className="text-base-content/30 italic text-sm">
                    {t("lexicon.autoGenHint")}
                  </span>
                )
              )}
            </span>
            {surface && (
              <span className="font-mono text-base text-success">
                {surface}
              </span>
            )}
            <button
              onClick={() =>
                handleChange("phonetic_override", !word.phonetic_override)
              }
              className={BTN_GHOST_SQ}
              title={
                word.phonetic_override
                  ? t("lexicon.unlockAuto")
                  : t("lexicon.lockManual")
              }
            >
              {word.phonetic_override ? (
                <Unlock size={16} />
              ) : (
                <Lock size={16} />
              )}
            </button>
            {/* {(word.phonetic_ipa || surface) && (
              <button
                onClick={handlePlayTts}
                className={`${BTN_GHOST_SQ} ${isPlaying ? "text-primary animate-pulse" : ""}`}
                title={t("lexicon.playTts")}
              >
                <Volume2 size={16} />
              </button>
            )} */}
          </div>
          {lifecycleFlags &&
            (lifecycleFlags.isNew || lifecycleFlags.isDeprecated || lifecycleFlags.isChanged) && (
              <div className="flex gap-1 mt-2">
                {lifecycleFlags.isNew && (
                  <span className={`${BADGE} badge-success`}>{t("lexicon.lifecycle.added")}</span>
                )}
                {lifecycleFlags.isDeprecated && (
                  <span className={`${BADGE} badge-error`}>{t("lexicon.lifecycle.deprecated")}</span>
                )}
                {lifecycleFlags.isChanged && (
                  <span className={`${BADGE} badge-warning`}>{t("lexicon.lifecycle.changed")}</span>
                )}
              </div>
            )}
        </div>
        <button
          onClick={() => setConfirmDelete(true)}
          className="btn btn-ghost btn-square text-error"
          title={t("lexicon.deleteWord")}
        >
          <Trash2 size={20} />
        </button>
      </div>

      {/* Metadata: tags */}
      <div className="mb-6 flex items-baseline gap-2">
        <Tag size={14} className="text-base-content/50 shrink-0 relative top-1" />
        <TagsInput
          tags={word.metadata?.tags ?? []}
          onChange={handleTagsChange}
          placeholder={t("lexicon.tagsPlaceholder", "Add tag...")}
          allTags={allTags}
        />
      </div>

      <div className="space-y-6">
        <div className="flex justify-between items-center border-b border-base-300 pb-2">
          <h3 className="text-xl font-semibold text-base-content/80">
            {t("lexicon.senses")}
          </h3>
          <button onClick={addSense} className={BTN_LINK}>
            <Plus size={16} /> {t("lexicon.addMeaning")}
          </button>
        </div>

        {word.senses.map((sense, index) => (
          <div
            key={index}
            className="p-4 pt-6 border border-base-300 rounded-lg bg-base-200/50 relative group"
          >
            <button
              onClick={() => setConfirmDeleteSenseIdx(index)}
              className={`${BTN_ERROR} absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity`}
              title={t("lexicon.deleteMeaning")}
            >
              <Trash2 size={16} />
            </button>

            <div className="grid grid-cols-12 gap-4 mb-4">
              <div className="col-span-3">
                <label className="block text-xs font-medium text-base-content/60 mb-1">
                  {t("lexicon.pos")}
                </label>
                <select
                  value={sense.pos_id ?? ""}
                  onChange={(e) =>
                    handleSenseChange(index, "pos_id", e.target.value)
                  }
                  className={`w-full ${SELECT}`}
                >
                  <option value="">--</option>
                  {partsOfSpeech.map((p) => (
                    <option key={p.pos_id} value={p.pos_id}>
                      {p.name || p.pos_id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-9">
                <label className="block text-xs font-medium text-base-content/60 mb-1">
                  {t("lexicon.gloss")}
                </label>
                <input
                  type="text"
                  value={sense.gloss}
                  onChange={(e) =>
                    handleSenseChange(index, "gloss", e.target.value)
                  }
                  className={`w-full ${INPUT}`}
                  placeholder={t("lexicon.gloss")}
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.definitions")}
              </label>
              <textarea
                value={sense.definitions.join("\n")}
                onChange={(e) =>
                  handleSenseChange(
                    index,
                    "definitions",
                    e.target.value.split("\n"),
                  )
                }
                className={`w-full ${TEXTAREA} min-h-[60px]`}
                placeholder={t("lexicon.definitions")}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.examples")}
              </label>
              <textarea
                value={sense.examples.join("\n")}
                onChange={(e) =>
                  handleSenseChange(
                    index,
                    "examples",
                    e.target.value.split("\n"),
                  )
                }
                className={`w-full ${TEXTAREA} min-h-[60px]`}
                placeholder={t("lexicon.examples")}
              />
            </div>
          </div>
        ))}
      </div>
      {/* Evolution Path / Etymology */}
      <div className="mt-8 pt-4 border-t border-base-300 space-y-3">
        <h3 className="text-sm font-medium text-base-content/70">
          {t("lexicon.etymology")}
        </h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-base-content/60 mb-1">
              {t("lexicon.originType")}
            </label>
            <select
              value={word.etymology?.origin_type || "a_priori"}
              onChange={(e) =>
                handleChange("etymology", {
                  ...word.etymology,
                  origin_type: e.target.value as OriginType,
                })
              }
              className={`w-full ${SELECT}`}
            >
              <option value="a_priori">{t("lexicon.originAPriori")}</option>
              <option value="a_posteriori">
                {t("lexicon.originAPosteriori")}
              </option>
              <option value="evolved">{t("lexicon.originEvolved")}</option>
              <option value="borrowed">{t("lexicon.originBorrowed")}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-base-content/60 mb-1">
              {t("lexicon.sourceLanguage")}
            </label>
            <input
              type="text"
              value={word.etymology?.source_language_id || ""}
              onChange={(e) =>
                handleChange("etymology", {
                  ...word.etymology,
                  source_language_id: e.target.value || null,
                })
              }
              className={`w-full ${INPUT}`}
              placeholder={t("lexicon.sourceLanguagePlaceholder")}
              readOnly={
                word.etymology?.origin_type !== "borrowed" &&
                word.etymology?.origin_type !== "evolved"
              }
            />
          </div>
        </div>

        {(word.etymology?.origin_type === "evolved" ||
          word.etymology?.origin_type === "borrowed") &&
          word.etymology?.parent_entry_id && (
            <div className="bg-base-200/50 border border-base-300 rounded-lg p-3 mt-2">
              <p className="text-xs font-medium text-base-content/60 mb-1">
                {t("lexicon.evolutionPath")}
              </p>
              <div className="flex items-center gap-2 font-mono text-sm flex-wrap">
                {evolutionPathWords.map((pathWord, index) => (
                  <React.Fragment key={`${pathWord}-${index}`}>
                    {index > 0 && <span className="text-base-content/50">→</span>}
                    <span
                      className={
                        index === evolutionPathWords.length - 1
                          ? "font-bold text-primary"
                          : "text-base-content/60 italic"
                      }
                    >
                      {pathWord}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              {word.etymology.applied_sound_changes &&
                word.etymology.applied_sound_changes.length > 0 && (
                  <div className="mt-2 flex items-center gap-1 flex-wrap">
                    {word.etymology.applied_sound_changes.map((scId, i) => (
                      <span key={i} className="badge badge-xs badge-ghost" title={scId}>
                        {scaRuleLookup.get(scId) || scId.slice(0, 8)}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          )}

        <div>
          <label className="block text-xs font-medium text-base-content/60 mb-1">
            {t("lexicon.lifecycle.deprecation")}
          </label>
          <div className="rounded-lg border border-base-300 bg-base-200/50 p-3 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className={TOGGLE}
                checked={evolution?.is_deprecated ?? false}
                onChange={(e) =>
                  handleChange("evolution", {
                    ...(word.evolution ?? {}),
                    is_deprecated: e.target.checked,
                    deprecated_since_language_id: e.target.checked
                      ? evolution?.deprecated_since_language_id ?? activeLanguageId
                      : null,
                  })
                }
              />
              <span>{t("lexicon.lifecycle.markDeprecated")}</span>
            </label>
            {(evolution?.is_deprecated ?? false) && (
              <div>
                <label className="block text-xs font-medium text-base-content/60 mb-1">
                  {t("lexicon.lifecycle.deprecatedSince")}
                </label>
                <select
                  value={
                    evolution?.deprecated_since_language_id ?? activeLanguageId
                  }
                  onChange={(e) =>
                    handleChange("evolution", {
                      ...(word.evolution ?? {}),
                      is_deprecated: true,
                      deprecated_since_language_id: e.target.value,
                    })
                  }
                  className={`w-full ${SELECT}`}
                >
                  {workspaceLanguages.map((lang) => (
                    <option key={lang.language_id} value={lang.language_id}>
                      {lang.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-base-content/60 mb-1">
            {t("lexicon.semanticShiftNote")}
          </label>
          <input
            type="text"
            value={word.etymology?.semantic_shift_note || ""}
            onChange={(e) =>
              handleChange("etymology", {
                ...word.etymology,
                semantic_shift_note: e.target.value,
              })
            }
            className={`w-full ${INPUT}`}
            placeholder={t("lexicon.semanticShiftPlaceholder")}
          />
        </div>
      </div>

      <ConfirmModal
        open={confirmDelete}
        title={t("lexicon.deleteWord")}
        message={t("lexicon.deleteWordConfirm", {
          word: word.con_word_romanized,
        })}
        onConfirm={() => {
          deleteWord(word.entry_id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmModal
        open={confirmDeleteSenseIdx !== null}
        title={t("common.delete")}
        message={t(
          "lexicon.deleteMeaningConfirm",
          "Are you sure you want to delete this meaning?",
        )}
        onConfirm={() => {
          if (confirmDeleteSenseIdx !== null) {
            removeSense(confirmDeleteSenseIdx);
            setConfirmDeleteSenseIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteSenseIdx(null)}
      />
    </div>
  );
};
