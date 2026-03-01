import React from "react";
import { useTranslation } from "react-i18next";
import { usePhonoStore } from "../../store/phonoStore";
import { ToneDefinition } from "../../types";
import { Plus, Trash2 } from "lucide-react";
import { INPUT, INPUT_MONO, BTN_ERROR, BTN_LINK, TOGGLE } from "../../lib/ui";
import { ConfirmModal } from "../common/ConfirmModal";

/** Vowel harmony toggle + group A/B inputs */
export const VowelHarmonySection: React.FC = () => {
  const { t } = useTranslation();
  const { config, updateVowelHarmony } = usePhonoStore();
  const vowelHarmony = config.phonotactics.vowel_harmony ?? {
    enabled: false,
    group_a: [],
    group_b: [],
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <label className="text-sm font-medium text-base-content/80">
          {t("phonology.phonotactics.vowelHarmony")}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={vowelHarmony.enabled}
            onChange={(e) =>
              updateVowelHarmony({ ...vowelHarmony, enabled: e.target.checked })
            }
            className={TOGGLE}
          />
          <span className="text-sm text-base-content/70">
            {t("common.enabled")}
          </span>
        </label>
      </div>

      {vowelHarmony.enabled && (
        <div className="space-y-3 p-4 bg-base-200/50 rounded-lg border border-base-300">
          <p className="text-xs text-base-content/60">
            {t("phonology.phonotactics.vowelHarmonyHint")}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-base-content/70 mb-1">
                {t("phonology.phonotactics.groupA")}
              </label>
              <input
                type="text"
                value={vowelHarmony.group_a.join(", ")}
                onChange={(e) =>
                  updateVowelHarmony({
                    ...vowelHarmony,
                    group_a: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={`w-full ${INPUT_MONO}`}
                placeholder="a, o, u"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-base-content/70 mb-1">
                {t("phonology.phonotactics.groupB")}
              </label>
              <input
                type="text"
                value={vowelHarmony.group_b.join(", ")}
                onChange={(e) =>
                  updateVowelHarmony({
                    ...vowelHarmony,
                    group_b: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={`w-full ${INPUT_MONO}`}
                placeholder="e, i, ü"
              />
            </div>
          </div>
          {config.phoneme_inventory.vowels.length > 0 && (
            <div className="text-xs text-base-content/50">
              {t("phonology.phonotactics.inventoryVowels")}:{" "}
              <span className="font-mono">
                {config.phoneme_inventory.vowels.join(" ")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Tone system toggle + tone definition list */
export const ToneSystemSection: React.FC = () => {
  const { t } = useTranslation();
  const { config, updateToneSystem } = usePhonoStore();
  const toneSystem = config.phonotactics.tone_system ?? {
    enabled: false,
    tones: [],
  };
  const [confirmDeleteToneIdx, setConfirmDeleteToneIdx] = React.useState<number | null>(null);

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <label className="text-sm font-medium text-base-content/80">
          {t("phonology.phonotactics.toneSystem")}
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={toneSystem.enabled}
            onChange={(e) =>
              updateToneSystem({ ...toneSystem, enabled: e.target.checked })
            }
            className={TOGGLE}
          />
          <span className="text-sm text-base-content/70">
            {t("common.enabled")}
          </span>
        </label>
      </div>

      {toneSystem.enabled && (
        <div className="space-y-3 p-4 bg-base-200/50 rounded-lg border border-base-300">
          <p className="text-xs text-base-content/60">
            {t("phonology.phonotactics.toneHint")}
          </p>
          {toneSystem.tones.map((tone, idx) => (
            <div key={tone.tone_id} className="flex items-center gap-2">
              <input
                type="text"
                value={tone.name}
                onChange={(e) => {
                  const newTones = [...toneSystem.tones];
                  newTones[idx] = { ...tone, name: e.target.value };
                  updateToneSystem({ ...toneSystem, tones: newTones });
                }}
                className={`flex-1 ${INPUT}`}
                placeholder={t("phonology.phonotactics.toneName")}
              />
              <input
                type="text"
                value={tone.marker}
                onChange={(e) => {
                  const newTones = [...toneSystem.tones];
                  newTones[idx] = { ...tone, marker: e.target.value };
                  updateToneSystem({ ...toneSystem, tones: newTones });
                }}
                className={`w-20 ${INPUT_MONO} text-center`}
                placeholder="ˊ"
              />
              <button
                onClick={() => setConfirmDeleteToneIdx(idx)}
                className={BTN_ERROR}
                title={t("phonology.phonotactics.deleteTone")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const newTone: ToneDefinition = {
                tone_id: crypto.randomUUID(),
                name: "",
                marker: "",
              };
              updateToneSystem({
                ...toneSystem,
                tones: [...toneSystem.tones, newTone],
              });
            }}
            className={BTN_LINK}
          >
            <Plus size={14} /> {t("phonology.phonotactics.addTone")}
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirmDeleteToneIdx !== null}
        title={t("common.delete")}
        message={t("phonology.phonotactics.deleteToneConfirm", "Are you sure you want to delete this tone?")}
        onConfirm={() => {
          if (confirmDeleteToneIdx !== null) {
            const newTones = toneSystem.tones.filter((_, i) => i !== confirmDeleteToneIdx);
            updateToneSystem({ ...toneSystem, tones: newTones });
            setConfirmDeleteToneIdx(null);
          }
        }}
        onCancel={() => setConfirmDeleteToneIdx(null)}
      />
    </div>
  );
};
