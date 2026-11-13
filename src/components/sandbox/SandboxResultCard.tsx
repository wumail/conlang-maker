import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitBranch, ListTree } from "lucide-react";
import type {
  PhrasePlan,
  PhraseTreeNode,
} from "../../core/engines/phraseSandbox";
import type { SandboxResult } from "../../utils/sandbox";
import { useFontStore } from "../../store/fontStore";
import { ScriptLine } from "../writing/ScriptText";

const TreeNode: React.FC<{ node: PhraseTreeNode; depth?: number }> = ({
  node,
  depth = 0,
}) => (
  <li className="font-mono text-xs">
    <span className={depth === 0 ? "text-primary" : "text-base-content/80"}>
      {node.label}
    </span>
    {node.children.length > 0 && (
      <ul className="ml-4 border-l border-base-300 pl-2 space-y-0.5">
        {node.children.map((child, index) => (
          <TreeNode key={`${child.label}:${index}`} node={child} depth={depth + 1} />
        ))}
      </ul>
    )}
  </li>
);

interface SandboxResultCardProps {
  plan: PhrasePlan;
  tokens: SandboxResult[];
  tree: PhraseTreeNode;
}

/** 短语句法台输出区：本族文字整句 + 罗马字 / 标注 / IPA 对齐 + 推导步骤与短语树 */
export const SandboxResultCard: React.FC<SandboxResultCardProps> = ({
  plan,
  tokens,
  tree,
}) => {
  const { t } = useTranslation();
  const fontLoaded = useFontStore((state) => state.loaded);
  const surfaceSentence = tokens.map((token) => token.conlang).join(" ");

  return (
    <div className="rounded-lg border border-base-200 bg-base-200/50 p-3 space-y-3">
      {fontLoaded && surfaceSentence.trim() && (
        <div className="space-y-0.5" data-testid="clause-native-script">
          <span className="block text-[10px] uppercase tracking-wide text-base-content/50">
            {t("sandbox.clause.nativeScript")}
          </span>
          <ScriptLine text={surfaceSentence} className="block text-xl" />
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <tbody>
            <tr>
              {tokens.map((token, index) => (
                <td
                  key={`s:${index}`}
                  className="pr-5 pb-0.5 font-mono font-bold text-primary text-lg whitespace-nowrap"
                >
                  {token.conlang}
                </td>
              ))}
            </tr>
            <tr>
              {tokens.map((_token, index) => {
                const word = plan.words[index];
                return (
                  <td
                    key={`g:${index}`}
                    className="pr-5 pb-0.5 font-mono text-xs text-base-content/70 whitespace-nowrap"
                  >
                    {word?.gloss}
                    {word && word.tags.length > 0 && (
                      <span className="text-purple-600">-{word.tags.join("-")}</span>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              {tokens.map((token, index) => (
                <td
                  key={`i:${index}`}
                  className="pr-5 font-mono text-xs text-success whitespace-nowrap"
                >
                  {token.ipa}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {plan.warnings.map((warning) => (
        <p key={warning} className="text-xs text-warning flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {warning}
        </p>
      ))}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold text-base-content/70 mb-1 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5" />
            {t("sandbox.clause.steps")}
          </h4>
          <ol className="list-decimal list-inside text-[11px] text-base-content/60 space-y-0.5 font-mono">
            {plan.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-base-content/70 mb-1 flex items-center gap-1.5">
            <ListTree className="w-3.5 h-3.5" />
            {t("sandbox.clause.tree")}
          </h4>
          <ul className="space-y-0.5">
            <TreeNode node={tree} />
          </ul>
        </div>
      </div>
    </div>
  );
};
