import React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BTN_PRIMARY, BTN_GHOST, CARD, CARD_BODY } from "../../lib/ui";
import { useWorkspaceStore } from "../../store/workspaceStore";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

interface ErrorFallbackProps {
  error: Error;
  onResetToWelcome: () => void;
  onReload: () => void;
}

function ErrorFallback({ error, onResetToWelcome, onReload }: ErrorFallbackProps) {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-base-200 text-base-content font-sans">
      <header
        className="titlebar bg-base-300 text-base-content flex items-center h-9 px-2 shrink-0 select-none"
        data-tauri-drag-region
      >
        <div className="traffic-lights flex items-center gap-1.5 ml-1">
          <button
            type="button"
            className="tl-btn tl-close"
            onClick={() => {
              void appWindow.close();
            }}
            title={t("titlebar.close")}
          />
          <button
            type="button"
            className="tl-btn tl-minimize"
            onClick={() => {
              void appWindow.minimize();
            }}
            title={t("titlebar.minimize")}
          />
          <button
            type="button"
            className="tl-btn tl-maximize"
            onClick={() => {
              void appWindow.toggleMaximize();
            }}
            title={t("titlebar.maximize")}
          />
        </div>
        <div className="flex-1 min-w-0" data-tauri-drag-region />
      </header>

      <main className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
        <div className={`${CARD} max-w-lg w-full`}>
          <div className={`${CARD_BODY} gap-4`}>
            <div className="flex items-center gap-2 text-error font-bold text-base">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{t("errorBoundary.title")}</span>
            </div>
            <p className="text-sm text-base-content/70">
              {t("errorBoundary.description")}
            </p>
            <pre className="p-3 rounded bg-base-200 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {error.message || String(error)}
            </pre>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={BTN_GHOST}
                onClick={onResetToWelcome}
              >
                {t("errorBoundary.backToWelcome")}
              </button>
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={onReload}
              >
                <RotateCcw className="w-4 h-4" />
                {t("errorBoundary.reload")}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Uncaught UI error:", error, info.componentStack);
  }

  handleResetToWelcome = (): void => {
    useWorkspaceStore.getState().clearWorkspace();
    window.location.hash = "#/welcome";
    this.setState({ error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          onResetToWelcome={this.handleResetToWelcome}
          onReload={this.handleReload}
        />
      );
    }
    return this.props.children;
  }
}
