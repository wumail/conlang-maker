import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal";
import { INPUT, TEXTAREA, BTN_PRIMARY, BTN_GHOST } from "../../lib/ui";

interface SCARuleSetImportModalProps {
  open: boolean;
  name: string;
  text: string;
  errors: string[];
  onNameChange: (value: string) => void;
  onTextChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

/** 「从文本导入规则集」弹窗（经 ModalPortal 挂载） */
export const SCARuleSetImportModal: React.FC<SCARuleSetImportModalProps> = ({
  open,
  name,
  text,
  errors,
  onNameChange,
  onTextChange,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation();

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-3xl">
          <h3 className="font-bold text-lg">{t("sca.importRuleSetTitle")}</h3>
          <p className="text-xs text-base-content/60 mt-1">{t("sca.importRuleSetHint")}</p>

          <div className="space-y-2 mt-4">
            <label className="text-xs text-base-content/70">
              {t("sca.importRuleSetName")}
            </label>
            <input
              className={`${INPUT} w-full`}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder={t("sca.importRuleSetNamePlaceholder")}
            />
          </div>

          <div className="space-y-2 mt-3">
            <label className="text-xs text-base-content/70">
              {t("sca.importRuleSetText")}
            </label>
            <textarea
              className={`w-full ${TEXTAREA} min-h-[220px] font-mono text-sm`}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              placeholder={t("sca.importRuleSetPlaceholder")}
            />
            <p className="text-xs text-base-content/50 whitespace-pre-line">
              {t("sca.importRuleSetExample")}
            </p>
          </div>

          {errors.length > 0 && (
            <div className="mt-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error space-y-1">
              <p className="font-medium">{t("sca.importRuleSetParseFailed")}</p>
              {errors.map((error, index) => (
                <p key={`${index}_${error}`}>{error}</p>
              ))}
            </div>
          )}

          <div className="modal-action">
            <button className={BTN_PRIMARY} onClick={onConfirm}>
              {t("sca.importRuleSetConfirm")}
            </button>
            <button className={BTN_GHOST} onClick={onClose}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
