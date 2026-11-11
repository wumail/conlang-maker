import { TabPage } from "../components/common/TabPage";
import { FontInspectionProvider } from "../components/writing/FontInspectionContext";

const SUB_TABS = [
  { key: "font", labelKey: "writing.fontTab" },
  { key: "glyphs", labelKey: "writing.glyphsTab" },
] as const;

export function WritingPage() {
  return (
    <FontInspectionProvider>
      <TabPage basePath="/writing" defaultTab="font" tabs={SUB_TABS} />
    </FontInspectionProvider>
  );
}
