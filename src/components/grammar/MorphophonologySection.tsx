import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, FlaskConical } from "lucide-react";
import type { FeatureExpression, FeatureReplacement, MorphophonologyRule } from "../../types";
import { useGrammarStore } from "../../store/grammarStore";
import { usePhonoStore } from "../../store/phonoStore";
import { applyMorphophonology } from "../../core/engines/morphophonology";
import { INPUT, INPUT_MONO, BTN_PRIMARY, BTN_GHOST, BTN_ERROR, CARD } from "../../lib/ui";

function newRule(priority: number): MorphophonologyRule {
  return {
    rule_id: `mph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    description: "",
    priority,
    target: "",
    replacement: "",
    context_before: "",
    context_after: "",
    feature_mode: false,
    target_features: null,
    replacement_features: null,
    context_before_features: null,
    context_after_features: null,
  };
}

function expressionText(expr: FeatureExpression | null): string {
  if (!expr) return "";
  return [
    ...expr.positive.map((feature) => `+${feature}`),
    ...expr.negative.map((feature) => `-${feature}`),
  ].join(", ");
}

function parseExpression(text: string): FeatureExpression | null {
  const expr: FeatureExpression = { positive: [], negative: [] };
  const cleaned = text.replace(/^\[/u, "").replace(/\]$/u, "");
  for (const chunk of cleaned.split(",")) {
    const part = chunk.trim();
    if (!part || part === "+" || part === "-") continue;
    const negative = part.startsWith("-");
    const name = part.replace(/^[+-]/u, "").trim();
    if (!name) continue;
    if (negative) expr.negative.push(name);
    else expr.positive.push(name);
  }
  return expr.positive.length + expr.negative.length === 0 ? null : expr;
}

function replacementText(repl: FeatureReplacement | null): string {
  if (!repl) return "";
  return [
    ...repl.set_features.map((feature) => `+${feature}`),
    ...repl.remove_features.map((feature) => `-${feature}`),
  ].join(", ");
}

function parseReplacement(text: string): FeatureReplacement | null {
  const expr = parseExpression(text);
  if (!expr) return null;
  return { set_features: expr.positive, remove_features: expr.negative };
}

/** 共时形态音位规则编辑器（跨 `+` 边界，按 priority 升序执行） */
export const MorphophonologySection: React.FC = () => {
  const { t } = useTranslation();
  const rules = useGrammarStore((s) => s.config.morphophonology_rules) ?? [];
  const setRules = useGrammarStore((s) => s.setMorphophonologyRules);
  const phonoConfig = usePhonoStore((s) => s.config);
  const [testWord, setTestWord] = useState("ev+lar");
  /** 聚焦中的特征表达式草稿：避免逐字符解析后回写导致逗号被吞 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const update = (ruleId: string, patch: Partial<MorphophonologyRule>) => {
    setRules(rules.map((rule) => (rule.rule_id === ruleId ? { ...rule, ...patch } : rule)));
  };

  const bindFeature = (
    ruleId: string,
    field: string,
    stored: string,
    commit: (text: string) => void,
  ) => {
    const key = `${ruleId}:${field}`;
    return {
      value: drafts[key] ?? stored,
      onFocus: () => setDrafts((prev) => ({ ...prev, [key]: stored })),
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const text = event.target.value;
        setDrafts((prev) => ({ ...prev, [key]: text }));
        commit(text);
      },
      onBlur: () =>
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        }),
    };
  };

  const preview = testWord.includes("+")
    ? applyMorphophonology(testWord, rules, phonoConfig)
    : null;

  const featureInputs = (rule: MorphophonologyRule) => (
    <div className="grid grid-cols-4 gap-2">
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.target")}
        {...bindFeature(rule.rule_id, "target_features", expressionText(rule.target_features), (text) =>
          update(rule.rule_id, { target_features: parseExpression(text) }),
        )}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.replacement")}
        {...bindFeature(
          rule.rule_id,
          "replacement_features",
          replacementText(rule.replacement_features),
          (text) => update(rule.rule_id, { replacement_features: parseReplacement(text) }),
        )}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.before")}
        {...bindFeature(
          rule.rule_id,
          "context_before_features",
          expressionText(rule.context_before_features),
          (text) => update(rule.rule_id, { context_before_features: parseExpression(text) }),
        )}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.after")}
        {...bindFeature(
          rule.rule_id,
          "context_after_features",
          expressionText(rule.context_after_features),
          (text) => update(rule.rule_id, { context_after_features: parseExpression(text) }),
        )}
      />
    </div>
  );

  const literalInputs = (rule: MorphophonologyRule) => (
    <div className="grid grid-cols-4 gap-2">
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.target")}
        value={rule.target}
        onChange={(event) => update(rule.rule_id, { target: event.target.value })}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.replacement")}
        value={rule.replacement}
        onChange={(event) => update(rule.rule_id, { replacement: event.target.value })}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.before")}
        value={rule.context_before}
        onChange={(event) => update(rule.rule_id, { context_before: event.target.value })}
      />
      <input
        className={`${INPUT_MONO} text-xs`}
        placeholder={t("grammar.morphophonology.after")}
        value={rule.context_after}
        onChange={(event) => update(rule.rule_id, { context_after: event.target.value })}
      />
    </div>
  );

  return (
    <div className={`${CARD} space-y-3 p-4`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-base-content/80">
            {t("grammar.morphophonology.title")}
          </h3>
          <p className="text-xs text-base-content/50">
            {t("grammar.morphophonology.hint")}
          </p>
        </div>
        <button
          className={BTN_PRIMARY}
          onClick={() => setRules([...rules, newRule(rules.length + 1)])}
        >
          <Plus size={14} /> {t("grammar.morphophonology.addRule")}
        </button>
      </div>

      {rules.length === 0 && (
        <p className="text-sm text-base-content/50">{t("grammar.morphophonology.empty")}</p>
      )}

      {[...rules]
        .sort((a, b) => a.priority - b.priority)
        .map((rule) => (
          <div key={rule.rule_id} className="rounded border border-base-300 p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs" title={t("grammar.enabled")}>
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={!rule.disabled}
                  onChange={(event) =>
                    update(rule.rule_id, { disabled: !event.target.checked })
                  }
                />
                {t("grammar.enabled")}
              </label>
              <input
                className={`${INPUT} flex-1 text-xs`}
                placeholder={t("grammar.morphophonology.descriptionPlaceholder")}
                value={rule.description}
                onChange={(event) => update(rule.rule_id, { description: event.target.value })}
              />
              <input
                type="number"
                className={`${INPUT} w-16 text-xs`}
                value={rule.priority}
                onChange={(event) =>
                  update(rule.rule_id, { priority: Number(event.target.value) || 0 })
                }
                title={t("grammar.morphophonology.priority")}
              />
              <button
                className={BTN_ERROR}
                onClick={() => setRules(rules.filter((item) => item.rule_id !== rule.rule_id))}
                title={t("common.delete")}
              >
                <Trash2 size={12} />
              </button>
            </div>
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={rule.feature_mode}
                onChange={(event) =>
                  update(rule.rule_id, { feature_mode: event.target.checked })
                }
              />
              {t("grammar.morphophonology.featureMode")}
            </label>
            {rule.feature_mode ? featureInputs(rule) : literalInputs(rule)}
          </div>
        ))}

      <div className="flex items-center gap-2 border-t border-base-200 pt-2">
        <FlaskConical size={14} className="text-base-content/40" />
        <input
          className={`${INPUT_MONO} flex-1 text-xs`}
          value={testWord}
          onChange={(event) => setTestWord(event.target.value)}
          placeholder="ev+lar"
        />
        {preview && (
          <span className="font-mono text-xs text-success">
            {preview.intermediate} → {preview.surface}
          </span>
        )}
        <button className={BTN_GHOST} onClick={() => setTestWord("ev+lar")}>
          {t("grammar.morphophonology.resetTest")}
        </button>
      </div>
    </div>
  );
};
