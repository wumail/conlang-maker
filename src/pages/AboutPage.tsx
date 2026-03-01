import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { BTN_PRIMARY } from "../lib/ui";
import { GITHUB_REPO_OWNER, GITHUB_REPO_NAME } from "../constants";

interface GithubRelease {
  tag_name: string;
  html_url: string;
  published_at: string;
  body: string;
}

import { check } from "@tauri-apps/plugin-updater";

type UpdaterResult = Awaited<ReturnType<typeof check>>;

export function AboutPage() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState<boolean | null>(null);
  const [latestVersion, setLatestVersion] = useState<string>("");
  const [releaseBody, setReleaseBody] = useState<string>("");
  const [pendingUpdate, setPendingUpdate] = useState<UpdaterResult>(null);
  const [installing, setInstalling] = useState(false);
  const [installDone, setInstallDone] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("unknown"));
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setCheckError("");
    setUpdateAvailable(null);
    setInstallDone(false);
    try {
      const update = await check();
      if (update?.available) {
        setUpdateAvailable(true);
        setLatestVersion(update.version || "unknown");
        setReleaseBody(update.body || "");
        setPendingUpdate(update);
      } else {
        setUpdateAvailable(false);
        setPendingUpdate(null);
      }
    } catch (err) {
      setPendingUpdate(null);
      // Fallback network check using GitHub API
      try {
        const res = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GithubRelease;
        const latestVersionString = data.tag_name.replace(/^v/, "");
        if (latestVersionString !== appVersion && appVersion !== "unknown") {
          setUpdateAvailable(true);
          setLatestVersion(latestVersionString);
          setReleaseBody(data.body || "");
        } else {
          setUpdateAvailable(false);
        }
      } catch (fallbackErr) {
        setCheckError(
          `${String(err)} \n Fallback error: ${String(fallbackErr)}`,
        );
      }
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!pendingUpdate || !pendingUpdate.available) return;
    setInstalling(true);
    setCheckError("");
    try {
      await pendingUpdate.downloadAndInstall();
      setInstallDone(true);
    } catch (err) {
      setCheckError(String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Conlang Maker</h1>
          <p className="text-base-content/60">
            {t("about.version")}: {appVersion || "..."}
          </p>
        </div>

        <div className="space-y-3">
          <button
            className={BTN_PRIMARY}
            onClick={checkUpdate}
            disabled={checking}
          >
            <RefreshCw
              className={`w-4 h-4 ${checking ? "animate-spin" : ""}`}
            />
            {t("about.checkUpdate")}
          </button>

          {checkError && (
            <p className="text-sm text-error">
              {t("about.checkFailed")}: {checkError}
            </p>
          )}

          {updateAvailable !== null && (
            <div className="card bg-base-100 shadow-sm border border-base-200 p-4 space-y-2">
              <div className="flex items-center gap-2">
                {updateAvailable ? (
                  <>
                    <span className="font-semibold">v{latestVersion}</span>
                    <span className="badge badge-sm badge-success">
                      {t("about.newVersion")}
                    </span>
                  </>
                ) : (
                  <span className="badge badge-sm badge-info">
                    {t("about.upToDate")}
                  </span>
                )}
              </div>
              {updateAvailable && releaseBody && (
                <p className="text-sm text-base-content/70 whitespace-pre-wrap line-clamp-6">
                  {releaseBody}
                </p>
              )}
              {updateAvailable && pendingUpdate && (
                <button
                  className={BTN_PRIMARY}
                  onClick={installUpdate}
                  disabled={installing}
                >
                  {installing ? t("about.installing") : t("about.install")}
                </button>
              )}
              {installDone && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-success">{t("about.installDone")}</p>
                  <button
                    className={BTN_PRIMARY}
                    onClick={() => relaunch()}
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t("about.restartNow")}
                  </button>
                </div>
              )}
              <button
                onClick={() => openUrl(`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`)}
                className="text-sm text-primary flex items-center gap-1 cursor-pointer hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />{" "}
                {t("about.viewRelease")}
              </button>
            </div>
          )}
        </div>

        <div className="text-xs text-base-content/40 space-y-1">
          <p>
            GitHub:{" "}
            <button
              onClick={() => openUrl(`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`)}
              className="text-primary cursor-pointer hover:underline"
            >
              {GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
