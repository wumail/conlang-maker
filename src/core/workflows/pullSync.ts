import { SCARuleSet, WordEntry } from "../../types";
import { applySoundChanges } from "../engines/scaEngine";
import {
  getWordComparableDigest,
  getWordEvolution,
  getWordSyncDigest,
} from "../engines/wordLifecycle";
import { isValidWordEntry } from "../lexicon/utils";

export interface PullSyncInput {
  parentLanguageId: string;
  childLanguageId: string;
  parentWords: WordEntry[];
  childWords: WordEntry[];
  scaRuleSets: SCARuleSet[];
  macros: Record<string, string[]>;
}

export interface LegacyPullSyncInput {
  activeLanguageId: string;
  parentLangId: string;
  parentWords: WordEntry[];
  childWords: WordEntry[];
  scaRuleSets: SCARuleSet[];
  macros: Record<string, string[]>;
}

export interface PullSyncConflict {
  parentEntryId: string;
  childEntryId: string;
}

export interface PullSyncPlan {
  pending: { word: WordEntry; mode: "add" | "update" }[];
  conflicts: PullSyncConflict[];
}

export function computePullSync(input: PullSyncInput): PullSyncPlan;
export function computePullSync(input: LegacyPullSyncInput): PullSyncPlan;
export function computePullSync(
  input: PullSyncInput | LegacyPullSyncInput,
): PullSyncPlan {
  const parentLanguageId =
    "parentLanguageId" in input ? input.parentLanguageId : input.parentLangId;
  const childLanguageId =
    "childLanguageId" in input ? input.childLanguageId : input.activeLanguageId;
  const { parentWords, childWords, scaRuleSets, macros } = input;

  const childByParentId = new Map<string, WordEntry>();
  childWords.forEach((word) => {
    const parentEntryId = word.etymology.parent_entry_id ?? word.entry_id;
    childByParentId.set(parentEntryId, word);
  });

  const pending: { word: WordEntry; mode: "add" | "update" }[] = [];
  const conflicts: PullSyncConflict[] = [];

  parentWords.filter(isValidWordEntry).forEach((parentWord) => {
    const { result, changelog } = applySoundChanges(
      parentWord.con_word_romanized,
      scaRuleSets,
      macros,
    );
    const appliedRuleIds = Array.from(
      new Set(changelog.map((step) => step.rule_id)),
    );
    const parentEvolution = getWordEvolution(parentWord);

    const parentComparableHash = getWordComparableDigest(parentWord);
    const parentSyncHash = getWordSyncDigest(parentWord);

    const syncedCandidate: WordEntry = {
      ...parentWord,
      entry_id: parentWord.entry_id,
      language_id: childLanguageId,
      con_word_romanized: result.trim(),
      phonetic_ipa: "",
      phonetic_override: false,
      etymology: {
        ...parentWord.etymology,
        origin_type: "evolved",
        parent_entry_id: parentWord.entry_id,
        source_language_id: parentLanguageId,
        applied_sound_changes: appliedRuleIds,
      },
      evolution: {
        ...parentEvolution,
        parent_snapshot_hash: parentSyncHash,
        last_synced_word_hash: null,
      },
    };

    const syncedWordSyncHash = getWordSyncDigest(syncedCandidate);
    const normalizedEvolution = getWordEvolution(syncedCandidate);
    syncedCandidate.evolution = {
      ...normalizedEvolution,
      last_synced_word_hash: syncedWordSyncHash,
    };

    const existingChild = childByParentId.get(parentWord.entry_id);

    if (!existingChild) {
      pending.push({ word: syncedCandidate, mode: "add" });
      return;
    }

    const existingEvolution = getWordEvolution(existingChild);
    const currentChildHash = getWordComparableDigest(existingChild);
    const currentChildSyncHash = getWordSyncDigest(existingChild);

    // Never synced (freshly forked) — compare content directly
    if (!existingEvolution.parent_snapshot_hash) {
      if (syncedWordSyncHash !== currentChildSyncHash) {
        pending.push({
          word: { ...syncedCandidate, entry_id: existingChild.entry_id },
          mode: "update",
        });
      }
      return;
    }

    // Has been synced before — use hash-based comparison
    const parentSnapshotHash = existingEvolution.parent_snapshot_hash;
    const parentChanged =
      parentSnapshotHash !== parentSyncHash &&
      parentSnapshotHash !== parentComparableHash;

    const lastSyncedHash = existingEvolution.last_synced_word_hash;
    const childChangedSinceLastSync = lastSyncedHash
      ? lastSyncedHash !== currentChildSyncHash &&
        lastSyncedHash !== currentChildHash
      : false;

    if (parentChanged && childChangedSinceLastSync) {
      conflicts.push({
        parentEntryId: parentWord.entry_id,
        childEntryId: existingChild.entry_id,
      });
      return;
    }

    if (!parentChanged && !childChangedSinceLastSync) {
      return;
    }

    pending.push({
      word: {
        ...syncedCandidate,
        entry_id: existingChild.entry_id,
      },
      mode: "update",
    });
  });

  return { pending, conflicts };
}
