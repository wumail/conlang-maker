import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ClauseNode,
  ClausePolarity,
  NPNode,
} from "../../core/engines/phraseSandbox";
import { linearizeClause, planToTree } from "../../core/engines/phraseSandbox";
import { useLexiconStore } from "../../store/lexiconStore";
import { usePhonoStore } from "../../store/phonoStore";
import { useGrammarStore } from "../../store/grammarStore";
import {
  buildSampleClauseFromLexicon,
  processSandboxText,
} from "../../utils/sandbox";
import { NPBuilderRow } from "./NPBuilderRow";
import { SandboxResultCard } from "./SandboxResultCard";
import { BADGE, BTN_GHOST, INPUT_MONO, SELECT } from "../../lib/ui";
import type { MorphosyntacticAlignment } from "../../types";

const DEFAULT_CLAUSE: ClauseNode = {
  subject: { head: "dog", determiner: "the", adjectives: ["big"], number: "SG" },
  verb: { gloss: "bite", tam: ["PST"] },
  object: { head: "bone", determiner: "the", number: "SG" },
  polarity: "affirmative",
};

/** 结构化句法台：主语 NP / 动词 TAM / 宾语 NP / 斜格 PP / 极性 */
export function ClauseBuilderCard() {
  const { t } = useTranslation();
  const wordsMap = useLexiconStore((state) => state.wordsMap);
  const phonoConfig = usePhonoStore((state) => state.config);
  const grammarConfig = useGrammarStore((state) => state.config);
  const updateSyntax = useGrammarStore((state) => state.updateSyntax);

  const wordCount = Object.keys(wordsMap).length;
  const seedKey = `${grammarConfig.language_id}:${wordCount > 0 ? "loaded" : "empty"}`;
  const lastSeedKeyRef = useRef(seedKey);

  const [clause, setClause] = useState<ClauseNode>(() =>
    buildSampleClauseFromLexicon(wordsMap, grammarConfig, DEFAULT_CLAUSE),
  );
  const [hasObject, setHasObject] = useState(true);
  const [hasOblique, setHasOblique] = useState(false);

  useEffect(() => {
    if (lastSeedKeyRef.current === seedKey) return;
    lastSeedKeyRef.current = seedKey;
    setClause(buildSampleClauseFromLexicon(wordsMap, grammarConfig, DEFAULT_CLAUSE));
  }, [seedKey, wordsMap, grammarConfig]);

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
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-base-content/50">
            {t("sandbox.clause.polarity")}
          </span>
          <select
            className={`${SELECT} w-36`}
            value={clause.polarity ?? "affirmative"}
            onChange={(event) =>
              setClause((prev) => ({
                ...prev,
                polarity: event.target.value as ClausePolarity,
              }))
            }
            data-testid="clause-polarity"
          >
            <option value="affirmative">{t("sandbox.clause.affirmative")}</option>
            <option value="negative">{t("sandbox.clause.negative")}</option>
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
          showNumber
        />
        {hasObject && clause.object && (
          <NPBuilderRow
            label={t("sandbox.clause.object")}
            value={clause.object}
            onChange={(next) => patchNP("object", next)}
            showPossessor
            showPP
            showNumber
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
          {wordCount > 0 && (
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() =>
                setClause(
                  buildSampleClauseFromLexicon(wordsMap, grammarConfig, DEFAULT_CLAUSE),
                )
              }
            >
              {t("sandbox.clause.loadSample")}
            </button>
          )}
        </div>
      </div>

      {rendered && (
        <SandboxResultCard
          plan={rendered.plan}
          tokens={rendered.tokens}
          tree={rendered.tree}
        />
      )}
    </div>
  );
}
