/**
 * OnboardingStartModal.tsx — 新建项目三路径引导（Roadmap v3 / Pillar 7）
 *
 * 让用户选择起步重心：从词典开始 / 单语言完整搭建 / 多语言语系演化，
 * 创建完成后直接进入对应页面。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, AudioLines, GitFork, Plus } from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { BTN_GHOST, BTN_PRIMARY, INPUT, CHECKBOX } from "../../lib/ui";

export type OnboardingPath = "lexicon" | "phonology" | "tree";

const PATHS: Array<{
  path: OnboardingPath;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
}> = [
  {
    path: "lexicon",
    labelKey: "welcome.onboarding.pathLexiconTitle",
    descKey: "welcome.onboarding.pathLexiconDesc",
    icon: <BookOpen size={16} />,
  },
  {
    path: "phonology",
    labelKey: "welcome.onboarding.pathSingleLangTitle",
    descKey: "welcome.onboarding.pathSingleLangDesc",
    icon: <AudioLines size={16} />,
  },
  {
    path: "tree",
    labelKey: "welcome.onboarding.pathFamilyTitle",
    descKey: "welcome.onboarding.pathFamilyDesc",
    icon: <GitFork size={16} />,
  },
];

interface OnboardingStartModalProps {
  open: boolean;
  creating: boolean;
  onCreate: (name: string, path: OnboardingPath) => void;
  onCancel: () => void;
}

export const OnboardingStartModal: React.FC<OnboardingStartModalProps> = ({
  open,
  creating,
  onCreate,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [path, setPath] = useState<OnboardingPath>("lexicon");

  return (
    <ModalPortal open={open}>
      <div className="modal modal-open">
        <div className="modal-box max-w-lg">
          <h3 className="text-lg font-bold">{t("welcome.onboarding.title")}</h3>

          <label className="mt-3 block text-xs text-base-content/60">
            {t("welcome.familyName")}
          </label>
          <input
            className={`${INPUT} mt-1 w-full`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("welcome.familyNamePlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) onCreate(name.trim(), path);
            }}
          />

          <div className="mt-4 space-y-2">
            {PATHS.map((item) => (
              <button
                key={item.path}
                type="button"
                className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left ${
                  path === item.path
                    ? "border-primary bg-primary/10"
                    : "border-base-300 hover:border-base-content/30"
                }`}
                onClick={() => setPath(item.path)}
              >
                <span className="mt-0.5 text-primary">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{t(item.labelKey)}</span>
                  <span className="block text-xs text-base-content/60">{t(item.descKey)}</span>
                </span>
                <input
                  type="radio"
                  className={`${CHECKBOX} ml-auto mt-1`}
                  checked={path === item.path}
                  readOnly
                />
              </button>
            ))}
          </div>

          <div className="modal-action">
            <button type="button" className={BTN_GHOST} onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={!name.trim() || creating}
              onClick={() => onCreate(name.trim(), path)}
            >
              <Plus className="w-4 h-4" /> {t("welcome.createProject")}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
