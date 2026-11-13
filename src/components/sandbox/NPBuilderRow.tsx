import React from "react";
import { useTranslation } from "react-i18next";
import type { NPNode } from "../../core/engines/phraseSandbox";
import { INPUT_MONO } from "../../lib/ui";

interface NPBuilderRowProps {
  label: string;
  value: NPNode;
  onChange: (next: NPNode) => void;
  showPossessor?: boolean;
  showPP?: boolean;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-0.5">
    <span className="text-[10px] uppercase tracking-wide text-base-content/50">
      {label}
    </span>
    {children}
  </label>
);

/** 单个名词短语编辑器：限定词 / 数词 / 形容词 / 领属者 / 嵌套 PP */
export const NPBuilderRow: React.FC<NPBuilderRowProps> = ({
  label,
  value,
  onChange,
  showPossessor = false,
  showPP = false,
}) => {
  const { t } = useTranslation();
  const patch = (next: Partial<NPNode>): void => onChange({ ...value, ...next });

  return (
    <div className="rounded-lg border border-base-300 bg-base-200/30 p-2 space-y-1.5">
      <div className="text-xs font-medium text-base-content/70">{label}</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("sandbox.clause.head")}>
          <input
            className={`${INPUT_MONO} w-full`}
            value={value.head}
            onChange={(event) => patch({ head: event.target.value })}
            placeholder="dog"
          />
        </Field>
        <Field label={t("sandbox.clause.determiner")}>
          <input
            className={`${INPUT_MONO} w-full`}
            value={value.determiner ?? ""}
            onChange={(event) => patch({ determiner: event.target.value || undefined })}
            placeholder="the"
          />
        </Field>
        <Field label={t("sandbox.clause.numeral")}>
          <input
            className={`${INPUT_MONO} w-full`}
            value={value.numeral ?? ""}
            onChange={(event) => patch({ numeral: event.target.value || undefined })}
            placeholder="two"
          />
        </Field>
        <Field label={t("sandbox.clause.adjectives")}>
          <input
            className={`${INPUT_MONO} w-full`}
            value={(value.adjectives ?? []).join(", ")}
            onChange={(event) =>
              patch({
                adjectives: event.target.value
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              })
            }
            placeholder="big, angry"
          />
        </Field>
        {showPossessor && (
          <Field label={t("sandbox.clause.possessor")}>
            <input
              className={`${INPUT_MONO} w-full`}
              value={value.possessor?.head ?? ""}
              onChange={(event) =>
                patch({
                  possessor: event.target.value
                    ? { head: event.target.value }
                    : undefined,
                })
              }
              placeholder="wolf"
            />
          </Field>
        )}
        {showPP && (
          <>
            <Field label={t("sandbox.clause.ppAdposition")}>
              <input
                className={`${INPUT_MONO} w-full`}
                value={value.pp?.adposition ?? ""}
                onChange={(event) =>
                  patch({
                    pp: event.target.value
                      ? {
                          adposition: event.target.value,
                          object: value.pp?.object ?? { head: "house" },
                        }
                      : undefined,
                  })
                }
                placeholder="in"
              />
            </Field>
            <Field label={t("sandbox.clause.ppObject")}>
              <input
                className={`${INPUT_MONO} w-full`}
                value={value.pp?.object.head ?? ""}
                onChange={(event) =>
                  patch({
                    pp: value.pp
                      ? {
                          adposition: value.pp.adposition,
                          object: { ...value.pp.object, head: event.target.value },
                        }
                      : undefined,
                  })
                }
                placeholder="house"
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
};
