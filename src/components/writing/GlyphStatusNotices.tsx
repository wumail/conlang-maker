import { useTranslation } from "react-i18next";
import { Archive, GitBranch } from "lucide-react";
import { BADGE, BTN_PRIMARY } from "../../lib/ui";

interface GlyphStatusNoticesProps {
  inherited: boolean;
  ownerLanguageName: string;
  onLocalize: () => void;
  legacyFieldsPresent: boolean;
}

/** 字形面板顶部的继承标注 / 旧版字段提示 */
export function GlyphStatusNotices({
  inherited,
  ownerLanguageName,
  onLocalize,
  legacyFieldsPresent,
}: GlyphStatusNoticesProps) {
  const { t } = useTranslation();

  return (
    <>
      {inherited && (
        <div
          className="alert alert-info alert-soft py-2.5 px-3 text-xs flex flex-wrap items-center justify-between gap-2"
          data-testid="glyph-inherited-notice"
        >
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 shrink-0" />
            <span className={`${BADGE} badge-info`}>
              {t("writing.inheritedAnnotationsBadge", { name: ownerLanguageName })}
            </span>
            <span>
              {t("writing.inheritedAnnotationsHint", { name: ownerLanguageName })}
            </span>
          </div>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={onLocalize}
            data-testid="localize-parent-annotations"
          >
            {t("writing.localizeAnnotations")}
          </button>
        </div>
      )}

      {legacyFieldsPresent && (
        <div
          className="alert alert-soft py-2 px-3 text-xs flex items-center gap-2 border border-base-300"
          data-testid="glyph-legacy-notice"
        >
          <Archive className="w-4 h-4 shrink-0 text-base-content/60" />
          <span className="text-base-content/70">{t("writing.legacyWritingNotice")}</span>
        </div>
      )}
    </>
  );
}
