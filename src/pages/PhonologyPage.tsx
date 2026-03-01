import { TabPage } from "../components/common/TabPage";

const SUB_TABS = [
  { key: "inventory", labelKey: "phonology.tabs.inventory" },
  { key: "romanization", labelKey: "phonology.tabs.romanization" },
  { key: "phonotactics", labelKey: "phonology.tabs.phonotactics" },
  { key: "allophony", labelKey: "phonology.tabs.allophony" },
] as const;

export function PhonologyPage() {
  return (
    <TabPage basePath="/phonology" defaultTab="inventory" tabs={SUB_TABS} />
  );
}
