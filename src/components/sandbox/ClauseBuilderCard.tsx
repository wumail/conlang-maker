import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, GitBranch, ListTree } from "lucide-react";
import type {
  ClauseNode,
  PhraseTreeNode,
  NPNode,
} from "../../core/engines/phraseSandbox";
import { linearizeClause, planToTree } from "../../core/engines/phraseSandbox";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import { processSandboxText } from "../../utils/sandbox";
import { NPBuilderRow } from "./NPBuilderRow";
import { BADGE, BTN_GHOST, INPUT_MONO, SELECT } from "../../lib/ui";
import type { MorphosyntacticAlignment } from "../../types";

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

const DEFAULT_CLAUSE: ClauseNode = {
  subject: { head: "dog", determiner: "the", adjectives: ["big"] },
  verb: { gloss: "bite", tam: ["PST"] },
  object: { head: "bone", determiner: "the" },
};

/** 结构化句法台：主语 NP / 动词 TAM / 宾语 NP / 斜格 PP */
export function ClauseBuilderCard() {
  const { t } = useTranslation();
  const wordsMap = useLexiconStore((state) => state.wordsMap);
  const phonoConfig = usePhonoStore((state) => state.config);
  const grammarConfig = useGrammarStore((state) => state.config);
  const updateSyntax = useGrammarStore((state) => state.updateSyntax);

  const [clause, setClause] = useState<ClauseNode>(DEFAULT_CLAUSE);
  const [hasObject, setHasObject] = useState(true);
  const [hasOblique, setHasOblique] = useState(false);

  const activeClause: ClauseNode = useMemo(
    () => ({
      ...clause,
      object: hasObject ? clause.object : undefined,
      obliques: hasOblique
        ? clause.obliques ?? [{ adposition: "in", object: { head: "house" } }]
        : undefined,
    }),
    [clause, hasObject, hasOblique],
  );

  const rendered = useMemo(() => {
    if (!clause.subject.head.trim() || !clause.verb.gloss.trim()) return null;
    const plan = linearizeClause(activeClause, grammarConfig);
    const tokens = plan.words.map((word) => {
      const text = word.tags.length > 0 ? `${word.gloss}-${word.tags.join("-")}` : word.gloss;
      const [result] = processSandboxText(text, wordsMap, grammarConfig, phonoConfig);
      return (
        result ?? {
          original: text,
          conlang: `?${word.gloss}?`,
          ipa: "/?/",
          gloss: word.gloss,
        }
      );
    });
    return { plan, tokens, tree: planToTree(activeClause, plan) };
  }, [activeClause, clause.subject.head, clause.verb.gloss, grammarConfig, wordsMap, phonoConfig]);

  const patchNP = (key: "subject" | "object", next: NPNode): void =>
    setClause((prev) => ({ ...prev, [key]: next }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-base-content/50">
            {t("grammar.alignment")}
          </span>
          <select
            className={`${SELECT} w-40`}
            value={grammarConfig.syntax.alignment ?? "nom_acc"}
            onChange={(event) =>
              updateSyntax({
                ...grammarConfig.syntax,
                alignment: event.target.value as MorphosyntacticAlignment,
              })
            }
            data-testid="clause-alignment"
          >
            <option value="nom_acc">{t("grammar.alignNomAcc")}</option>
            <option value="erg_abs">{t("grammar.alignErgAbs")}</option>
            <option value="tripartite">{t("grammar.alignTripartite")}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5 pb-1">
          <span className={`${BADGE} badge-ghost`}>{grammarConfig.syntax.word_order}</span>
          <span className={`${BADGE} badge-ghost`}>
            {grammarConfig.syntax.modifier_position === "before_head"
              ? t("grammar.beforeHead")
              : t("grammar.afterHead")}
          </span>
          <span className={`${BADGE} badge-ghost`}>
            {grammarConfig.syntax.adposition_type === "preposition"
              ? t("grammar.preposition")
              : t("grammar.postposition")}
          </span>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <NPBuilderRow
          label={t("sandbox.clause.subject")}
          value={clause.subject}
          onChange={(next) => patchNP("subject", next)}
          showPossessor
        />
        {hasObject && clause.object && (
          <NPBuilderRow
            label={t("sandbox.clause.object")}
            value={clause.object}
            onChange={(next) => patchNP("object", next)}
            showPossessor
            showPP
          />
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-lg border border-base-300 bg-base-200/30 p-2 grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-base-content/50">
              {t("sandbox.clause.verb")}
            </span>
            <input
              className={`${INPUT_MONO} w-full`}
              value={clause.verb.gloss}
              onChange={(event) =>
                setClause((prev) => ({
                  ...prev,
                  verb: { ...prev.verb, gloss: event.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-base-content/50">
              {t("sandbox.clause.tam")}
            </span>
            <input
              className={`${INPUT_MONO} w-full`}
              value={(clause.verb.tam ?? []).join(", ")}
              onChange={(event) =>
                setClause((prev) => ({
                  ...prev,
                  verb: {
                    ...prev.verb,
                    tam: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  },
                }))
              }
              placeholder="PST"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={hasObject ? `${BTN_GHOST} btn-active` : BTN_GHOST}
            onClick={() => setHasObject((value) => !value)}
          >
            {hasObject ? t("sandbox.clause.dropObject") : t("sandbox.clause.addObject")}
          </button>
          <button
            type="button"
            className={hasOblique ? `${BTN_GHOST} btn-active` : BTN_GHOST}
            onClick={() => setHasOblique((value) => !value)}
          >
            {hasOblique ? t("sandbox.clause.dropOblique") : t("sandbox.clause.addOblique")}
          </button>
        </div>
      </div>

      {rendered && (
        <div className="rounded-lg border border-base-200 bg-base-200/50 p-3 space-y-3">
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <tbody>
                <tr>
                  {rendered.tokens.map((token, index) => (
                    <td
                      key={`s:${index}`}
                      className="pr-5 pb-0.5 font-mono font-bold text-primary text-lg whitespace-nowrap"
                    >
                      {token.conlang}
                    </td>
                  ))}
                </tr>
                <tr>
                  {rendered.tokens.map((_token, index) => {
                    const word = rendered.plan.words[index];
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
                  {rendered.tokens.map((token, index) => (
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

          {rendered.plan.warnings.map((warning) => (
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
                {rendered.plan.steps.map((step) => (
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
                <TreeNode node={rendered.tree} />
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
