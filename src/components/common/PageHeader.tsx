import type { ReactNode } from "react";

interface PageHeaderProps {
  icon: ReactNode;
  title: string;
  /** "lg" = text-2xl (h1), "md" = text-lg (h2) */
  size?: "lg" | "md";
  children?: ReactNode;
}

/** 页面 / 区块标题：Icon + 文字，可选右侧操作区 */
export function PageHeader({
  icon,
  title,
  size = "lg",
  children,
}: PageHeaderProps) {
  const cls = size === "lg" ? "text-2xl" : "text-lg";
  const Tag = size === "lg" ? "h1" : "h2";

  return (
    <div className="flex items-center justify-between">
      <Tag className={`${cls} font-bold flex items-center gap-2`}>
        {icon} {title}
      </Tag>
      {children}
    </div>
  );
}
