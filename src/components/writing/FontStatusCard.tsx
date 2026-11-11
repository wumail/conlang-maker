import React from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen, Trash2, Type } from "lucide-react";
import type { FontInspection } from "../../types";
import {
  BADGE,
  BTN_GHOST,
  BTN_OUTLINE_ERROR,
  BTN_PRIMARY,
  CARD,
  CARD_BODY,
} from "../../lib/ui";

interface FontStatusCardProps {
  inspection: FontInspection;
  fontError: string | null;
  busy: boolean;
  onImport: () => void;
  onRemoveRequest: () => void;
  onShowFolder: () => void;
}

export const FontStatusCard: React.FC<FontStatusCardProps> = ({
  inspection,
  fontError,
  busy,
  onImport,
  onRemoveRequest,
  onShowFolder,
}) => {
  const { t } = useTranslation();

  return (
    <section className={CARD} data-testid="writing-font-status">
      <div className={`${CARD_BODY} gap-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0 flex-1">
            {!inspection.present ? (
              <div>
                <h2 className="text-base font-semibold">
                  {t("writing.noneTitle")}
                </h2>
                <p className="text-xs text-base-content/60 mt-0.5">
                  {t("writing.noneBody")}
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`${BADGE} badge-primary badge-soft`}
                    data-testid="writing-badge"
                  >
                    {inspection.has_own
                      ? t("writing.ownBadge")
                      : t("writing.inheritedBadge", {
                          name: inspection.owner_name ?? "",
                        })}
                  </span>
                  <span className="text-xs font-mono bg-base-200/80 border border-base-300/60 px-2 py-0.5 rounded text-base-content/80">
                    {inspection.file_name}
                  </span>
                </div>
                <p className="text-xs text-base-content/60">
                  {inspection.has_own
                    ? t("writing.overrideHint")
                    : t("writing.inheritedHint", {
                        name: inspection.owner_name ?? "",
                      })}
                </p>
              </>
            )}
            <p className="text-xs text-base-content/50">
              {t("writing.inheritHint")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              className={BTN_PRIMARY}
              onClick={onImport}
              disabled={busy}
              data-testid="writing-import"
            >
              <Type className="w-4 h-4" />
              {inspection.has_own ? t("writing.replace") : t("writing.import")}
            </button>
            {inspection.has_own && (
              <button
                className={BTN_OUTLINE_ERROR}
                onClick={onRemoveRequest}
                disabled={busy}
                data-testid="writing-remove"
              >
                <Trash2 className="w-4 h-4" />
                {t("writing.remove")}
              </button>
            )}
            <button
              className={BTN_GHOST}
              onClick={onShowFolder}
              data-testid="writing-folder"
            >
              <FolderOpen className="w-4 h-4" />
              {t("writing.showFolder")}
            </button>
          </div>
        </div>

        {inspection.present && (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm rounded-lg border border-base-200 bg-base-200/40 p-3">
            <div className="min-w-0">
              <dt className="text-xs font-medium text-base-content/50">
                {t("writing.family")}
              </dt>
              <dd
                className="font-medium mt-0.5 truncate"
                data-testid="writing-family"
              >
                {inspection.family_name ?? t("writing.unknown")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-base-content/50">
                {t("writing.version")}
              </dt>
              <dd
                className="font-medium mt-0.5 truncate"
                data-testid="writing-version"
              >
                {inspection.version ?? t("writing.unknown")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-base-content/50">
                {t("writing.file")}
              </dt>
              <dd className="font-mono font-medium mt-0.5 truncate">
                {inspection.file_name ?? t("writing.unknown")}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium text-base-content/50">
                {t("writing.count")}
              </dt>
              <dd
                className="font-medium mt-0.5 truncate"
                data-testid="writing-count"
              >
                {t("writing.countValue", {
                  count: inspection.codepoints.length,
                })}
              </dd>
            </div>
          </dl>
        )}

        {fontError && (
          <div
            role="alert"
            className="alert alert-error alert-soft text-xs py-2"
          >
            {t("writing.fontLoadFailed")} {fontError}
          </div>
        )}
        {inspection.warning && (
          <div
            role="alert"
            className="alert alert-warning alert-soft text-xs py-2"
          >
            {t("writing.parseWarning", { warning: inspection.warning })}
          </div>
        )}
      </div>
    </section>
  );
};
