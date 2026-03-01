import { useTranslation } from "react-i18next";
import { PHONEME_FEATURES } from "../../data/ipa_features";
import { FeatureExpression, FeatureReplacement } from "../../types";
import { findMatchingPhonemes } from "../../utils/scaEngine";
import { usePhonoStore } from "../../store/phonoStore";
import { BADGE } from "../../lib/ui";

/** 从 PHONEME_FEATURES 提取所有可用特征标签 */
function getAllFeatures(): string[] {
  const featureSet = new Set<string>();
  for (const features of Object.values(PHONEME_FEATURES)) {
    for (const f of features) featureSet.add(f);
  }
  return [...featureSet].sort();
}

const ALL_FEATURES = getAllFeatures();

interface FeatureExprEditorProps {
  label: string;
  value: FeatureExpression | null;
  onChange: (val: FeatureExpression) => void;
}

/** 特征表达式编辑器（+/- 特征选择） */
export function FeatureExprEditor({
  label,
  value,
  onChange,
}: FeatureExprEditorProps) {
  const { t } = useTranslation();
  const inventory = usePhonoStore((s) => s.config.phoneme_inventory);
  const expr: FeatureExpression = value || { positive: [], negative: [] };

  const toggleFeature = (feat: string) => {
    const inPos = expr.positive.includes(feat);
    const inNeg = expr.negative.includes(feat);
    if (!inPos && !inNeg) {
      // add as positive
      onChange({ ...expr, positive: [...expr.positive, feat] });
    } else if (inPos) {
      // switch to negative
      onChange({
        positive: expr.positive.filter((f) => f !== feat),
        negative: [...expr.negative, feat],
      });
    } else {
      // remove
      onChange({
        positive: expr.positive,
        negative: expr.negative.filter((f) => f !== feat),
      });
    }
  };

  // 计算匹配音素（限定为当前语言的音素库）
  const allMatching = findMatchingPhonemes(expr);
  const allInventory = [...inventory.consonants, ...inventory.vowels];
  const matching =
    allInventory.length > 0
      ? allMatching.filter((p) => allInventory.includes(p))
      : allMatching;

  return (
    <div className="space-y-1">
      <label className="text-xs text-base-content/60">{label}</label>
      <div className="flex flex-wrap gap-1">
        {ALL_FEATURES.map((feat) => {
          const inPos = expr.positive.includes(feat);
          const inNeg = expr.negative.includes(feat);
          let cls =
            "cursor-pointer select-none text-xs px-1.5 py-0.5 rounded border ";
          if (inPos) cls += "bg-green-100 text-green-800 border-green-300";
          else if (inNeg) cls += "bg-red-100 text-red-800 border-red-300";
          else
            cls +=
              "bg-base-200/50 text-base-content/50 border-base-300 hover:bg-base-200";
          return (
            <span
              key={feat}
              className={cls}
              onClick={() => toggleFeature(feat)}
            >
              {inPos && "+"}
              {inNeg && "−"}
              {feat}
            </span>
          );
        })}
      </div>
      {matching.length > 0 && (
        <div className="text-xs text-base-content/60">
          {t("sca.matchingPhonemes")}:{" "}
          {matching.map((p) => (
            <span key={p} className={`${BADGE} mx-0.5 font-mono`}>
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface FeatureReplEditorProps {
  label: string;
  value: FeatureReplacement | null;
  onChange: (val: FeatureReplacement) => void;
}

/** 特征替换编辑器（set/remove 特征） */
export function FeatureReplEditor({
  label,
  value,
  onChange,
}: FeatureReplEditorProps) {
  const { t } = useTranslation();
  const repl: FeatureReplacement = value || {
    set_features: [],
    remove_features: [],
  };

  const toggleFeature = (feat: string) => {
    const inSet = repl.set_features.includes(feat);
    const inRem = repl.remove_features.includes(feat);
    if (!inSet && !inRem) {
      onChange({ ...repl, set_features: [...repl.set_features, feat] });
    } else if (inSet) {
      onChange({
        set_features: repl.set_features.filter((f) => f !== feat),
        remove_features: [...repl.remove_features, feat],
      });
    } else {
      onChange({
        set_features: repl.set_features,
        remove_features: repl.remove_features.filter((f) => f !== feat),
      });
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs text-base-content/60">{label}</label>
      <div className="flex flex-wrap gap-1">
        {ALL_FEATURES.map((feat) => {
          const inSet = repl.set_features.includes(feat);
          const inRem = repl.remove_features.includes(feat);
          let cls =
            "cursor-pointer select-none text-xs px-1.5 py-0.5 rounded border ";
          if (inSet) cls += "bg-primary/15 text-primary border-primary/40";
          else if (inRem)
            cls += "bg-orange-100 text-orange-800 border-orange-300";
          else
            cls +=
              "bg-base-200/50 text-base-content/50 border-base-300 hover:bg-base-200";
          return (
            <span
              key={feat}
              className={cls}
              onClick={() => toggleFeature(feat)}
            >
              {inSet && `${t("sca.setFeatures")}: `}
              {inRem && `${t("sca.removeFeatures")}: `}
              {feat}
            </span>
          );
        })}
      </div>
    </div>
  );
}
