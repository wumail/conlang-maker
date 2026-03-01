import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SortableItemProps {
  id: string;
  children:
  | React.ReactNode
  | ((handleProps: {
    listeners: ReturnType<typeof useSortable>["listeners"];
    attributes: ReturnType<typeof useSortable>["attributes"];
  }) => React.ReactNode);
  className?: string;
  /** Extra classes applied when this item is being dragged */
  activeClassName?: string;
}

/**
 * Generic wrapper that makes its children draggable via dnd-kit.
 *
 * **Handle-only mode (recommended):** pass a render function as `children`.
 * The function receives `{ listeners, attributes }` which you should spread
 * onto the drag handle element (e.g. GripVertical icon wrapper).
 *
 * **Legacy mode:** pass plain ReactNode children. The entire element becomes the drag handle.
 */
export function SortableItem({
  id,
  children,
  className = "",
  activeClassName = "opacity-50",
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isRenderProp = typeof children === "function";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className} ${isDragging ? activeClassName : ""}`}
      {...(isRenderProp ? {} : { ...attributes, ...listeners })}
    >
      {isRenderProp ? children({ listeners, attributes }) : children}
    </div>
  );
}
