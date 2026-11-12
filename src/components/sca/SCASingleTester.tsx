import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";
import { INPUT_MONO, BTN_PRIMARY_MD } from "../../lib/ui";
import type { applySoundChanges } from "../../utils/scaEngine";

type SingleResult = ReturnType<typeof applySoundChanges>;

interface SCASingleTesterProps {
  testWord: string;
  onTestWordChange: (value: string) => void;
  result: SingleResult | null;
}

/** 单词语音演变试算：输入 → 结果 + 逐步规则日志 */
export const SCASingleTester: React.FC<SCASingleTesterProps> = ({
  testWord,
  onTestWordChange,
  result,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input
          className={`${INPUT_MONO} flex-1`}
          placeholder={t("sca.testWordPlaceholder")}
          value={testWord}
          onChange={(event) => onTestWordChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
        />
        <button className={BTN_PRIMARY_MD} title={t("sca.runPreview")}>
          <Play className="w-4 h-4" />
        </button>
      </div>

      {result && (
        <div className="border border-base-200 rounded-lg p-4 space-y-2 bg-base-50">
          <div className="flex items-center gap-2 text-lg font-mono">
            <span className="text-base-content/60">{testWord}</span>
            <span className="text-base-content/50">→</span>
            <span className="font-bold text-primary">{result.result}</span>
          </div>
          {result.changelog.length > 0 ? (
            <div className="space-y-1">
              {result.changelog.map((step, index) => (
                <div key={index} className="text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-base-content/50">{step.before}</span>
                    <span className="text-base-content/50">→</span>
                    <span className="text-success">{step.after}</span>
                    <span className="text-base-content/60 italic">
                      ({step.description})
                    </span>
                  </div>
                  {step.feature_detail && (
                    <div className="ml-4 text-base-content/50">
                      {t("sca.featureDetail")}: {step.feature_detail}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-base-content/50">{t("sca.noChanges")}</p>
          )}
        </div>
      )}
    </div>
  );
};
