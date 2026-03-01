interface EmptyStateProps {
  message: string;
  /** true = full-height flex-center layout */
  centered?: boolean;
}

/** 空数据占位提示 */
export function EmptyState({ message, centered }: EmptyStateProps) {
  if (centered) {
    return (
      <div className="flex-1 flex items-center justify-center h-full text-base-content/50 italic">
        {message}
      </div>
    );
  }
  return <p className="text-base-content/50 italic text-sm">{message}</p>;
}
