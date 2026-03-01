import { TabPage } from "../components/common/TabPage";

const SUB_TABS = [
  { key: "typology", labelKey: "grammar.sections.typology" },
  { key: "syntax", labelKey: "grammar.sections.syntax" },
  { key: "pos", labelKey: "grammar.sections.pos" },
  { key: "inflectionSystem", labelKey: "grammar.sections.inflectionSystem" },
  { key: "derivation", labelKey: "grammar.sections.derivation" },
  { key: "reference", labelKey: "grammar.sections.reference" },
] as const;

export function GrammarPage() {
  return <TabPage basePath="/grammar" defaultTab="pos" tabs={SUB_TABS} />;
}
