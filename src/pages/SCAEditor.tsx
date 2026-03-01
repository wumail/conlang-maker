import { useTranslation } from "react-i18next";
import { ArrowRightLeft } from "lucide-react";
import { RuleSetList } from "../components/sca/RuleSetList";
import { SCAPreview } from "../components/sca/SCAPreview";
import { PageHeader } from "../components/common/PageHeader";

export function SCAEditor() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader icon={<ArrowRightLeft size={24} />} title={t("sca.title")} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <RuleSetList />
        <SCAPreview />
      </div>
    </div>
  );
}
