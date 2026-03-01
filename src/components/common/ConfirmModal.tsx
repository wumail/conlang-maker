import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";
import { BTN_GHOST, BTN_OUTLINE_ERROR } from "../../lib/ui";
import { ModalPortal } from "./ModalPortal";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box">
          <h3 className="font-bold text-lg flex items-center gap-2 text-error">
            <AlertTriangle size={20} /> {title}
          </h3>
          <p className="py-3 text-sm text-base-content/70">{message}</p>
          <div className="modal-action">
            <button className={BTN_GHOST} onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button className={BTN_OUTLINE_ERROR} onClick={onConfirm}>
              {confirmLabel ?? t("common.confirm")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
