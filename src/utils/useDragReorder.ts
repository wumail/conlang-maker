import { useCallback, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export {
  DndContext,
  closestCenter,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  CSS,
  arrayMove,
};
export type { DragEndEvent };

class SmartKeyboardSensor extends KeyboardSensor {
  static activators = [
    {
      eventName: "onKeyDown" as const,
      handler: (event: React.KeyboardEvent<Element>, options: any, context: any) => {
        const nativeEvent = event.nativeEvent;
        if (
          nativeEvent.target instanceof HTMLElement &&
          (nativeEvent.target.isContentEditable ||
            nativeEvent.target.tagName === "INPUT" ||
            nativeEvent.target.tagName === "TEXTAREA" ||
            nativeEvent.target.tagName === "SELECT")
        ) {
          if (nativeEvent.code === "Space" || nativeEvent.code === "Enter") {
            return false;
          }
        }
        return KeyboardSensor.activators[0].handler(event, options, context);
      },
    },
  ];
}

/**
 * Shared sensor setup for dnd‑kit drag‑and‑drop.
 * Returns a pre‑configured `sensors` value to pass to `<DndContext sensors={sensors}>`.
 */
export function useDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(SmartKeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/**
 * Legacy-compatible hook for simple lists.
 * It wraps dnd-kit internals and returns an `onDragEnd` handler
 * that callers pass to `<DndContext>`.
 *
 * Usage:
 *   const { sensors, onDragEnd } = useDragReorder(items, onReorder, getId);
 *   <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
 *     <SortableContext items={ids} strategy={verticalListSortingStrategy}>
 *       ...
 *     </SortableContext>
 *   </DndContext>
 */
export function useDragReorder<T>(
  items: T[],
  onReorder: (reordered: T[]) => void,
  getId: (item: T) => string,
) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;
  const getIdRef = useRef(getId);
  getIdRef.current = getId;

  const sensors = useDndSensors();

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = itemsRef.current;
    const oldIndex = list.findIndex((it) => getIdRef.current(it) === String(active.id));
    const newIndex = list.findIndex((it) => getIdRef.current(it) === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(list, oldIndex, newIndex);
    onReorderRef.current(reordered);
  }, []);

  return { sensors, onDragEnd };
}

