import { useMemo } from "react";
import { useTranslation } from "react-i18next";

/**
 * 显式 i18n 标签映射（gemini.md §6：i18n key 尽可能保持显式引用）。
 *
 * 背景：IPA 音标表、类型学选项等界面的标签历史上通过模板字符串
 * （`t(`phonology.inventory.places.${place}`)`）动态拼接访问，导致
 * `scripts/i18n-check.mjs` 无法静态识别，产生大量「已定义但未使用」告警。
 *
 * 本模块把每个动态家族收敛为 `Record<string, string>` 映射函数：键集合与
 * `src/data/*` 中的字面量取值一一对应，翻译键在代码中以字面量显式出现。
 */

/** IPA 元音高度（VowelChart 行标签） */
export function useIpaHeightLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      close: t("phonology.inventory.close"),
      nearClose: t("phonology.inventory.nearClose"),
      closeMid: t("phonology.inventory.closeMid"),
      mid: t("phonology.inventory.mid"),
      openMid: t("phonology.inventory.openMid"),
      nearOpen: t("phonology.inventory.nearOpen"),
      open: t("phonology.inventory.open"),
    }),
    [t],
  );
}

/** IPA 调音部位（PLACES） */
export function useIpaPlaceLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      Bilabial: t("phonology.inventory.places.Bilabial"),
      Labiodental: t("phonology.inventory.places.Labiodental"),
      Linguolabial: t("phonology.inventory.places.Linguolabial"),
      Dental: t("phonology.inventory.places.Dental"),
      Alveolar: t("phonology.inventory.places.Alveolar"),
      Postalveolar: t("phonology.inventory.places.Postalveolar"),
      Retroflex: t("phonology.inventory.places.Retroflex"),
      "(Alveolo-)palatal": t("phonology.inventory.places.(Alveolo-)palatal"),
      Velar: t("phonology.inventory.places.Velar"),
      Uvular: t("phonology.inventory.places.Uvular"),
      "Pharyngeal/epiglottal": t("phonology.inventory.places.Pharyngeal/epiglottal"),
      Glottal: t("phonology.inventory.places.Glottal"),
    }),
    [t],
  );
}

/** IPA 发音方式（CONSONANT_DATA.manner） */
export function useIpaMannerLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      Nasal: t("phonology.inventory.manners.Nasal"),
      Plosive: t("phonology.inventory.manners.Plosive"),
      "Sibilant affricate": t("phonology.inventory.manners.Sibilant affricate"),
      "Non-sibilant affricate": t("phonology.inventory.manners.Non-sibilant affricate"),
      "Sibilant fricative": t("phonology.inventory.manners.Sibilant fricative"),
      "Non-sibilant fricative": t("phonology.inventory.manners.Non-sibilant fricative"),
      Approximant: t("phonology.inventory.manners.Approximant"),
      "Tap/flap": t("phonology.inventory.manners.Tap/flap"),
      Trill: t("phonology.inventory.manners.Trill"),
      "Lateral affricate": t("phonology.inventory.manners.Lateral affricate"),
      "Lateral fricative": t("phonology.inventory.manners.Lateral fricative"),
      "Lateral approximant": t("phonology.inventory.manners.Lateral approximant"),
      "Lateral tap/flap": t("phonology.inventory.manners.Lateral tap/flap"),
    }),
    [t],
  );
}

/** 非肺部气流音分类（NON_PULMONIC_DATA.category） */
export function useIpaCategoryLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      click: t("phonology.inventory.categories.click"),
      implosive: t("phonology.inventory.categories.implosive"),
      ejective: t("phonology.inventory.categories.ejective"),
      plosive: t("phonology.inventory.categories.plosive"),
      nasal: t("phonology.inventory.categories.nasal"),
      fricativeApproximant: t("phonology.inventory.categories.fricativeApproximant"),
    }),
    [t],
  );
}

/** 协同调音子分类（CO_ARTICULATED_DATA.subcategory） */
export function useIpaSubcategoryLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      stop: t("phonology.inventory.subcategories.stop"),
      fricative: t("phonology.inventory.subcategories.fricative"),
      affricate: t("phonology.inventory.subcategories.affricate"),
      lateral: t("phonology.inventory.subcategories.lateral"),
      voiced: t("phonology.inventory.subcategories.voiced"),
      voiceless: t("phonology.inventory.subcategories.voiceless"),
    }),
    [t],
  );
}

/** 形态类型（TypologySection / WordGenerator） */
export function useTypologyTypeLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      isolating: t("typology.types.isolating"),
      agglutinative: t("typology.types.agglutinative"),
      fusional: t("typology.types.fusional"),
      polysynthetic: t("typology.types.polysynthetic"),
    }),
    [t],
  );
}

/** 形态类型说明文案 */
export function useTypologyTypeDescriptionLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      isolating: t("typology.typeDescriptions.isolating"),
      agglutinative: t("typology.typeDescriptions.agglutinative"),
      fusional: t("typology.typeDescriptions.fusional"),
      polysynthetic: t("typology.typeDescriptions.polysynthetic"),
    }),
    [t],
  );
}

/** 核心标记策略（head_marking） */
export function useHeadMarkingLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      none: t("typology.headMarkingOptions.none"),
      head: t("typology.headMarkingOptions.head"),
      dependent: t("typology.headMarkingOptions.dependent"),
      double: t("typology.headMarkingOptions.double"),
    }),
    [t],
  );
}

/** 屈折/派生类型（InflectionSection） */
export function useInflectionKindLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      ablaut: t("grammar.ablaut"),
      reduplication: t("grammar.reduplication"),
    }),
    [t],
  );
}

/** 词典质检规则名（QualityCheck） */
export function useQcRuleLabels(): Record<string, string> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      missingPos: t("qc.rules.missingPos"),
      unmappedSpelling: t("qc.rules.unmappedSpelling"),
      emptyIpa: t("qc.rules.emptyIpa"),
      patternMismatch: t("qc.rules.patternMismatch"),
      missingRequired: t("qc.rules.missingRequired"),
      duplicateWord: t("qc.rules.duplicateWord"),
      phonotacticViolation: t("qc.rules.phonotacticViolation"),
      blacklistHit: t("qc.rules.blacklistHit"),
      vowelHarmonyViolation: t("qc.rules.vowelHarmonyViolation"),
      homophonyClash: t("qc.rules.homophonyClash"),
    }),
    [t],
  );
}
