import { NavLink, Outlet, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface TabDef {
  key: string;
  labelKey: string;
}

interface TabPageProps {
  basePath: string;
  defaultTab: string;
  tabs: readonly TabDef[];
}

/** 子标签页布局：顶部 tabs + Outlet */
export function TabPage({ basePath, defaultTab, tabs }: TabPageProps) {
  const { t } = useTranslation();
  const location = useLocation();

  if (location.pathname === basePath || location.pathname === `${basePath}/`) {
    return <Navigate to={`${basePath}/${defaultTab}`} replace />;
  }

  return (
    <div className="overflow-y-auto flex-1 flex flex-col">
      <div
        role="tablist"
        className="tabs tabs-border bg-base-200 px-4 sticky top-0 z-10"
      >
        {tabs.map(({ key, labelKey }) => (
          <NavLink
            key={key}
            to={`${basePath}/${key}`}
            role="tab"
            className={({ isActive }) => `tab ${isActive ? "tab-active" : ""}`}
          >
            {t(labelKey)}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 flex flex-col justify-start">
        <Outlet />
      </div>
    </div>
  );
}
