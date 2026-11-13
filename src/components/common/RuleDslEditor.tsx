import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { BTN_PRIMARY, BTN_GHOST, TEXTAREA } from "../../lib/ui";
import type { DslParseResult } from "../../core/engines/ruleDsl";

interface RuleDslEditorProps<T> {
  open: boolean;
  title: string;
  hint: string;
  initialText: string;
  parse: (text: string) => DslParseResult<T>;
  onApply: (rules: T[]) => void;
  onClose: () => void;
}

/**
 * 单行语言学 DSL 编辑器（经 ModalPortal 挂载）。
 *
 * 逐行实时解析：有诊断时禁用「应用到表单」，避免半成品规则写回 Store。
 */
export function RuleDslEditor<T>({
  open,
  title,
  hint,
  initialText,
  parse,
  onApply,
  onClose,
}: RuleDslEditorProps<T>) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);

  useEffect(() => {
    if (open) setText(initialText);
  }, [open, initialText]);

  const result = useMemo(() => parse(text), [parse, text]);
  const canApply = result.diagnostics.length === 0 && result.rules.length > 0;

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-3xl">
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-xs text-base-content/60 mt-1">{hint}</p>

          <textarea
            className={`w-full ${TEXTAREA} min-h-[16rem] mt-3 font-mono text-sm leading-6`}
            value={text}
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
          />

          <div className="mt-2 flex items-center gap-3 text-xs">
            {result.diagnostics.length === 0 ? (
              <span className="inline-flex items-center gap-1 text-success">
                <CheckCircle2 size={13} />
                {t("ruleDsl.valid", { count: result.rules.length })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-error">
                <AlertTriangle size={13} />
                {t("ruleDsl.errorCount", { count: result.diagnostics.length })}
              </span>
            )}
          </div>

          {result.diagnostics.length > 0 && (
            <ul className="mt-2 max-h-32 overflow-y-auto rounded border border-error/30 bg-error/10 px-2 py-1 text-xs text-error space-y-0.5">
              {result.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.line}_${index}`} className="font-mono">
                  L{diagnostic.line}: {diagnostic.message}
                </li>
              ))}
            </ul>
          )}

          <div className="modal-action">
            <button
              className={BTN_PRIMARY}
              disabled={!canApply}
              onClick={() => {
                onApply(result.rules);
                onClose();
              }}
            >
              {t("ruleDsl.apply")}
            </button>
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
