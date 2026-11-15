/**
 * useCorpusLineStats.ts — 语料句子筛选统计（Roadmap v3 / Pillar 6）
 *
 * 逐句判断：含未登录词 / 含同形多候选择 / 含断链词典引用。
 */
import { useMemo } from "react";
import type { CorpusText, WordEntry } from "../../types";
import type { LineFilter } from "./GlossingToolbar";

export interface LineStat {
  unresolved: boolean;
  multi: boolean;
  broken: boolean;
}

export function useCorpusLineStats(
  corpus: CorpusText | null,
  wordsList: WordEntry[],
  filter: LineFilter,
): {
  lineStats: Map<string, LineStat>;
  visibleLines: CorpusText["glossed_lines"];
  counts: Record<LineFilter, number>;
} {
  const lineStats = useMemo(() => {
    const map = new Map<string, LineStat>();
    if (!corpus) return map;
    const wordsById = new Map(wordsList.map((word) => [word.entry_id, word]));
    const formCounts = new Map<string, number>();
    for (const word of wordsList) {
      const form = word.con_word_romanized.trim().toLowerCase();
      formCounts.set(form, (formCounts.get(form) ?? 0) + 1);
    }
    for (const line of corpus.glossed_lines) {
      let unresolved = false;
      let multi = false;
      let broken = false;
      for (const token of line.tokens) {
        if (!token.gloss_labels.trim()) unresolved = true;
        if ((formCounts.get(token.surface_form.trim().toLowerCase()) ?? 0) > 1) multi = true;
        if (token.linked_entry_id) {
          const entry = wordsById.get(token.linked_entry_id);
          if (!entry) broken = true;
          else if (
            token.linked_sense_id &&
            !entry.senses.some((sense) => sense.sense_id === token.linked_sense_id)
          ) {
            broken = true;
          }
        }
      }
      map.set(line.line_id, { unresolved, multi, broken });
    }
    return map;
  }, [corpus, wordsList]);

  const visibleLines = useMemo(() => {
    if (!corpus) return [];
    if (filter === "all") return corpus.glossed_lines;
    return corpus.glossed_lines.filter((line) => {
      const stat = lineStats.get(line.line_id);
      if (!stat) return false;
      if (filter === "unresolved") return stat.unresolved;
      if (filter === "multi_candidate") return stat.multi;
      return stat.broken;
    });
  }, [corpus, filter, lineStats]);

  const counts = useMemo(() => {
    const values = [...lineStats.values()];
    return {
      all: values.length,
      unresolved: values.filter((stat) => stat.unresolved).length,
      multi_candidate: values.filter((stat) => stat.multi).length,
      broken_ref: values.filter((stat) => stat.broken).length,
    };
  }, [lineStats]);

  return { lineStats, visibleLines, counts };
}
