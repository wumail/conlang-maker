import { useEffect, useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { ModalPortal } from "./ModalPortal";

export type ToastTone = "success" | "error" | "info";

interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** When provided, the toast gets a close button (and Esc dismisses it). */
  onClose?: () => void;
  /** Auto-dismiss delay in ms. `0` keeps the toast until dismissed. */
  durationMs?: number;
  testId?: string;
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: "alert-success",
  error: "alert-error",
  info: "alert-info",
};

const TONE_ICON: Record<ToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

/**
 * Floating status message.
 *
 * Rendered through a portal and positioned with `fixed`, so showing or hiding it
 * never reflows the page underneath (no layout "jitter").
 */
export const Toast: FC<ToastProps> = ({
  message,
  tone = "success",
  onClose,
  durationMs = 0,
  testId,
}) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (durationMs <= 0 || !onClose) return;
    const timer = window.setTimeout(onClose, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onClose, message]);

  useEffect(() => {
    if (!onClose) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!message) return null;

  const Icon = TONE_ICON[tone];
  // Product style: prompts never end with a period (also trims backend messages).
  const trimmed = message.trim();
  const text = trimmed.replace(/[\u3002.]$/, "") || trimmed;

  return (
    <ModalPortal open>
      <div
        className="fixed inset-x-0 top-6 z-[80] flex justify-center px-4 pointer-events-none"
        aria-live="polite"
      >
        <div
          role="status"
          className={`alert ${TONE_CLASS[tone]} alert-soft shadow-lg max-w-[min(32rem,calc(100vw-2rem))] gap-2 items-start pointer-events-auto transition-all duration-200 ease-out ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
          }`}
          data-testid={testId}
        >
          <Icon className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="text-sm break-words min-w-0 flex-1">{text}</span>
          {onClose && (
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square shrink-0 -mr-1"
              onClick={onClose}
              aria-label={t("common.close")}
              data-testid={testId ? `${testId}-close` : undefined}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </ModalPortal>
  );
};
