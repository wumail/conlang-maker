import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { GrammarSyncRow } from "../../core/workflows/grammarPullSync";
import { useGrammarSyncKindLabels } from "../../lib/labelMaps";
import { BADGE } from "../../lib/ui";

interface GrammarSyncTableProps {
  rows: GrammarSyncRow[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (ruleId: string) => void;
  onToggleAll: () => void;
}

/** 词缀变更清单：勾选要落地的规则 */
export function GrammarSyncTable({
  rows,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
}: GrammarSyncTableProps) {
  const { t } = useTranslation();
  const kindLabels = useGrammarSyncKindLabels();

  return (
    <div className="max-h-72 overflow-y-auto rounded border border-base-300">
      <table className="table table-xs">
        <thead className="sticky top-0 bg-base-200">
          <tr>
            <th className="w-8">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label={t("tree.grammarSync.selectAll")}
              />
            </th>
            <th>{t("tree.grammarSync.colTag")}</th>
            <th>{t("tree.grammarSync.colChange")}</th>
            <th className="w-24">{t("tree.grammarSync.colStatus")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selectable = row.status === "apply";
            return (
              <tr key={`${row.kind}:${row.ruleId}`}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    disabled={!selectable}
                    checked={selectable && selected.has(row.ruleId)}
                    onChange={() => onToggle(row.ruleId)}
                  />
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <span className="font-mono">{row.tag}</span>
                    <span className="text-[10px] text-base-content/40">
                      {kindLabels[row.kind]}
                    </span>
                  </div>
                </td>
                <td className="font-mono text-xs">
                  <span className="text-base-content/50">{row.before}</span>
                  <ArrowRight className="inline w-3 h-3 mx-1 opacity-50" />
                  <span className={selectable ? "text-primary" : "text-base-content/50"}>
                    {row.after}
                  </span>
                </td>
                <td>
                  <span
                    className={`${BADGE} ${selectable ? "badge-primary" : "badge-ghost"}`}
                  >
                    {selectable
                      ? t("tree.grammarSync.applyOne")
                      : t("tree.grammarSync.locked")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
